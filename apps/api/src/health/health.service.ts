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
  private databaseProbe?: Promise<boolean>;
  private redisProbe?: Promise<boolean>;

  constructor(
    @Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient,
    private readonly redis: RedisService,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      this.withDeadline(this.checkDatabase()),
      this.withDeadline(this.checkRedis()),
    ]);
    return {
      status: database && redis ? "ok" : "degraded",
      checks: { database, redis },
    };
  }

  private checkDatabase(): Promise<boolean> {
    // Reuse pending probes: a dependency outage must not enqueue a new query
    // or Redis command on every health request after the HTTP deadline expires.
    this.databaseProbe ??= this.prisma.$queryRaw`SELECT 1`
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        this.databaseProbe = undefined;
      });
    return this.databaseProbe;
  }

  private checkRedis(): Promise<boolean> {
    this.redisProbe ??= this.redis
      .ping()
      .catch(() => false)
      .finally(() => {
        this.redisProbe = undefined;
      });
    return this.redisProbe;
  }

  private async withDeadline(probe: Promise<boolean>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        probe,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 2_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
