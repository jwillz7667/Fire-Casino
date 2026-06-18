import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@aureus/db";
import {
  canCreateChildTier,
  canGrantPermission,
  type CreateOperatorInput,
  type Env,
  isInSubtree,
  type ListOperatorsQuery,
  operatorCurrency,
  type Permission,
  type UpdateOperatorInput,
} from "@aureus/shared";
import { type ScopedPrismaClient } from "@aureus/db";
import { type OperatorPrincipal } from "../common/auth/principal";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  OutOfScopeError,
} from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA, PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { PasswordService } from "../auth/password.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

function ancestorPaths(path: string): string[] {
  const parts = path.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join("."));
}

/**
 * Drop any `permissions` key from a generic settings write. Grants are conferred
 * only through `setGrants` (the gated path); the create/update settings blob must
 * never be able to carry a permission grant (prevents self-escalation — B1).
 */
function sanitizeSettings(settings: Record<string, unknown> | undefined): Prisma.InputJsonObject {
  if (!settings) return {};
  const rest = { ...settings };
  delete rest.permissions;
  return rest as Prisma.InputJsonObject;
}

const NODE_SELECT = {
  id: true,
  tier: true,
  displayName: true,
  status: true,
  path: true,
  depth: true,
  parentId: true,
  buyUnitPriceCents: true,
  sellUnitPriceCents: true,
  createdAt: true,
} satisfies Prisma.OperatorSelect;

// NODE_SELECT plus the node's own ledger balances, for the list + tree views
// (docs/06 §3.2 node cards show balance; audit L2).
const NODE_WITH_BALANCE = {
  ...NODE_SELECT,
  ledgerAccounts: { select: { currency: true, balanceMinor: true } },
} satisfies Prisma.OperatorSelect;

function withBalances<T extends { ledgerAccounts: { currency: string; balanceMinor: bigint }[] }>(
  o: T,
): Omit<T, "ledgerAccounts"> & { balances: { currency: string; balanceMinor: string }[] } {
  const { ledgerAccounts, ...rest } = o;
  return {
    ...rest,
    balances: ledgerAccounts.map((a) => ({ currency: a.currency, balanceMinor: a.balanceMinor.toString() })),
  };
}

@Injectable()
export class OperatorsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ScopedPrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly system: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  /** Create a child operator one tier below, inside the caller's subtree. */
  async createChild(caller: OperatorPrincipal, input: CreateOperatorInput, ctx: ActionContext) {
    const parentId = input.parentId ?? caller.operatorId;
    const parent = await this.system.operator.findUnique({ where: { id: parentId } });
    if (!parent) throw new NotFoundError("Parent operator not found");
    if (!isInSubtree(caller.path, parent.path)) throw new OutOfScopeError();
    await this.assertNotFrozen(parent.path);
    if (!canCreateChildTier(parent.tier, input.tier)) {
      throw new ForbiddenError("Child tier must rank strictly below the parent tier");
    }

    // Hash outside the transaction so the parent row lock is held only briefly.
    const passwordHash = await this.passwords.hash(input.tempPassword);

    const created = await this.system.$transaction(async (tx) => {
      // Serialize sibling pathSegment assignment under a parent row lock.
      await tx.$queryRaw`SELECT id FROM operators WHERE id = ${parentId} FOR UPDATE`;
      const max = await tx.operator.aggregate({
        where: { parentId },
        _max: { pathSegment: true },
      });
      const pathSegment = (max._max.pathSegment ?? 0) + 1;
      const path = `${parent.path}.${String(pathSegment)}`;

      const operator = await tx.operator.create({
        data: {
          tier: input.tier,
          displayName: input.displayName,
          parent: { connect: { id: parentId } },
          pathSegment,
          path,
          depth: parent.depth + 1,
          buyUnitPriceCents: input.buyUnitPriceCents ?? parent.sellUnitPriceCents ?? null,
          sellUnitPriceCents: input.sellUnitPriceCents ?? null,
          settings: sanitizeSettings(input.settings),
          user: { create: { username: input.username, passwordHash } },
          ledgerAccounts: {
            create: { ownerType: "OPERATOR", currency: operatorCurrency(this.env.PLATFORM_MODE), balanceMinor: 0n },
          },
        },
        select: NODE_SELECT,
      });

      await this.audit.record(
        {
          ...auditActor(caller),
          action: "operator.create",
          targetType: "Operator",
          targetId: operator.id,
          after: { tier: input.tier, displayName: input.displayName, path, parentId },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return operator;
    });

    return { operator: created, username: input.username };
  }

  /** List direct children (default) or the whole subtree, scoped to the caller. */
  async list(query: ListOperatorsQuery) {
    const where: Prisma.OperatorWhereInput =
      query.scope === "children" && query.parentId ? { parentId: query.parentId } : {};
    if (query.scope === "children" && !query.parentId) {
      // children of the caller's own node would need the caller id; handled by controller default
    }
    const items = await this.prisma.operator.findMany({
      where,
      select: NODE_WITH_BALANCE,
      orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    const page = (hasMore ? items.slice(0, query.limit) : items).map(withBalances);
    return { items: page, nextCursor: hasMore ? items[query.limit - 1]?.id : undefined };
  }

  async listChildren(parentId: string, query: ListOperatorsQuery) {
    return this.list({ ...query, scope: "children", parentId });
  }

  async get(id: string) {
    const operator = await this.system.operator.findUnique({
      where: { id },
      select: { ...NODE_SELECT, settings: true },
    });
    if (!operator) throw new NotFoundError("Operator not found");
    const { settings, ...node } = operator;
    // Surface the node's per-operator grants so the console grants editor can
    // prefill the current set (grants are written only via setGrants).
    const grants = Array.isArray((settings as { permissions?: unknown })?.permissions)
      ? ((settings as { permissions?: string[] }).permissions ?? [])
      : [];
    return { ...node, grants };
  }

  /** Nested subtree rooted at `id`, bounded by `depth`. */
  async getTree(id: string, depthLimit: number) {
    const root = await this.system.operator.findUnique({
      where: { id },
      select: { ...NODE_SELECT },
    });
    if (!root) throw new NotFoundError("Operator not found");
    const nodes = await this.system.operator.findMany({
      where: {
        OR: [{ path: root.path }, { path: { startsWith: `${root.path}.` } }],
        depth: { lte: root.depth + depthLimit },
      },
      select: NODE_WITH_BALANCE,
      orderBy: [{ depth: "asc" }, { pathSegment: "asc" }],
    });
    return this.buildTree(nodes.map(withBalances), root.id);
  }

  async update(caller: OperatorPrincipal, id: string, input: UpdateOperatorInput, ctx: ActionContext) {
    const before = await this.system.operator.findUnique({ where: { id }, select: NODE_SELECT });
    if (!before) throw new NotFoundError("Operator not found");
    const updated = await this.system.operator.update({
      where: { id },
      data: {
        displayName: input.displayName,
        buyUnitPriceCents: input.buyUnitPriceCents,
        sellUnitPriceCents: input.sellUnitPriceCents,
        settings: input.settings ? sanitizeSettings(input.settings) : undefined,
      },
      select: NODE_SELECT,
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "operator.update",
      targetType: "Operator",
      targetId: id,
      before,
      after: updated,
      ...ctx,
    });
    return updated;
  }

  /**
   * Confer the per-operator permission grants on a STRICT DESCENDANT (docs/04 §3).
   * Grants flow downward only — never to self — and each must pass
   * `canGrantPermission` (grantable, not exceeding the granter, super-admin-only
   * for mint/ledger.adjust/platform.settings). This is the only writer of
   * `settings.permissions`; it replaces the full grant set for the target.
   */
  async setGrants(caller: OperatorPrincipal, id: string, permissions: Permission[], ctx: ActionContext) {
    if (id === caller.operatorId) throw new ForbiddenError("Cannot grant permissions to your own node");
    const target = await this.system.operator.findUnique({
      where: { id },
      select: { ...NODE_SELECT, settings: true },
    });
    if (!target) throw new NotFoundError("Operator not found");
    if (target.path === caller.path || !isInSubtree(caller.path, target.path)) {
      throw new OutOfScopeError();
    }

    const granter = { tier: caller.tier, settings: caller.settings };
    const unique = [...new Set(permissions)];
    for (const permission of unique) {
      const decision = canGrantPermission(granter, permission);
      if (!decision.allowed) throw new ForbiddenError(decision.reason ?? "Grant not allowed");
    }

    const existing = (target.settings as Record<string, unknown> | null) ?? {};
    const before = (existing.permissions as string[] | undefined) ?? [];
    const updated = await this.system.operator.update({
      where: { id },
      data: { settings: { ...existing, permissions: unique } },
      select: NODE_SELECT,
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "operator.set_grants",
      targetType: "Operator",
      targetId: id,
      before: { permissions: before },
      after: { permissions: unique },
      ...ctx,
    });
    return { ...updated, permissions: unique };
  }

  async suspend(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    return this.setStatus(caller, id, "SUSPENDED", "operator.suspend", ctx);
  }

  async activate(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    return this.setStatus(caller, id, "ACTIVE", "operator.activate", ctx);
  }

  async close(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    if (id === caller.operatorId) throw new ConflictError("Cannot close your own node");
    const operator = await this.system.operator.findUnique({
      where: { id },
      select: { ...NODE_SELECT, _count: { select: { children: true } }, ledgerAccounts: { select: { balanceMinor: true } } },
    });
    if (!operator) throw new NotFoundError("Operator not found");
    if (operator._count.children > 0) {
      throw new ConflictError("Cannot close an operator with children");
    }
    if (operator.ledgerAccounts.some((a) => a.balanceMinor !== 0n)) {
      throw new ConflictError("Cannot close an operator with a non-zero balance");
    }
    const updated = await this.system.operator.update({
      where: { id },
      data: { status: "CLOSED" },
      select: NODE_SELECT,
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "operator.close",
      targetType: "Operator",
      targetId: id,
      after: { status: "CLOSED" },
      ...ctx,
    });
    return updated;
  }

  async getBalances(id: string) {
    const accounts = await this.system.ledgerAccount.findMany({
      where: { ownerType: "OPERATOR", operatorId: id },
      select: { currency: true, balanceMinor: true },
    });
    return accounts.map((a) => ({ currency: a.currency, balanceMinor: a.balanceMinor.toString() }));
  }

  /** This node's own ledger entries (issues received, transfers in/out, recharges funded) — docs/06 §3.4. */
  async getCreditHistory(id: string, cursor: string | undefined, limit: number) {
    const items = await this.system.ledgerEntry.findMany({
      where: { account: { ownerType: "OPERATOR", operatorId: id } },
      select: {
        id: true,
        direction: true,
        amountMinor: true,
        currency: true,
        balanceAfterMinor: true,
        createdAt: true,
        transaction: { select: { type: true, memo: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page.map((e) => ({
        id: e.id,
        type: e.transaction.type,
        direction: e.direction,
        currency: e.currency,
        amountMinor: e.amountMinor.toString(),
        balanceAfterMinor: e.balanceAfterMinor.toString(),
        memo: e.transaction.memo,
        createdAt: e.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  /** Scoped rollups for a node's subtree (docs/05 §2 /stats). */
  async getStats(id: string) {
    const node = await this.system.operator.findUnique({ where: { id }, select: { path: true } });
    if (!node) throw new NotFoundError("Operator not found");
    const subtree: Prisma.OperatorWhereInput = {
      OR: [{ path: node.path }, { path: { startsWith: `${node.path}.` } }],
    };
    const [operatorCount, playerCount, opAgg, playerAgg] = await Promise.all([
      this.system.operator.count({ where: subtree }),
      this.system.player.count({ where: { operator: subtree, status: "ACTIVE" } }),
      this.system.ledgerAccount.aggregate({
        where: { ownerType: "OPERATOR", operator: subtree },
        _sum: { balanceMinor: true },
      }),
      this.system.ledgerAccount.aggregate({
        where: { ownerType: "PLAYER", player: { operator: subtree } },
        _sum: { balanceMinor: true },
      }),
    ]);
    const circulation = (opAgg._sum.balanceMinor ?? 0n) + (playerAgg._sum.balanceMinor ?? 0n);
    return {
      operatorCount,
      activePlayers: playerCount,
      circulationBelowMinor: circulation.toString(),
    };
  }

  // ---- internals -------------------------------------------------------------

  private async setStatus(
    caller: OperatorPrincipal,
    id: string,
    status: "ACTIVE" | "SUSPENDED",
    action: string,
    ctx: ActionContext,
  ) {
    if (id === caller.operatorId) throw new ConflictError("Cannot change your own node status");
    const before = await this.system.operator.findUnique({ where: { id }, select: NODE_SELECT });
    if (!before) throw new NotFoundError("Operator not found");
    const updated = await this.system.operator.update({
      where: { id },
      data: { status },
      select: NODE_SELECT,
    });
    await this.audit.record({
      ...auditActor(caller),
      action,
      targetType: "Operator",
      targetId: id,
      before: { status: before.status },
      after: { status },
      ...ctx,
    });
    return updated;
  }

  /** Throw if the node or any ancestor is suspended (the freeze cascade, docs/04 §4). */
  private async assertNotFrozen(path: string): Promise<void> {
    const frozen = await this.system.operator.findFirst({
      where: { path: { in: ancestorPaths(path) }, status: "SUSPENDED" },
      select: { id: true },
    });
    if (frozen) throw new ForbiddenError("A suspended ancestor has frozen this subtree");
  }

  private buildTree(
    nodes: Prisma.OperatorGetPayload<{ select: typeof NODE_SELECT }>[],
    rootId: string,
  ): unknown {
    const byParent = new Map<string, typeof nodes>();
    for (const n of nodes) {
      const key = n.parentId ?? "";
      const list = byParent.get(key) ?? [];
      list.push(n);
      byParent.set(key, list);
    }
    const attach = (node: (typeof nodes)[number]): Record<string, unknown> => ({
      ...node,
      children: (byParent.get(node.id) ?? []).map(attach),
    });
    const root = nodes.find((n) => n.id === rootId);
    return root ? attach(root) : null;
  }

  /** Resolve the freeze check for an arbitrary operator id (used by credit flows). */
  async assertOperatorActionable(operatorId: string): Promise<void> {
    const operator = await this.system.operator.findUnique({
      where: { id: operatorId },
      select: { path: true, status: true },
    });
    if (!operator) throw new NotFoundError("Operator not found");
    if (operator.status !== "ACTIVE") throw new ForbiddenError("Operator is not active");
    await this.assertNotFrozen(operator.path);
  }
}
