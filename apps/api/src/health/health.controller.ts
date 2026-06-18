import { Controller, Get, HttpCode, HttpException, HttpStatus } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../common/auth/auth.decorators";
import { HealthService, type ReadinessReport } from "./health.service";

@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up. No dependencies checked. */
  @Get("healthz")
  @HttpCode(HttpStatus.OK)
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness: dependencies (DB + Redis) reachable. 503 if degraded. */
  @Get("readyz")
  async readiness(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== "ok") {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
