import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { HealthModule } from "./health/health.module";

/**
 * Web application module (HTTP + Socket.io). Domain modules (auth, operators,
 * ledger, orders, wallet, games, redemptions, compliance, audit, reports,
 * realtime, outbox, notifications) are added in their build phases.
 */
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, HealthModule],
})
export class AppModule {}
