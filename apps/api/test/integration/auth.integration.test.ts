import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { authenticator } from "otplib";
import type { Request, Response } from "express";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { AuthService } from "../../src/auth/auth.service";
import { AuthController } from "../../src/auth/auth.controller";
import { LEGACY_REFRESH_COOKIE, REFRESH_COOKIES } from "../../src/auth/cookies";
import { LoginThrottleService } from "../../src/auth/login-throttle.service";
import { MfaCryptoService } from "../../src/auth/mfa-crypto.service";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { RedisService } from "../../src/redis/redis.service";
import { AppError } from "../../src/common/errors/domain-error";
import { type OperatorPrincipal } from "../../src/common/auth/principal";
import { IS_PUBLIC_KEY } from "../../src/common/auth/auth.decorators";
import { ComplianceService } from "../../src/compliance/compliance.service";
import { AmlService } from "../../src/compliance/aml.service";
import { PlatformSettingsProvider } from "../../src/settings/platform-settings.provider";
import { createOperator, createPlayer, resetDb, testPrisma } from "../helpers/db";

const env = loadEnv();
const passwords = new PasswordService(env);
const jwt = new JwtService({});
const tokens = new TokenService(jwt, env);
const audit = new AuditService(testPrisma);
const redis = new RedisService(env);
const throttle = new LoginThrottleService(redis);
const auth = new AuthService(
  testPrisma,
  passwords,
  tokens,
  audit,
  throttle,
  new MfaCryptoService(env),
);
const controller = new AuthController(
  auth,
  new ComplianceService(
    testPrisma,
    env,
    new PlatformSettingsProvider(testPrisma, env),
    new AmlService(testPrisma, audit),
  ),
  env,
);
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const PASSWORD = "Sup3rSecret!";

async function seedSuperAdmin(): Promise<void> {
  await createOperator({
    username: "root",
    tier: "SUPER_ADMIN",
    pathSegment: 0,
    password: PASSWORD,
  });
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
    await expect(
      auth.operatorLogin({ identifier: "root", password: "wrong" }, ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "INVALID_CREDENTIALS");
  });

  it("rejects an unknown identifier", async () => {
    await expect(
      auth.operatorLogin({ identifier: "nobody", password: PASSWORD }, ctx),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a suspended operator even when its user remains active", async () => {
    await testPrisma.operator.updateMany({ data: { status: "SUSPENDED" } });
    await expect(
      auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(await testPrisma.refreshToken.count()).toBe(0);
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
    await expect(
      auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "INVALID_CREDENTIALS");

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
    const rotated = await auth.refresh(login.refreshToken, ctx, "operator");

    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    expect(rotated.accessToken).toBeTruthy();

    // the rotated token works for a subsequent refresh
    const again = await auth.refresh(rotated.refreshToken, ctx, "operator");
    expect(again.refreshToken).not.toBe(rotated.refreshToken);
  });

  it("revokes the whole family when a used (revoked) token is replayed", async () => {
    const login = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    const rotated = await auth.refresh(login.refreshToken, ctx, "operator");

    // replay the original (now-revoked) token → reuse detected
    await expect(auth.refresh(login.refreshToken, ctx, "operator")).rejects.toBeInstanceOf(
      AppError,
    );

    // the family is now fully revoked: even the latest token is dead
    await expect(auth.refresh(rotated.refreshToken, ctx, "operator")).rejects.toBeInstanceOf(
      AppError,
    );

    const live = await testPrisma.refreshToken.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
  });

  it("rejects an unknown refresh token", async () => {
    await expect(auth.refresh("not-a-real-token", ctx, "operator")).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("allows only one concurrent use of a refresh token and revokes the replayed family", async () => {
    const login = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => auth.refresh(login.refreshToken, ctx, "operator")),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await testPrisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    expect(await testPrisma.refreshToken.count()).toBe(2);
  });

  it("cannot leave a live refresh descendant when logout races rotation", async () => {
    const login = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    await Promise.allSettled([
      auth.refresh(login.refreshToken, ctx, "operator"),
      auth.logout(login.refreshToken, "operator"),
    ]);
    expect(await testPrisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });
});

describe("AuthController — independent operator and player cookies", () => {
  beforeEach(async () => {
    await resetDb();
    await seedSuperAdmin();
    await throttle.clear("operator", "root");
    await throttle.clear("player", "arcade-player");
  });

  function browser() {
    const cookies: Record<string, string> = {};
    const response = {
      cookie: (name: string, value: string) => {
        cookies[name] = value;
      },
      clearCookie: (name: string) => {
        delete cookies[name];
      },
    } as unknown as Response;
    const request = (audience?: "operator" | "player") =>
      ({
        ip: ctx.ip,
        headers: {
          "user-agent": ctx.userAgent,
          ...(audience ? { "x-auth-audience": audience } : {}),
        },
        cookies,
      }) as unknown as Request;
    return { cookies, response, request };
  }

  it("keeps both surfaces signed in and logs out after access expiry without ending the other session", async () => {
    const b = browser();
    b.cookies[LEGACY_REFRESH_COOKIE] = "legacy-shared-session";
    const operator = await controller.operatorLogin(
      { identifier: "root", password: PASSWORD },
      b.request(),
      b.response,
    );
    await createPlayer({
      username: "arcade-player",
      operatorId: operator.operator.operatorId,
      password: PASSWORD,
    });
    await controller.playerLogin(
      { username: "arcade-player", password: PASSWORD },
      b.request(),
      b.response,
    );
    expect(Object.keys(b.cookies).sort()).toEqual(Object.values(REFRESH_COOKIES).sort());
    const [operatorRefresh, playerRefresh] = await Promise.all([
      controller.refresh(b.request("operator"), b.response),
      controller.refresh(b.request("player"), b.response),
    ]);
    await expect(tokens.verifyAccess(operatorRefresh.accessToken)).resolves.toMatchObject({
      aud: "operator",
    });
    await expect(tokens.verifyAccess(playerRefresh.accessToken)).resolves.toMatchObject({
      aud: "player",
    });
    const claims = await tokens.verifyAccess(operatorRefresh.accessToken);
    const expired = await jwt.signAsync(
      {
        sub: claims.sub,
        aud: claims.aud,
        operatorId: claims.operatorId,
        sessionId: claims.sessionId,
      },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: -1 },
    );
    await expect(tokens.verifyAccess(expired)).rejects.toThrow();
    const logoutRequest = b.request("operator");
    logoutRequest.headers.authorization = `Bearer ${expired}`;
    expect(
      // Inspect Nest metadata without invoking the unbound controller method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      new Reflector().getAllAndOverride(IS_PUBLIC_KEY, [controller.logout, AuthController]),
    ).toBe(true);
    await controller.logout(logoutRequest, b.response);
    expect(b.cookies[REFRESH_COOKIES.operator]).toBeUndefined();
    expect(b.cookies[REFRESH_COOKIES.player]).toBeTruthy();
    await expect(controller.refresh(b.request("operator"), b.response)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(controller.refresh(b.request("player"), b.response)).resolves.toHaveProperty(
      "accessToken",
    );
  });

  it("always clears the selected cookie even if it contains another surface's token", async () => {
    const b = browser();
    const login = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    b.cookies[REFRESH_COOKIES.operator] = login.refreshToken;
    b.cookies[REFRESH_COOKIES.player] = login.refreshToken;
    await expect(controller.logout(b.request("player"), b.response)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(b.cookies[REFRESH_COOKIES.player]).toBeUndefined();
    await expect(controller.refresh(b.request("operator"), b.response)).resolves.toHaveProperty(
      "accessToken",
    );
  });

  it("rejects a cookie copied across audiences and never falls back to the legacy shared cookie", async () => {
    const b = browser();
    const login = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    b.cookies[REFRESH_COOKIES.player] = login.refreshToken;
    await expect(controller.refresh(b.request("player"), b.response)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    delete b.cookies[REFRESH_COOKIES.player];
    b.cookies[LEGACY_REFRESH_COOKIE] = login.refreshToken;
    await expect(controller.refresh(b.request("operator"), b.response)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    b.cookies[REFRESH_COOKIES.operator] = login.refreshToken;
    await expect(controller.refresh(b.request(), b.response)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(controller.refresh(b.request("operator"), b.response)).resolves.toHaveProperty(
      "accessToken",
    );
  });
});

describe("AuthService — MFA enrollment", () => {
  beforeEach(async () => {
    await resetDb();
    await seedSuperAdmin();
    await throttle.clear("operator", "root");
  });

  it("confirms enrollment and prevents an access token from overwriting the enrolled factor", async () => {
    const login = await auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx);
    const claims = await tokens.verifyAccess(login.accessToken);
    const principal: OperatorPrincipal = {
      ...login.operator,
      kind: "operator",
      settings: {},
      sessionId: claims.sessionId,
    };
    const enrollment = await auth.mfaEnable(principal);
    await auth.mfaConfirm(principal, authenticator.generate(enrollment.secret));
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    expect(before.mfaEnabled).toBe(true);
    await expect(auth.mfaEnable(principal)).rejects.toMatchObject({ code: "CONFLICT" });
    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    expect(after.mfaSecret).toBe(before.mfaSecret);
    await expect(
      auth.operatorLogin({ identifier: "root", password: PASSWORD }, ctx),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await expect(
      auth.operatorLogin(
        { identifier: "root", password: PASSWORD, totp: authenticator.generate(enrollment.secret) },
        ctx,
      ),
    ).resolves.toMatchObject({ operator: { mfaEnabled: true } });
  });
});
