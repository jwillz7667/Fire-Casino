import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@aureus/db";
import { type ScopedPrismaClient } from "@aureus/db";
import {
  canOwnPlayers,
  type CreatePlayerInput,
  type Env,
  isInSubtree,
  type ListPlayersQuery,
  type ResetPlayerPasswordInput,
  type UpdatePlayerInput,
  walletCurrencies,
} from "@aureus/shared";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ForbiddenError, NotFoundError, OutOfScopeError } from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA, PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { PasswordService } from "../auth/password.service";
import { OperatorsService } from "../operators/operators.service";

interface ActionContext {
  ip?: string;
  userAgent?: string;
}

const PLAYER_SELECT = {
  id: true,
  operatorId: true,
  username: true,
  displayName: true,
  phone: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.PlayerSelect;

@Injectable()
export class PlayersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ScopedPrismaClient,
    @Inject(PRISMA_SYSTEM) private readonly system: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    private readonly passwords: PasswordService,
    private readonly operators: OperatorsService,
    private readonly audit: AuditService,
  ) {}

  /** Create a player owned by the calling STORE, with wallet(s) and an empty KYC record. */
  async create(caller: OperatorPrincipal, input: CreatePlayerInput, ctx: ActionContext) {
    if (!canOwnPlayers(caller.tier)) {
      throw new ForbiddenError("Only stores can create players");
    }
    await this.operators.assertOperatorActionable(caller.operatorId);
    const passwordHash = await this.passwords.hash(input.tempPassword);

    const player = await this.system.player.create({
      data: {
        operator: { connect: { id: caller.operatorId } },
        username: input.username,
        passwordHash,
        displayName: input.displayName,
        phone: input.phone,
        email: input.email,
        kyc: { create: { status: "NONE" } },
        wallets: {
          create: walletCurrencies(this.env.PLATFORM_MODE).map((currency) => ({
            ownerType: "PLAYER" as const,
            currency,
            balanceMinor: 0n,
          })),
        },
      },
      select: PLAYER_SELECT,
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "player.create",
      targetType: "Player",
      targetId: player.id,
      after: { username: input.username, operatorId: caller.operatorId },
      ...ctx,
    });
    return player;
  }

  async list(query: ListPlayersQuery) {
    const where: Prisma.PlayerWhereInput = {};
    if (query.operatorId) where.operatorId = query.operatorId;
    if (query.status) where.status = query.status;
    if (query.q) where.username = { contains: query.q, mode: "insensitive" };

    const items = await this.prisma.player.findMany({
      where,
      select: PLAYER_SELECT,
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > query.limit;
    return {
      items: hasMore ? items.slice(0, query.limit) : items,
      nextCursor: hasMore ? items[query.limit - 1]?.id : undefined,
    };
  }

  async get(id: string) {
    const player = await this.system.player.findUnique({
      where: { id },
      select: {
        ...PLAYER_SELECT,
        kyc: { select: { status: true, level: true } },
        wallets: { select: { currency: true, balanceMinor: true } },
      },
    });
    if (!player) throw new NotFoundError("Player not found");
    return {
      ...player,
      wallets: player.wallets.map((w) => ({ currency: w.currency, balanceMinor: w.balanceMinor.toString() })),
    };
  }

  async update(caller: OperatorPrincipal, id: string, input: UpdatePlayerInput, ctx: ActionContext) {
    await this.ensureExists(id);
    const updated = await this.system.player.update({ where: { id }, data: input, select: PLAYER_SELECT });
    await this.audit.record({
      ...auditActor(caller),
      action: "player.update",
      targetType: "Player",
      targetId: id,
      after: input,
      ...ctx,
    });
    return updated;
  }

  async suspend(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    await this.ensureExists(id);
    const updated = await this.system.player.update({
      where: { id },
      data: { status: "SUSPENDED" },
      select: PLAYER_SELECT,
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "player.suspend",
      targetType: "Player",
      targetId: id,
      after: { status: "SUSPENDED" },
      ...ctx,
    });
    return updated;
  }

  async resetPassword(
    caller: OperatorPrincipal,
    id: string,
    input: ResetPlayerPasswordInput,
    ctx: ActionContext,
  ) {
    await this.ensureExists(id);
    const passwordHash = await this.passwords.hash(input.tempPassword);
    await this.system.player.update({ where: { id }, data: { passwordHash } });
    // Force re-login everywhere by revoking the player's refresh sessions.
    await this.system.refreshToken.updateMany({
      where: { playerId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "player.reset_password",
      targetType: "Player",
      targetId: id,
      ...ctx,
    });
  }

  /** Reassign a player to a different store (ADMIN/SUPER_ADMIN). */
  async transfer(caller: OperatorPrincipal, id: string, toOperatorId: string, ctx: ActionContext) {
    if (caller.tier !== "SUPER_ADMIN" && caller.tier !== "ADMIN") {
      throw new ForbiddenError("Only admins can transfer players");
    }
    await this.ensureExists(id);
    const target = await this.system.operator.findUnique({
      where: { id: toOperatorId },
      select: { tier: true, path: true },
    });
    if (!target) throw new NotFoundError("Target operator not found");
    if (!isInSubtree(caller.path, target.path)) throw new OutOfScopeError();
    if (target.tier !== "STORE") throw new ForbiddenError("Players can only belong to a store");

    const updated = await this.system.player.update({
      where: { id },
      data: { operatorId: toOperatorId },
      select: PLAYER_SELECT,
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "player.transfer",
      targetType: "Player",
      targetId: id,
      after: { toOperatorId },
      ...ctx,
    });
    return updated;
  }

  private async ensureExists(id: string): Promise<void> {
    const player = await this.system.player.findUnique({ where: { id }, select: { id: true } });
    if (!player) throw new NotFoundError("Player not found");
  }
}
