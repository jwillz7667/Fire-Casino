import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";

/**
 * Worker application module (BullMQ consumers + outbox relay). Shares the same
 * domain providers as the web app; processors are registered here in later
 * phases (outbox relay, AML scan, settlement, reports, RG enforcement, KYC poll
 * — docs/01 §7). For Phase 0 it boots the shared infrastructure only.
 */
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule],
})
export class WorkerModule {}
