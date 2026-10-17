import { afterEach, describe, expect, it, vi } from "vitest";
import { type Env } from "@aureus/shared";
import { type RedisService } from "../redis/redis.service";
import { type ReconciliationService } from "./reconciliation.service";
import { ReconciliationProcessor } from "./reconciliation.processor";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  queueClose: vi.fn(),
  workerClose: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = mocks.add;
    close = mocks.queueClose;
    on = vi.fn();
  },
  Worker: class {
    close = mocks.workerClose;
    on = vi.fn();
  },
}));

describe("Reconciliation scheduler recovery", () => {
  let processor: ReconciliationProcessor | undefined;

  afterEach(async () => {
    await processor?.onModuleDestroy();
    processor = undefined;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function start(): Promise<ReconciliationProcessor> {
    vi.useFakeTimers();
    mocks.add.mockResolvedValue({});
    processor = new ReconciliationProcessor(
      { REDIS_URL: "redis://localhost:6379" } as Env,
      {} as RedisService,
      {} as ReconciliationService,
    );
    await processor.onModuleInit();
    return processor;
  }

  it("recreates a repeat schedule lost in an ephemeral Redis reset", async () => {
    await start();
    const schedule = mocks.add.mock.calls[0];
    expect(schedule?.[2]).toMatchObject({ repeat: { every: 300_000 }, jobId: "runAll" });

    // Simulate the provider losing the registered repeat key while the worker
    // process remains alive: periodic registration must restore that same key.
    mocks.add.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.add.mock.calls).toEqual([schedule]);
  });

  it("tries again after a failed schedule refresh", async () => {
    await start();
    mocks.add.mockRejectedValueOnce(new Error("Redis reconnecting"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.add).toHaveBeenCalledTimes(3);
  });

  it("does not queue overlapping registrations or refresh after shutdown", async () => {
    const active = await start();
    let release: (() => void) | undefined;
    mocks.add.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.add).toHaveBeenCalledTimes(2);
    release?.();
    await Promise.resolve();
    await active.onModuleDestroy();
    processor = undefined;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.queueClose).toHaveBeenCalledOnce();
    expect(mocks.workerClose).toHaveBeenCalledOnce();
  });
});
