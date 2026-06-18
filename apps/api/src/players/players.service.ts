import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@aureus/db";
import { type ScopedPrismaClient } from "@aureus/db";
import {
  canOwnPlayers,
  type CreatePlayerInput,
  type Env,
  isInSubtree,
  type ListPlayersQuery,
  type PlayerHistoryQuery,
  type ResetPlayerPasswordInput,
  type SessionRoundsQuery,
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

export type PlayerHistoryEvent =
  | {
      kind: "ledger";
      id: string;
      at: Date;
      type: string;
      direction: string;
      currency: string;
      amountMinor: string;
      balanceAfterMinor: string;
      memo: string | null;
    }
  | {
      kind: "session";
      id: string;
      at: Date;
      status: string;
      currency: string;
      totalBetMinor: string;
      totalWinMinor: string;
    }
  | {
      kind: "redemption";
      id: string;
      at: Date;
      status: string;
      currency: string;
      amountMinor: string;
      method: string | null;
    };

export interface PlayerHistoryResult {
  items: PlayerHistoryEvent[];
  nextCursor: string | undefined;
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

    const player = await this.system.$transaction(async (tx) => {
      const created = await tx.player.create({
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
      // Live-update the creating agent's (and any subscribed ancestor's) player
      // list + admin dashboards (R1). Same tx as the insert so it can't be lost.
      await tx.outboxEvent.create({
        data: {
          type: "player.created",
          payload: { playerId: created.id, operatorId: caller.operatorId, username: input.username },
          rooms: [`operator:${caller.operatorId}`, "admin:global"],
        },
      });
      return created;
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

    const rows = await this.prisma.player.findMany({
      where,
      select: {
        ...PLAYER_SELECT,
        operator: { select: { displayName: true } },
        wallets: { select: { currency: true, balanceMinor: true } },
      },
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const ids = page.map((p) => p.id);

    // Two bounded aggregate queries over the page's player ids (no N+1): the ids
    // came from the scoped client, so they are already subtree-authorized.
    const [recharged, redeemed] = await Promise.all([
      this.aggRecharged(ids),
      this.aggRedeemed(ids),
    ]);

    return {
      items: page.map((p) => ({
        id: p.id,
        operatorId: p.operatorId,
        owningAgentName: p.operator.displayName,
        username: p.username,
        displayName: p.displayName,
        phone: p.phone,
        email: p.email,
        status: p.status,
        lastLoginAt: p.lastLoginAt,
        createdAt: p.createdAt,
        wallets: p.wallets.map((w) => ({ currency: w.currency, balanceMinor: w.balanceMinor.toString() })),
        lifetimeRechargedMinor: (recharged.get(p.id) ?? 0n).toString(),
        lifetimeRedeemedMinor: (redeemed.get(p.id) ?? 0n).toString(),
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  /** Lifetime credits recharged into each player's wallet (RECHARGE credits). */
  private async aggRecharged(ids: string[]): Promise<Map<string, bigint>> {
    if (ids.length === 0) return new Map();
    const rows = await this.system.$queryRaw<{ playerId: string; total: bigint }[]>(Prisma.sql`
      SELECT a."playerId" AS "playerId", COALESCE(SUM(e."amountMinor"), 0)::bigint AS total
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e."accountId"
      JOIN ledger_transactions t ON t.id = e."transactionId"
      WHERE a."playerId" IN (${Prisma.join(ids)})
        AND a."ownerType" = 'PLAYER'
        AND e.direction = 'CREDIT'
        AND t.type = 'RECHARGE'
      GROUP BY a."playerId"`);
    return new Map(rows.map((r) => [r.playerId, r.total]));
  }

  /** Lifetime credits successfully redeemed (settled/PAID redemptions) per player. */
  private async aggRedeemed(ids: string[]): Promise<Map<string, bigint>> {
    if (ids.length === 0) return new Map();
    const grouped = await this.system.redemptionRequest.groupBy({
      by: ["playerId"],
      where: { playerId: { in: ids }, status: "PAID" },
      _sum: { amountMinor: true },
    });
    return new Map(grouped.map((g) => [g.playerId, g._sum.amountMinor ?? 0n]));
  }

  async get(caller: OperatorPrincipal, id: string) {
    await this.assertInSubtree(caller, id);
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

  /**
   * Unified per-player timeline (docs/05 §4): ledger entries (recharges, bets,
   * wins, redemption moves), game sessions, and redemption requests, merged and
   * ordered by time. Cursor is the ISO timestamp of the last item seen; each
   * source is filtered to `< cursor` and over-fetched so the merge is complete
   * for the page.
   */
  async history(caller: OperatorPrincipal, id: string, query: PlayerHistoryQuery): Promise<PlayerHistoryResult> {
    await this.assertInSubtree(caller, id);
    const before = query.cursor ? new Date(query.cursor) : undefined;
    const take = query.limit + 1;
    const when = before ? { createdAt: { lt: before } } : {};

    const [entries, sessions, redemptions] = await Promise.all([
      this.system.ledgerEntry.findMany({
        where: { account: { ownerType: "PLAYER", playerId: id }, ...when },
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
        take,
      }),
      this.system.gameSession.findMany({
        where: { playerId: id, ...(before ? { startedAt: { lt: before } } : {}) },
        select: {
          id: true,
          status: true,
          currency: true,
          totalBetMinor: true,
          totalWinMinor: true,
          startedAt: true,
        },
        orderBy: { startedAt: "desc" },
        take,
      }),
      this.system.redemptionRequest.findMany({
        where: { playerId: id, ...when },
        select: { id: true, status: true, amountMinor: true, currency: true, method: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take,
      }),
    ]);

    const events: PlayerHistoryEvent[] = [
      ...entries.map((e) => ({
        kind: "ledger" as const,
        id: e.id,
        at: e.createdAt,
        type: e.transaction.type,
        direction: e.direction,
        currency: e.currency,
        amountMinor: e.amountMinor.toString(),
        balanceAfterMinor: e.balanceAfterMinor.toString(),
        memo: e.transaction.memo,
      })),
      ...sessions.map((s) => ({
        kind: "session" as const,
        id: s.id,
        at: s.startedAt,
        status: s.status,
        currency: s.currency,
        totalBetMinor: s.totalBetMinor.toString(),
        totalWinMinor: s.totalWinMinor.toString(),
      })),
      ...redemptions.map((r) => ({
        kind: "redemption" as const,
        id: r.id,
        at: r.createdAt,
        status: r.status,
        currency: r.currency,
        amountMinor: r.amountMinor.toString(),
        method: r.method,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    const hasMore = events.length > query.limit;
    const page = hasMore ? events.slice(0, query.limit) : events;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1]?.at.toISOString() : undefined,
    };
  }

  /**
   * Round-by-round drill-down of one play session (docs/06 play history). The
   * session must belong to the named player, who must live in the caller's
   * subtree — so a guessed sessionId can't expose another player's rounds.
   */
  async sessionRounds(caller: OperatorPrincipal, playerId: string, sessionId: string, query: SessionRoundsQuery) {
    await this.assertInSubtree(caller, playerId);
    const session = await this.system.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        playerId: true,
        currency: true,
        startedAt: true,
        endedAt: true,
        serverSeed: true,
        serverSeedHash: true,
        clientSeed: true,
        game: { select: { code: true, name: true } },
      },
    });
    if (!session || session.playerId !== playerId) throw new NotFoundError("Session not found");

    const rounds = await this.system.gameRound.findMany({
      where: { sessionId },
      select: { id: true, nonce: true, betMinor: true, winMinor: true, outcome: true, createdAt: true },
      orderBy: { nonce: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rounds.length > query.limit;
    const page = hasMore ? rounds.slice(0, query.limit) : rounds;

    return {
      session: {
        id: sessionId,
        gameCode: session.game.code,
        gameName: session.game.name,
        currency: session.currency,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        // Provably-fair seeds: hash is always known; the seed is revealed at session end.
        serverSeedHash: session.serverSeedHash,
        serverSeed: session.serverSeed,
        clientSeed: session.clientSeed,
      },
      items: page.map((r) => ({
        id: r.id,
        nonce: r.nonce,
        betMinor: r.betMinor.toString(),
        winMinor: r.winMinor.toString(),
        outcome: r.outcome,
        at: r.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  async update(caller: OperatorPrincipal, id: string, input: UpdatePlayerInput, ctx: ActionContext) {
    await this.assertInSubtree(caller, id);
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
    await this.assertInSubtree(caller, id);
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

  /** Reverse a suspension (docs/06 §3.6). Won't override a SELF_EXCLUDED status. */
  async reactivate(caller: OperatorPrincipal, id: string, ctx: ActionContext) {
    await this.assertInSubtree(caller, id);
    const player = await this.system.player.findUnique({ where: { id }, select: { status: true } });
    if (!player) throw new NotFoundError("Player not found");
    if (player.status === "SELF_EXCLUDED") {
      throw new ForbiddenError("A self-excluded player cannot be reactivated here");
    }
    const updated = await this.system.player.update({
      where: { id },
      data: { status: "ACTIVE" },
      select: PLAYER_SELECT,
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "player.reactivate",
      targetType: "Player",
      targetId: id,
      after: { status: "ACTIVE" },
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
    await this.assertInSubtree(caller, id);
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
    await this.assertInSubtree(caller, id);
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

  /**
   * Defense-in-depth subtree backstop (docs/04 §2, layer 2). Every by-id player
   * read/mutation asserts the player's owning operator is within the caller's
   * subtree, so an agent can only manage its OWN players — never another agent's —
   * even if a route's @ScopeCheck were ever removed. Mirrors wallet.recharge.
   */
  private async assertInSubtree(caller: OperatorPrincipal, id: string): Promise<void> {
    const player = await this.system.player.findUnique({
      where: { id },
      select: { operator: { select: { path: true } } },
    });
    if (!player) throw new NotFoundError("Player not found");
    if (!isInSubtree(caller.path, player.operator.path)) throw new OutOfScopeError();
  }
}
