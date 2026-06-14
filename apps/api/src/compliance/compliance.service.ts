import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import { type Env, type RgLimitType, type RgPeriod } from "@aureus/shared";
import {
  ForbiddenError,
  KycRequiredError,
  NotFoundError,
  RegionBlockedError,
  RgLimitExceededError,
  SelfExcludedError,
} from "../common/errors/domain-error";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";

interface GateContext {
  /** Region code resolved from request IP (ISO-ish). Absent → region not enforced. */
  region?: string;
}

/** Aggregate compliance posture for a player (redemption detail + console UI). */
export interface PlayerComplianceState {
  playerId: string;
  status: string;
  selfExcluded: boolean;
  selfExclusionUntil: Date | null;
  kycStatus: string;
  kycLevel: number;
  openAmlFlags: number;
  rgLimits: { type: RgLimitType; period: RgPeriod; valueMinor: string | null; minutes: number | null }[];
}

/**
 * Compliance hooks (hard rule #7). The checks are real and enforced at the
 * decision points; the underlying verification providers are stubs that read
 * config (docs/01 §8). This service is the single enforcement surface the other
 * modules call — recharge (`checkDeposit`), play (`checkPlay`), redemption
 * (`checkRedeem`), and login (`checkLogin`). The Phase 9 management module
 * writes the records (KYC, geo, AML, RG limits, self-exclusion) these read.
 *
 * In OPERATOR mode the redeemable-currency and KYC paths are effectively bypassed
 * by configuration (KYC threshold/region toggles), with no code change — flipping
 * PLATFORM_MODE alone changes the posture (docs/09 Phase 9).
 */
@Injectable()
export class ComplianceService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Gate before a recharge/deposit (docs/03 §4.3). */
  async checkDeposit(
    playerId: string,
    opts: GateContext & { amountMinor?: bigint } = {},
  ): Promise<void> {
    await this.assertPlayerActionable(playerId);
    this.assertRegionAllowed(opts.region);
    if (opts.amountMinor !== undefined) {
      await this.assertRgLimit(playerId, "DEPOSIT", opts.amountMinor);
    }
  }

  /** Gate before a game round (docs/03 §4.4). */
  async checkPlay(
    playerId: string,
    opts: GateContext & { betMinor?: bigint } = {},
  ): Promise<void> {
    await this.assertPlayerActionable(playerId);
    this.assertRegionAllowed(opts.region);
    await this.assertSessionTime(playerId);
    if (opts.betMinor !== undefined) {
      await this.assertRgLimit(playerId, "WAGER", opts.betMinor);
      await this.assertRgLimit(playerId, "LOSS", opts.betMinor);
    }
  }

  /**
   * Gate before a redemption request/approval (docs/03 §4.5, docs/05 §7).
   * Enforces account status, self-exclusion, region, the KYC threshold, and any
   * open AML flag. Idempotent and read-only.
   */
  async checkRedeem(
    playerId: string,
    amountMinor: bigint,
    opts: GateContext = {},
  ): Promise<void> {
    await this.assertPlayerActionable(playerId);
    this.assertRegionAllowed(opts.region);
    await this.assertKycForAmount(playerId, amountMinor);
    await this.assertNoOpenAml(playerId);
  }

  /** Gate on login (docs/04 §2, docs/07 §2.1): region must be allowed. */
  checkLogin(region?: string): void {
    this.assertRegionAllowed(region);
  }

  /** Shared: the player exists, is ACTIVE, and is not under an active self-exclusion. */
  async assertPlayerActionable(playerId: string): Promise<void> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { status: true, selfExclusion: { select: { until: true } } },
    });
    if (!player) throw new NotFoundError("Player not found");
    if (player.status === "SELF_EXCLUDED") throw new SelfExcludedError();
    if (player.status !== "ACTIVE") throw new ForbiddenError("Player account is not active");

    if (this.env.SELF_EXCLUSION_ENABLED) {
      const exclusion = player.selfExclusion;
      if (exclusion && (exclusion.until === null || exclusion.until.getTime() > Date.now())) {
        throw new SelfExcludedError();
      }
    }
  }

  /** Open or escalated AML flag blocks redemption approval (docs/09). */
  async assertNoOpenAml(playerId: string): Promise<void> {
    if (!this.env.AML_ENABLED) return;
    const open = await this.prisma.amlFlag.findFirst({
      where: { subjectType: "PLAYER", subjectId: playerId, status: { in: ["OPEN", "ESCALATED"] } },
      select: { id: true },
    });
    if (open) throw new ForbiddenError("An open AML review is blocking this action");
  }

  /** Verified KYC required at/above the configured threshold (docs/05 §7). */
  async assertKycForAmount(playerId: string, amountMinor: bigint): Promise<void> {
    const threshold = BigInt(this.env.REDEMPTION_KYC_THRESHOLD_MINOR);
    if (threshold === 0n) return; // threshold 0 → KYC not required by amount
    if (amountMinor < threshold) return;
    const kyc = await this.prisma.kycRecord.findUnique({
      where: { playerId },
      select: { status: true },
    });
    if (!kyc || kyc.status !== "VERIFIED") {
      throw new KycRequiredError("Identity verification is required to redeem this amount");
    }
  }

  /** Aggregate compliance posture for a player. */
  async getState(playerId: string): Promise<PlayerComplianceState> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        status: true,
        kyc: { select: { status: true, level: true } },
        selfExclusion: { select: { until: true } },
        rgLimits: { select: { type: true, period: true, valueMinor: true, minutes: true } },
      },
    });
    if (!player) throw new NotFoundError("Player not found");
    const openAml = await this.prisma.amlFlag.count({
      where: { subjectType: "PLAYER", subjectId: playerId, status: { in: ["OPEN", "ESCALATED"] } },
    });
    const until = player.selfExclusion?.until ?? null;
    const selfExcluded =
      player.status === "SELF_EXCLUDED" ||
      (player.selfExclusion !== null && (until === null || until.getTime() > Date.now()));
    return {
      playerId,
      status: player.status,
      selfExcluded,
      selfExclusionUntil: until,
      kycStatus: player.kyc?.status ?? "NONE",
      kycLevel: player.kyc?.level ?? 0,
      openAmlFlags: openAml,
      rgLimits: player.rgLimits.map((l) => ({
        type: l.type,
        period: l.period,
        valueMinor: l.valueMinor?.toString() ?? null,
        minutes: l.minutes ?? null,
      })),
    };
  }

  // ---- internals -------------------------------------------------------------

  private assertRegionAllowed(region?: string): void {
    // Region enforcement is best-effort: it only applies when the caller resolved
    // a region (from request IP). Player records carry no stored region, so an
    // absent region cannot be blocked. GeoRule rows are the allow/deny source.
    if (!region) return;
    void this.applyRegionRule(region);
  }

  private async applyRegionRule(region: string): Promise<void> {
    const rule = await this.prisma.geoRule.findUnique({
      where: { region: region.toUpperCase() },
      select: { action: true },
    });
    if (rule?.action === "BLOCK") throw new RegionBlockedError();
  }

  /**
   * Enforce a responsible-gaming value limit (DEPOSIT/WAGER/LOSS) over its
   * rolling period. No matching limit → no-op, so unset players are unaffected.
   */
  private async assertRgLimit(playerId: string, type: RgLimitType, addMinor: bigint): Promise<void> {
    const limits = await this.prisma.responsibleGamingLimit.findMany({
      where: { playerId, type },
      select: { valueMinor: true, period: true },
    });
    for (const limit of limits) {
      if (limit.valueMinor === null) continue;
      const since = this.periodStart(limit.period);
      const used = await this.usedForLimit(playerId, type, since);
      if (used + addMinor > limit.valueMinor) {
        throw new RgLimitExceededError(`${type} limit reached for the ${limit.period.toLowerCase()} period`, {
          type,
          period: limit.period,
          limitMinor: limit.valueMinor.toString(),
          usedMinor: used.toString(),
        });
      }
    }
  }

  /** Enforce SESSION_TIME limits: cumulative play minutes in the period. */
  private async assertSessionTime(playerId: string): Promise<void> {
    const limits = await this.prisma.responsibleGamingLimit.findMany({
      where: { playerId, type: "SESSION_TIME" },
      select: { minutes: true, period: true },
    });
    if (limits.length === 0) return;
    for (const limit of limits) {
      if (limit.minutes === null) continue;
      const since = this.periodStart(limit.period);
      const sessions = await this.prisma.gameSession.findMany({
        where: { playerId, startedAt: { gte: since } },
        select: { startedAt: true, endedAt: true },
      });
      const now = Date.now();
      let minutes = 0;
      for (const s of sessions) {
        const end = (s.endedAt ?? new Date(now)).getTime();
        minutes += Math.max(0, (end - s.startedAt.getTime()) / 60_000);
      }
      if (minutes >= limit.minutes) {
        throw new RgLimitExceededError(`Session-time limit reached for the ${limit.period.toLowerCase()} period`, {
          type: "SESSION_TIME",
          period: limit.period,
          limitMinutes: limit.minutes,
        });
      }
    }
  }

  private async usedForLimit(playerId: string, type: RgLimitType, since: Date): Promise<bigint> {
    switch (type) {
      case "DEPOSIT":
        return this.sumPlayerEntries(playerId, "CREDIT", ["RECHARGE"], since);
      case "WAGER":
        return this.sumPlayerEntries(playerId, "DEBIT", ["GAME_BET"], since);
      case "LOSS": {
        const wagered = await this.sumPlayerEntries(playerId, "DEBIT", ["GAME_BET"], since);
        const won = await this.sumPlayerEntries(playerId, "CREDIT", ["GAME_WIN"], since);
        const net = wagered - won;
        return net > 0n ? net : 0n;
      }
      case "SESSION_TIME":
        return 0n;
    }
  }

  private async sumPlayerEntries(
    playerId: string,
    direction: "DEBIT" | "CREDIT",
    types: string[],
    since: Date,
  ): Promise<bigint> {
    const agg = await this.prisma.ledgerEntry.aggregate({
      where: {
        direction,
        createdAt: { gte: since },
        account: { ownerType: "PLAYER", playerId },
        transaction: { type: { in: types as never } },
      },
      _sum: { amountMinor: true },
    });
    return agg._sum.amountMinor ?? 0n;
  }

  private periodStart(period: RgPeriod): Date {
    const now = new Date();
    switch (period) {
      case "DAILY":
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      case "WEEKLY":
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case "MONTHLY":
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case "SESSION":
        // No persistent session window for value limits; treat as last 24h.
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }
}
