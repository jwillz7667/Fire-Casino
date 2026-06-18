import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

export type LoginScope = "operator" | "player";

// Tuned so normal mistyping never locks a user, but credential-stuffing does.
const MAX_FAILURES = 8; // failures within the window before a lockout
const WINDOW_SECONDS = 900; // 15m rolling window for counting failures
const LOCKOUT_SECONDS = 900; // 15m lockout once the threshold is crossed

/**
 * Per-identifier login lockout (security audit S3). The per-IP throttler is
 * trivially bypassed by rotating source IPs; this counts failures against the
 * account identifier (in Redis, so it holds across web instances) and locks the
 * account for a cooldown once the threshold is crossed. Applied to both the
 * password and the TOTP step. Lockout state is surfaced to the caller only as a
 * generic invalid-credentials error to avoid account enumeration.
 */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly redis: RedisService) {}

  private failKey(scope: LoginScope, id: string): string {
    return `login:fail:${scope}:${id.toLowerCase()}`;
  }

  private lockKey(scope: LoginScope, id: string): string {
    return `login:lock:${scope}:${id.toLowerCase()}`;
  }

  /** True when the identifier is currently locked out. */
  async isLocked(scope: LoginScope, id: string): Promise<boolean> {
    return (await this.redis.client.exists(this.lockKey(scope, id))) === 1;
  }

  /**
   * Record a failed attempt and lock the account once it crosses the threshold.
   * Returns true if this failure triggered (or extended) a lockout.
   */
  async recordFailure(scope: LoginScope, id: string): Promise<boolean> {
    const key = this.failKey(scope, id);
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, WINDOW_SECONDS);
    if (count >= MAX_FAILURES) {
      await this.redis.client.set(this.lockKey(scope, id), "1", "EX", LOCKOUT_SECONDS);
      await this.redis.client.del(key);
      return true;
    }
    return false;
  }

  /** Clear failure + lockout state after a successful authentication. */
  async clear(scope: LoginScope, id: string): Promise<void> {
    await this.redis.client.del(this.failKey(scope, id), this.lockKey(scope, id));
  }
}
