import { HttpException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Throttle, type ThrottlerModuleOptions, type ThrottlerStorage } from "@nestjs/throttler";
import { type PrismaClient } from "@aureus/db";
import { type PinoLogger } from "nestjs-pino";
import { describe, expect, it, vi } from "vitest";
import { type TokenService } from "../../auth/token.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { type ScopeService } from "../scope/scope.service";
import { IpThrottlerGuard, PrincipalThrottlerGuard } from "./request-throttler.guards";
import { AUTH_RATE_LIMIT, MONEY_RATE_LIMIT } from "./throttler.config";

class Routes {
  @Throttle(AUTH_RATE_LIMIT)
  login(this: void): void {}

  @Throttle(MONEY_RATE_LIMIT)
  transfer(this: void): void {}

  read(this: void): void {}
}

function context(route: keyof Routes, ip: string, userId?: string): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[route],
    getClass: () => Routes,
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        headers: { authorization: "Bearer invalid-token" },
        ...(userId ? { principal: { kind: "operator", userId } } : {}),
      }),
      getResponse: () => ({ header: vi.fn() }),
    }),
  } as unknown as ExecutionContext;
}

async function guards() {
  const hits = new Map<string, number>();
  const increment = vi.fn((key: string, _ttl: number, limit: number) => {
    const totalHits = (hits.get(key) ?? 0) + 1;
    hits.set(key, totalHits);
    return Promise.resolve({
      totalHits,
      timeToExpire: 60,
      isBlocked: totalHits > limit,
      timeToBlockExpire: 60,
    });
  });
  const storage: ThrottlerStorage = { increment };
  // These tests exercise the real throttler with active limits. The production
  // test-env skip is deliberately absent; no Redis or live database is touched.
  const options: ThrottlerModuleOptions = {
    throttlers: [{ name: "default", ttl: 60_000, limit: 60 }],
  };
  const ip = new IpThrottlerGuard(options, storage, new Reflector());
  const principal = new PrincipalThrottlerGuard(options, storage, new Reflector());
  await ip.onModuleInit();
  await principal.onModuleInit();
  return { ip, principal, hits, increment };
}

describe("IP and principal rate limits", () => {
  it("counts anonymous login only once and retains its 10/minute limit", async () => {
    const { ip, principal, hits, increment } = await guards();
    for (let i = 0; i < 10; i++) {
      const ctx = context("login", "203.0.113.1");
      await ip.canActivate(ctx);
      await principal.canActivate(ctx);
    }
    expect(increment).toHaveBeenCalledTimes(10);
    expect([...hits.values()]).toEqual([10]);
    await expect(ip.canActivate(context("login", "203.0.113.1"))).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it("creates independent principal counters for users sharing an IP", async () => {
    const { ip, principal, hits } = await guards();
    for (const user of ["alice", "bob"]) {
      const ctx = context("read", "203.0.113.1", user);
      await ip.canActivate(ctx);
      await principal.canActivate(ctx);
    }
    expect([...hits.values()].sort()).toEqual([1, 1, 2]);
  });

  it("enforces the 30/minute money limit for a principal rotating IPs", async () => {
    const { ip, principal } = await guards();
    for (let i = 1; i <= 30; i++) {
      const ctx = context("transfer", `203.0.113.${i}`, "alice");
      await ip.canActivate(ctx);
      await principal.canActivate(ctx);
    }
    const next = context("transfer", "203.0.113.31", "alice");
    await expect(ip.canActivate(next)).resolves.toBe(true);
    await expect(principal.canActivate(next)).rejects.toBeInstanceOf(HttpException);
    await expect(principal.canActivate(context("transfer", "203.0.113.31", "bob"))).resolves.toBe(
      true,
    );
  });

  it("bounds invalid-token requests before token verification at the default 60/minute", async () => {
    const { ip } = await guards();
    const verifyAccess = vi.fn().mockRejectedValue(new Error("invalid token"));
    const access = new AccessTokenGuard(
      new Reflector(),
      { verifyAccess } as unknown as TokenService,
      {} as ScopeService,
      {} as PinoLogger,
      {} as PrismaClient,
    );
    const ctx = context("read", "203.0.113.1");
    const request = async () => {
      await ip.canActivate(ctx);
      await access.canActivate(ctx);
    };
    for (let i = 0; i < 60; i++) {
      await expect(request()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(request()).rejects.toSatisfy(
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
    );
    expect(verifyAccess).toHaveBeenCalledTimes(60);
  });
});
