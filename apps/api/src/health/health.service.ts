import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient } from "@aureus/db";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import { RedisService } from "../redis/redis.service";

export interface ReadinessReport {
  status: "ok" | "degraded";
  checks: { database: boolean; redis: boolean };
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly redis: RedisService,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return {
      status: database && redis ? "ok" : "degraded",
      checks: { database, redis },
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return await this.redis.ping();
    } catch {
      return false;
    }
  }
}
