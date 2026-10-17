import { type ThrottlerModuleOptions } from "@nestjs/throttler";
import { type Redis } from "ioredis";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { type Env } from "@aureus/shared";

const MINUTE_MS = 60_000;

/**
 * Per-route rate-limit overrides (docs/01 §6). The decorator key `default`
 * matches the configured throttler in both guards. Public auth is limited per
 * IP; authenticated requests are limited per IP and separately per principal.
 */
export const AUTH_RATE_LIMIT = { default: { ttl: MINUTE_MS, limit: 10 } } as const;
export const MONEY_RATE_LIMIT = { default: { ttl: MINUTE_MS, limit: 30 } } as const;

/**
 * Redis-backed throttling (docs/01 §6: "per-IP and per-principal counters"),
 * shared across API instances so limits hold under horizontal scale. Separate
 * guards run before and after authentication to enforce both dimensions. Do not
 * install one guard before auth and expect req.principal to exist there.
 */
export function buildThrottlerOptions(redis: Redis, env: Env): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: "default", ttl: MINUTE_MS, limit: 60 }],
    storage: new ThrottlerStorageRedisService(redis),
    errorMessage: "Too many requests, please slow down.",
    skipIf: () => env.NODE_ENV === "test",
  };
}
