import { afterEach, describe, expect, it, vi } from "vitest";
import { type PrismaClient } from "@aureus/db";
import { type RedisService } from "../redis/redis.service";
import { HealthService } from "./health.service";
import { HealthController } from "./health.controller";

describe("Readiness dependency deadlines", () => {
  afterEach(() => vi.useRealTimers());

  function service(database: () => Promise<unknown>, ping: () => Promise<boolean>) {
    return new HealthService(
      { $queryRaw: database } as unknown as PrismaClient,
      { ping } as RedisService,
    );
  }

  it("reports healthy dependencies without waiting for the deadline", async () => {
    const health = service(vi.fn().mockResolvedValue([1]), vi.fn().mockResolvedValue(true));
    await expect(health.readiness()).resolves.toEqual({
      status: "ok",
      checks: { database: true, redis: true },
    });
  });

  it("returns 503 when Redis hangs and does not accumulate pending pings", async () => {
    vi.useFakeTimers();
    const ping = vi.fn(() => new Promise<boolean>(() => undefined));
    const health = service(vi.fn().mockResolvedValue([1]), ping);
    const controller = new HealthController(health);
    // Attach the rejection handler before advancing fake time.
    const rejected = expect(controller.readiness()).rejects.toMatchObject({
      status: 503,
      response: { status: "degraded", checks: { database: true, redis: false } },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    const second = health.readiness();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(second).resolves.toMatchObject({ status: "degraded" });
    expect(ping).toHaveBeenCalledOnce();
  });

  it("bounds a stalled database query and recovers when the dependency returns", async () => {
    vi.useFakeTimers();
    let reconnect: ((result: unknown) => void) | undefined;
    const database = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reconnect = resolve;
          }),
      )
      .mockResolvedValue([1]);
    const health = service(database, vi.fn().mockResolvedValue(true));
    const stalled = health.readiness();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(stalled).resolves.toEqual({
      status: "degraded",
      checks: { database: false, redis: true },
    });
    reconnect?.([1]);
    await Promise.resolve();
    await Promise.resolve();
    await expect(health.readiness()).resolves.toMatchObject({ status: "ok" });
  });
});
