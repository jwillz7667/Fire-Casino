import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@aureus/db";
import {
  can,
  type CreateGameInput,
  type Currency,
  isInSubtree,
  type SetGameStatusInput,
  type StartSessionInput,
  type UpdateGameInput,
} from "@aureus/shared";
import { type OperatorPrincipal, type PlayerPrincipal } from "../common/auth/principal";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  OutOfScopeError,
  ValidationError,
} from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { AuditService, auditActor } from "../audit/audit.service";
import { ComplianceService } from "../compliance/compliance.service";
import { LedgerService } from "../ledger/ledger.service";
import { generateServerSeed, hashServerSeed } from "./rgs/fairness";
import { GAME_PROVIDER, type GameProvider } from "./rgs/provider";

// Guardrail band for an RTP override (docs/05 §6 "within bounds"). Below 80% is
// predatory; above 100% leaks money to players. A competent default — adjust per
// jurisdiction if a tighter band is mandated.
const RTP_MIN_BPS = 8_000;
const RTP_MAX_BPS = 10_000;

/** Scale a gross engine win to the effective RTP (effective/base), BigInt-exact. */
export function scaleWinForRtp(grossWin: bigint, effectiveBps: number, baseBps: number): bigint {
  if (effectiveBps === baseBps || baseBps <= 0) return grossWin;
  return (grossWin * BigInt(effectiveBps)) / BigInt(baseBps);
}

interface RoundRow {
  id: string;
  sessionId: string;
  nonce: number;
  betMinor: bigint;
  winMinor: bigint;
  outcome: Prisma.JsonValue;
  betTxId: string | null;
  winTxId: string | null;
}

@Injectable()
export class GamesService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(GAME_PROVIDER) private readonly provider: GameProvider,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
  ) {}

  // ---- catalog ---------------------------------------------------------------

  listCatalog(currency?: Currency) {
    return this.prisma.game.findMany({
      where: { status: "ACTIVE", ...(currency ? { supportedCurrencies: { has: currency } } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async getByCode(code: string) {
    const game = await this.prisma.game.findUnique({ where: { code } });
    if (!game) throw new NotFoundError("Game not found");
    return game;
  }

  async createGame(caller: OperatorPrincipal, input: CreateGameInput) {
    const game = await this.prisma.game.create({
      data: {
        code: input.code,
        name: input.name,
        type: input.type,
        rtpBps: input.rtpBps,
        minBetMinor: input.minBetMinor,
        maxBetMinor: input.maxBetMinor,
        supportedCurrencies: input.supportedCurrencies,
        thumbnailUrl: input.thumbnailUrl,
        config: (input.config ?? {}) as Prisma.InputJsonObject,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    await this.audit.record({ ...auditActor(caller), action: "game.create", targetType: "Game", targetId: game.id, after: { code: input.code } });
    return game;
  }

  async updateGame(caller: OperatorPrincipal, id: string, input: UpdateGameInput) {
    if (input.rtpBps !== undefined) {
      const current = await this.prisma.game.findUnique({ where: { id }, select: { rtpBps: true } });
      if (!current) throw new NotFoundError("Game not found");
      if (input.rtpBps !== current.rtpBps) {
        // Changing RTP is a distinct, bounded privilege (docs/04 §3, docs/05 §6).
        if (!can(caller.tier, caller.settings, "game.rtp_override")) {
          throw new ForbiddenError("Changing RTP requires the game.rtp_override permission");
        }
        if (input.rtpBps < RTP_MIN_BPS || input.rtpBps > RTP_MAX_BPS) {
          throw new ValidationError(undefined, `RTP must be between ${RTP_MIN_BPS} and ${RTP_MAX_BPS} bps`);
        }
      }
    }
    const game = await this.prisma.game.update({
      where: { id },
      data: {
        name: input.name,
        rtpBps: input.rtpBps,
        minBetMinor: input.minBetMinor,
        maxBetMinor: input.maxBetMinor,
        supportedCurrencies: input.supportedCurrencies,
        thumbnailUrl: input.thumbnailUrl,
        config: input.config ? (input.config as Prisma.InputJsonObject) : undefined,
        sortOrder: input.sortOrder,
      },
    });
    await this.audit.record({
      ...auditActor(caller),
      action: "game.update",
      targetType: "Game",
      targetId: id,
      after: input as Prisma.InputJsonObject,
    });
    return game;
  }

  async setStatus(caller: OperatorPrincipal, id: string, input: SetGameStatusInput) {
    const game = await this.prisma.game.update({ where: { id }, data: { status: input.status } });
    await this.audit.record({ ...auditActor(caller), action: "game.status", targetType: "Game", targetId: id, after: { status: input.status } });
    return game;
  }

  // ---- win-rate overrides (docs/06 §6.1) -------------------------------------

  /** Effective RTP for a round: per-player override → owning-agent override → game default, clamped to the band. */
  private async resolveEffectiveRtp(
    gameId: string,
    operatorId: string,
    playerId: string,
    defaultBps: number,
  ): Promise<number> {
    const overrides = await this.prisma.gameRtpOverride.findMany({
      where: { gameId, operatorId, OR: [{ playerId }, { playerId: null }] },
      select: { playerId: true, rtpBps: true },
    });
    const perPlayer = overrides.find((o) => o.playerId === playerId);
    const perAgent = overrides.find((o) => o.playerId === null);
    const resolved = perPlayer?.rtpBps ?? perAgent?.rtpBps ?? defaultBps;
    return Math.min(RTP_MAX_BPS, Math.max(RTP_MIN_BPS, resolved));
  }

  /**
   * Set an agent-level (playerId null) or per-player win-rate override. Keyed on the
   * player's OWNING operator so resolution finds it; subtree-checked, banded, audited.
   */
  async setRtpOverride(caller: OperatorPrincipal, gameCode: string, rtpBps: number, playerId: string | null) {
    if (!can(caller.tier, caller.settings, "game.rtp_agent")) {
      throw new ForbiddenError("Your tier cannot set win rates");
    }
    if (rtpBps < RTP_MIN_BPS || rtpBps > RTP_MAX_BPS) {
      throw new ValidationError(undefined, `RTP must be between ${RTP_MIN_BPS} and ${RTP_MAX_BPS} bps`);
    }
    const game = await this.prisma.game.findUnique({ where: { code: gameCode }, select: { id: true } });
    if (!game) throw new NotFoundError("Game not found");

    let operatorId = caller.operatorId;
    if (playerId) {
      const pl = await this.prisma.player.findUnique({
        where: { id: playerId },
        select: { operatorId: true, operator: { select: { path: true } } },
      });
      if (!pl) throw new NotFoundError("Player not found");
      if (!isInSubtree(caller.path, pl.operator.path)) throw new OutOfScopeError();
      operatorId = pl.operatorId; // key per-player overrides on the owning agent
    }

    const existing = await this.prisma.gameRtpOverride.findFirst({
      where: { gameId: game.id, operatorId, playerId: playerId ?? null },
      select: { id: true },
    });
    const row = existing
      ? await this.prisma.gameRtpOverride.update({ where: { id: existing.id }, data: { rtpBps, setByUserId: caller.userId } })
      : await this.prisma.gameRtpOverride.create({
          data: { gameId: game.id, operatorId, playerId: playerId ?? null, rtpBps, setByUserId: caller.userId },
        });
    await this.audit.record({
      ...auditActor(caller),
      action: "game.rtp_override_set",
      targetType: "Game",
      targetId: game.id,
      after: { gameCode, rtpBps, playerId: playerId ?? null, operatorId },
    });
    return { gameCode, rtpBps: row.rtpBps, playerId: row.playerId };
  }

  /** Clear an override (revert to the next scope up). */
  async clearRtpOverride(caller: OperatorPrincipal, gameCode: string, playerId: string | null) {
    if (!can(caller.tier, caller.settings, "game.rtp_agent")) {
      throw new ForbiddenError("Your tier cannot set win rates");
    }
    const game = await this.prisma.game.findUnique({ where: { code: gameCode }, select: { id: true } });
    if (!game) throw new NotFoundError("Game not found");
    let operatorId = caller.operatorId;
    if (playerId) {
      const pl = await this.prisma.player.findUnique({
        where: { id: playerId },
        select: { operatorId: true, operator: { select: { path: true } } },
      });
      if (!pl) throw new NotFoundError("Player not found");
      if (!isInSubtree(caller.path, pl.operator.path)) throw new OutOfScopeError();
      operatorId = pl.operatorId;
    }
    await this.prisma.gameRtpOverride.deleteMany({ where: { gameId: game.id, operatorId, playerId: playerId ?? null } });
    await this.audit.record({
      ...auditActor(caller),
      action: "game.rtp_override_clear",
      targetType: "Game",
      targetId: game.id,
      after: { gameCode, playerId: playerId ?? null },
    });
    return { gameCode, cleared: true };
  }

  /** Win-rate slider data for the agent console: every active game with its default + this agent's override. */
  async listAgentRtp(caller: OperatorPrincipal) {
    const [games, overrides] = await Promise.all([
      this.prisma.game.findMany({
        where: { status: "ACTIVE" },
        select: { code: true, name: true, rtpBps: true },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.gameRtpOverride.findMany({
        where: { operatorId: caller.operatorId, playerId: null },
        select: { gameId: true, rtpBps: true, game: { select: { code: true } } },
      }),
    ]);
    const overrideByCode = new Map(overrides.map((o) => [o.game.code, o.rtpBps]));
    return {
      minBps: RTP_MIN_BPS,
      maxBps: RTP_MAX_BPS,
      items: games.map((g) => ({
        code: g.code,
        name: g.name,
        defaultRtpBps: g.rtpBps,
        agentRtpBps: overrideByCode.get(g.code) ?? null,
        effectiveRtpBps: overrideByCode.get(g.code) ?? g.rtpBps,
      })),
    };
  }

  // ---- sessions & play -------------------------------------------------------

  async startSession(player: PlayerPrincipal, input: StartSessionInput, region?: string) {
    const game = await this.prisma.game.findUnique({ where: { code: input.gameCode } });
    if (!game || game.status !== "ACTIVE") throw new NotFoundError("Game unavailable");
    if (!game.supportedCurrencies.includes(input.currency)) {
      throw new ValidationError(undefined, "Currency not supported by this game");
    }
    await this.compliance.checkPlay(player.playerId, { region });

    const serverSeed = generateServerSeed();
    const session = await this.prisma.gameSession.create({
      data: {
        playerId: player.playerId,
        gameId: game.id,
        currency: input.currency,
        serverSeed,
        serverSeedHash: hashServerSeed(serverSeed),
        clientSeed: input.clientSeed ?? null,
      },
      select: { id: true, serverSeedHash: true, clientSeed: true, currency: true },
    });
    return {
      sessionId: session.id,
      serverSeedHash: session.serverSeedHash,
      clientSeed: session.clientSeed,
      currency: session.currency,
    };
  }

  /** Server-authoritative round (docs/05 §10). Idempotent per client bet key. */
  async placeBet(
    player: PlayerPrincipal,
    sessionId: string,
    betMinor: bigint,
    idemKey: string,
    params: Record<string, unknown> = {},
    region?: string,
  ) {
    const betKey = `round:${sessionId}:${idemKey}`;

    const existing = await this.prisma.gameRound.findUnique({ where: { idempotencyKey: betKey } });
    const session = await this.loadOwnedSession(player, sessionId);

    if (existing) {
      return this.completeRound(player, session, existing);
    }

    const game = session.game;
    if (game.status !== "ACTIVE") throw new ConflictError("Game is not available");
    if (betMinor < game.minBetMinor || betMinor > game.maxBetMinor) {
      throw new ValidationError(undefined, "Bet is outside the allowed range");
    }
    if (!game.supportedCurrencies.includes(session.currency)) {
      throw new ValidationError(undefined, "Currency not supported by this game");
    }
    // Forward the bet so the WAGER/LOSS responsible-gaming limits are enforced
    // (docs/03 §4.4, hard rule #7), not just account status + self-exclusion.
    await this.compliance.checkPlay(player.playerId, { betMinor, region });

    const balance = await this.ledger.getBalance({ kind: "player", playerId: player.playerId, currency: session.currency });
    if (balance < betMinor) throw new ConflictError("Insufficient wallet balance");

    // Reserve a unique nonce + the round shell, serialized by a session lock.
    let round: RoundRow;
    try {
      round = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM game_sessions WHERE id = ${sessionId} FOR UPDATE`;
        const max = await tx.gameRound.aggregate({ where: { sessionId }, _max: { nonce: true } });
        return tx.gameRound.create({
          data: {
            sessionId,
            nonce: (max._max.nonce ?? 0) + 1,
            betMinor,
            winMinor: 0n,
            // Stash the bet params on the pending shell so whichever request finalizes the
            // round (incl. an idempotent retry) runs the engine with the SAME inputs.
            outcome: { kind: "pending", params } as Prisma.InputJsonObject,
            idempotencyKey: betKey,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.prisma.gameRound.findUnique({ where: { idempotencyKey: betKey } });
        if (again) return this.completeRound(player, session, again);
      }
      throw e;
    }

    return this.completeRound(player, session, round);
  }

  async endSession(player: PlayerPrincipal, sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { id: true, playerId: true, status: true, serverSeed: true, serverSeedHash: true, clientSeed: true },
    });
    if (!session) throw new NotFoundError("Session not found");
    if (session.playerId !== player.playerId) throw new ForbiddenError();
    if (session.status === "ACTIVE") {
      await this.prisma.gameSession.update({ where: { id: sessionId }, data: { status: "ENDED", endedAt: new Date() } });
    }
    // Reveal the server seed for verification.
    return {
      sessionId: session.id,
      serverSeed: session.serverSeed,
      serverSeedHash: session.serverSeedHash,
      clientSeed: session.clientSeed,
    };
  }

  async getSession(player: PlayerPrincipal, sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { nonce: "asc" } } },
    });
    if (!session) throw new NotFoundError("Session not found");
    if (session.playerId !== player.playerId) throw new ForbiddenError();
    return {
      id: session.id,
      currency: session.currency,
      status: session.status,
      serverSeedHash: session.serverSeedHash,
      totalBetMinor: session.totalBetMinor.toString(),
      totalWinMinor: session.totalWinMinor.toString(),
      rounds: session.rounds.map((r) => this.roundDto(r)),
    };
  }

  // ---- internals -------------------------------------------------------------

  private async loadOwnedSession(player: PlayerPrincipal, sessionId: string) {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { game: true },
    });
    if (!session) throw new NotFoundError("Session not found");
    if (session.playerId !== player.playerId) throw new ForbiddenError();
    if (session.status !== "ACTIVE") throw new ConflictError("Session has ended");
    return session;
  }

  /** Idempotently finish a round: post bet, run RGS, post win, finalize totals. */
  private async completeRound(
    player: PlayerPrincipal,
    session: Prisma.GameSessionGetPayload<{ include: { game: true } }>,
    round: RoundRow,
  ) {
    const finalized = (round.outcome as { kind?: string }).kind !== "pending";
    if (finalized && round.betTxId) {
      return this.roundResponse(player, session.currency, round);
    }

    const currency = session.currency;
    const betResult = await this.ledger.post({
      type: "GAME_BET",
      currency,
      idempotencyKey: `round:${round.id}:bet`,
      // REVENUE legitimately runs negative intra-day (docs/03 §4.4); a bet credits
      // it but may leave it negative if prior wins drove it down — that's fine.
      allowNegative: ["REVENUE"],
      actor: { playerId: player.playerId },
      ref: { type: "GameRound", id: round.id },
      legs: [
        { account: { kind: "player", playerId: player.playerId, currency }, direction: "DEBIT", amountMinor: round.betMinor },
        { account: { kind: "system", systemKey: "REVENUE", currency }, direction: "CREDIT", amountMinor: round.betMinor },
      ],
    });

    const betParams =
      (round.outcome as { params?: Record<string, unknown> } | null)?.params ?? {};
    const result = this.provider.play({
      sessionId: round.sessionId,
      gameCode: session.game.code,
      gameType: session.game.type,
      rtpBps: session.game.rtpBps,
      betMinor: round.betMinor,
      currency,
      serverSeed: session.serverSeed ?? "",
      clientSeed: session.clientSeed ?? "",
      nonce: round.nonce,
      config: session.game.config as Record<string, unknown>,
      params: betParams,
    });

    // Apply the resolved win-rate override (player → owning-agent → game default).
    // Uniform post-spin scale by effective/base, so it works for every engine and
    // keeps the ledger exact (docs/06 §6.1, CR4). base = the game's certified RTP.
    const effectiveRtpBps = await this.resolveEffectiveRtp(
      session.gameId,
      player.operatorId,
      player.playerId,
      session.game.rtpBps,
    );
    const winMinor = scaleWinForRtp(result.winMinor, effectiveRtpBps, session.game.rtpBps);

    let winTxId: string | undefined;
    if (winMinor > 0n) {
      const winResult = await this.ledger.post({
        type: "GAME_WIN",
        currency,
        idempotencyKey: `round:${round.id}:win`,
        allowNegative: ["REVENUE"],
        actor: { playerId: player.playerId },
        ref: { type: "GameRound", id: round.id },
        legs: [
          { account: { kind: "system", systemKey: "REVENUE", currency }, direction: "DEBIT", amountMinor: winMinor },
          { account: { kind: "player", playerId: player.playerId, currency }, direction: "CREDIT", amountMinor: winMinor },
        ],
      });
      winTxId = winResult.transactionId;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.gameRound.update({
        where: { id: round.id },
        data: {
          betTxId: betResult.transactionId,
          winTxId,
          winMinor,
          outcome: result.outcome as Prisma.InputJsonObject,
        },
      });
      await tx.gameSession.update({
        where: { id: round.sessionId },
        data: { totalBetMinor: { increment: round.betMinor }, totalWinMinor: { increment: result.winMinor } },
      });
      return r;
    });

    return this.roundResponse(player, currency, updated);
  }

  private async roundResponse(player: PlayerPrincipal, currency: Currency, round: RoundRow) {
    const balanceAfter = await this.ledger.getBalance({ kind: "player", playerId: player.playerId, currency });
    return { round: this.roundDto(round), balanceAfterMinor: balanceAfter.toString() };
  }

  private roundDto(round: RoundRow) {
    return {
      id: round.id,
      nonce: round.nonce,
      betMinor: round.betMinor.toString(),
      winMinor: round.winMinor.toString(),
      outcome: round.outcome,
    };
  }
}
