import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { AuthService } from "../../src/auth/auth.service";
import { LoginThrottleService } from "../../src/auth/login-throttle.service";
import { MfaCryptoService } from "../../src/auth/mfa-crypto.service";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { RedisService } from "../../src/redis/redis.service";
import { AppError } from "../../src/common/errors/domain-error";
import { createOperator, resetDb, testPrisma } from "../helpers/db";

const env = loadEnv();
const passwords = new PasswordService(env);
const tokens = new TokenService(new JwtService({}), env);
const audit = new AuditService(testPrisma);
const redis = new RedisService(env);
const throttle = new LoginThrottleService(redis);
const auth = new AuthService(testPrisma, passwords, tokens, audit, throttle, new MfaCryptoService(env));
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const PASSWORD = "Sup3rSecret!";

async function seedSuperAdmin(): Promise<void> {
  await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0, password: PASSWORD });
}

afterAll(async () => {
  await redis.onModuleDestroy();
  await testPrisma.$disconnect();
});

describe("AuthService — operator login", () => {
  beforeEach(async () => {
    await resetDb();
    await seedSuperAdmin();
    // Clear any lockout state so cross-run Redis counters can't make this flaky.
    await throttle.clear("operator", "root");
    await throttle.clear("operator", "nobody");
  });

  it("issues an access token and operator summary on valid credentials", async () => {
    const result = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.operator.tier).toBe("SUPER_ADMIN");
    expect(result.operator.permissions).toContain("credit.mint");

    const claims = await tokens.verifyAccess(result.accessToken);
    expect(claims.aud).toBe("operator");
    expect(claims.operatorId).toBe(result.operator.operatorId);
  });

  it("rejects an invalid password without revealing which field failed", async () => {
    await expect(auth.operatorLogin({ identifier: "root", password: "wrong" }, ctx)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "INVALID_CREDENTIALS",
    );
  });

  it("rejects an unknown identifier", async () => {
    await expect(
      auth.operatorLogin({ identifier: "nobody", password: PASSWORD }, ctx),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("locks the account after repeated failures, even with the correct password (S3)", async () => {
    await throttle.clear("operator", "root");

    // 8 wrong-password attempts trip the lockout.
    for (let i = 0; i < 8; i++) {
      await expect(
        auth.operatorLogin({ identifier: "root", password: "wrong" }, ctx),
      ).rejects.toBeInstanceOf(AppError);
    }

    // Now even the CORRECT password is rejected while locked out.
    await expect(auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "INVALID_CREDENTIALS",
    );

    // Clearing the lock (cooldown elapsed) restores access.
    await throttle.clear("operator", "root");
    const ok = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    expect(ok.accessToken).toBeTruthy();
  });
});

describe("AuthService — refresh rotation + reuse detection (docs/01 §4)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedSuperAdmin();
  });

  it("rotates the refresh token and invalidates the old one", async () => {
    const login = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    const rotated = await auth.refresh(login.refreshToken, ctx);

    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    expect(rotated.accessToken).toBeTruthy();

    // the rotated token works for a subsequent refresh
    const again = await auth.refresh(rotated.refreshToken, ctx);
    expect(again.refreshToken).not.toBe(rotated.refreshToken);
  });

  it("revokes the whole family when a used (revoked) token is replayed", async () => {
    const login = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    const rotated = await auth.refresh(login.refreshToken, ctx);

    // replay the original (now-revoked) token → reuse detected
    await expect(auth.refresh(login.refreshToken, ctx)).rejects.toBeInstanceOf(AppError);

    // the family is now fully revoked: even the latest token is dead
    await expect(auth.refresh(rotated.refreshToken, ctx)).rejects.toBeInstanceOf(AppError);

    const live = await testPrisma.refreshToken.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
  });

  it("rejects an unknown refresh token", async () => {
    await expect(auth.refresh("not-a-real-token", ctx)).rejects.toBeInstanceOf(AppError);
  });
});
