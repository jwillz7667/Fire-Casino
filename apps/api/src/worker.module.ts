import { Module } from "@nestjs/common";
import { ClsModule } from "nestjs-cls";
import { ConfigModule } from "./config/config.module";
import { ScopeModule } from "./common/scope/scope.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";

/**
 * Worker application module (BullMQ consumers + outbox relay). Shares the domain
 * providers with the web app; processors are registered in later phases (outbox
 * relay, AML scan, settlement, reports, RG enforcement, KYC poll — docs/01 §7).
 * ClsModule is provided (without HTTP middleware) so the shared PrismaModule's
 * scoped-client factory can resolve ClsService; worker code uses prismaSystem.
 */
@Module({
  imports: [
    ClsModule.forRoot({ global: true }),
    ConfigModule,
    ScopeModule,
    PrismaModule,
    RedisModule,
  ],
})
export class WorkerModule {}
