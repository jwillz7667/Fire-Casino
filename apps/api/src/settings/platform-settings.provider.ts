import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import { type Env, type PlatformMode } from "@aureus/shared";
import { ENV } from "../config/config.module";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";

interface RuntimeSettings {
  mode: PlatformMode;
  kycThresholdMinor: bigint;
  defaultRtpBps: number;
  kycEnforced: boolean;
  geoEnforced: boolean;
}

// Settings change rarely; a short TTL bounds cross-instance staleness without a
// pub/sub layer, and updatePlatform() invalidates the local cache immediately.
const CACHE_TTL_MS = 15_000;

/**
 * Runtime view of PlatformSetting rows with env fallbacks (docs/06 §3.14, CR6).
 * Enforcement code (compliance, games) reads CURRENT settings through this
 * provider instead of boot-time env, so toggling KYC/GEO enforcement or the KYC
 * threshold in the console takes effect without a restart. Cached briefly and
 * invalidated on write.
 */
@Injectable()
export class PlatformSettingsProvider {
  private cache: RuntimeSettings | null = null;
  private cachedAt = 0;

  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Drop the cache so the next read reflects a just-written setting. */
  invalidate(): void {
    this.cache = null;
  }

  async kycEnforced(): Promise<boolean> {
    return (await this.load()).kycEnforced;
  }

  async geoEnforced(): Promise<boolean> {
    return (await this.load()).geoEnforced;
  }

  async kycThresholdMinor(): Promise<bigint> {
    return (await this.load()).kycThresholdMinor;
  }

  async defaultRtpBps(): Promise<number> {
    return (await this.load()).defaultRtpBps;
  }

  private async load(): Promise<RuntimeSettings> {
    const now = Date.now();
    if (this.cache && now - this.cachedAt < CACHE_TTL_MS) return this.cache;

    const rows = await this.prisma.platformSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));

    const settings: RuntimeSettings = {
      mode: this.readMode(byKey.get("PLATFORM_MODE")),
      kycThresholdMinor: this.readBigInt(
        byKey.get("REDEMPTION_KYC_THRESHOLD_MINOR"),
        BigInt(this.env.REDEMPTION_KYC_THRESHOLD_MINOR),
      ),
      defaultRtpBps: this.readNumber(byKey.get("DEFAULT_GAME_RTP_BPS"), this.env.DEFAULT_GAME_RTP_BPS),
      kycEnforced: this.readBool(byKey.get("KYC_ENFORCED"), true),
      geoEnforced: this.readBool(byKey.get("GEO_ENFORCED"), true),
    };
    this.cache = settings;
    this.cachedAt = now;
    return settings;
  }

  private readMode(value: unknown): PlatformMode {
    return value === "COMPLIANCE" || value === "OPERATOR" ? value : this.env.PLATFORM_MODE;
  }

  private readBool(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  private readNumber(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(n) ? n : fallback;
  }

  private readBigInt(value: unknown, fallback: bigint): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
    return fallback;
  }
}

/**
 * Global so the compliance and games enforcement paths can inject the provider
 * without import wiring (mirrors ConfigModule). PRISMA_SYSTEM and ENV are global.
 */
@Global()
@Module({
  providers: [PlatformSettingsProvider],
  exports: [PlatformSettingsProvider],
})
export class PlatformSettingsModule {}
