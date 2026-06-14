import { type ThrottlerModuleOptions } from "@nestjs/throttler";
import { type Redis } from "ioredis";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { type Env } from "@aureus/shared";
import { type Principal } from "../auth/principal";

const MINUTE_MS = 60_000;

/**
 * Per-route rate-limit overrides (docs/01 §6). The decorator key `default`
 * matches the single configured throttler. Login is tracked per-IP (no principal
 * yet); money mutations are tracked per-principal (see `getTracker` below).
 */
export const AUTH_RATE_LIMIT = { default: { ttl: MINUTE_MS, limit: 10 } } as const;
export const MONEY_RATE_LIMIT = { default: { ttl: MINUTE_MS, limit: 30 } } as const;

/**
 * Redis-backed throttling (docs/01 §6: "per-IP and per-principal counters"),
 * shared across API instances so limits hold under horizontal scale. The tracker
 * keys on the authenticated principal when present, else the client IP, so an
 * authenticated abuser can't reset their counter by rotating IPs and an
 * unauthenticated one (login) is still bounded per source.
 */
export function buildThrottlerOptions(redis: Redis, env: Env): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: "default", ttl: MINUTE_MS, limit: 60 }],
    storage: new ThrottlerStorageRedisService(redis),
    errorMessage: "Too many requests, please slow down.",
    skipIf: () => env.NODE_ENV === "test",
    getTracker: (req: Record<string, unknown>): string => {
      const principal = req.principal as Principal | undefined;
      if (principal?.kind === "operator") return `op:${principal.userId}`;
      if (principal?.kind === "player") return `pl:${principal.playerId}`;
      const ip = typeof req.ip === "string" ? req.ip : "unknown";
      return `ip:${ip}`;
    },
  };
}
