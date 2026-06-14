import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { type HealthService, type ReadinessReport } from "./health.service";

const makeService = (report: ReadinessReport): HealthService =>
  ({ readiness: vi.fn().mockResolvedValue(report) }) as unknown as HealthService;

describe("HealthController", () => {
  it("returns ok for liveness", () => {
    const controller = new HealthController(makeService({ status: "ok", checks: { database: true, redis: true } }));
    expect(controller.liveness()).toEqual({ status: "ok" });
  });

  it("returns the report when ready", async () => {
    const report: ReadinessReport = { status: "ok", checks: { database: true, redis: true } };
    const controller = new HealthController(makeService(report));
    await expect(controller.readiness()).resolves.toEqual(report);
  });

  it("throws 503 when a dependency is degraded", async () => {
    const report: ReadinessReport = { status: "degraded", checks: { database: false, redis: true } };
    const controller = new HealthController(makeService(report));
    await expect(controller.readiness()).rejects.toBeInstanceOf(HttpException);
  });
});
