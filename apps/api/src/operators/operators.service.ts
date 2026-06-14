import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@aureus/db";
import {
  canCreateChildTier,
  type CreateOperatorInput,
  type Env,
  isInSubtree,
  type ListOperatorsQuery,
  operatorCurrency,
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
          settings: (input.settings ?? {}) as Prisma.InputJsonObject,
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
      select: NODE_SELECT,
      orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    return { items: hasMore ? items.slice(0, query.limit) : items, nextCursor: hasMore ? items[query.limit - 1]?.id : undefined };
  }

  async listChildren(parentId: string, query: ListOperatorsQuery) {
    return this.list({ ...query, scope: "children", parentId });
  }

  async get(id: string) {
    const operator = await this.system.operator.findUnique({ where: { id }, select: NODE_SELECT });
    if (!operator) throw new NotFoundError("Operator not found");
    return operator;
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
      select: NODE_SELECT,
      orderBy: [{ depth: "asc" }, { pathSegment: "asc" }],
    });
    return this.buildTree(nodes, root.id);
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
        settings: input.settings ? (input.settings as Prisma.InputJsonObject) : undefined,
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

  /** Scoped rollups for a node's subtree (docs/05 §2 /stats). */
  async getStats(id: string) {
    const node = await this.system.operator.findUnique({ where: { id }, select: { path: true } });
    if (!node) throw new NotFoundError("Operator not found");
    const subtree: Prisma.OperatorWhereInput = {
      OR: [{ path: node.path }, { path: { startsWith: `${node.path}.` } }],
    };
    const [operatorCount, playerCount, opAgg, playerAgg] = await Promise.all([
      this.system.operator.count({ where: subtree }),
      this.system.player.count({ where: { operator: subtree } }),
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
