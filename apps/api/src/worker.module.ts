import { Module } from "@nestjs/common";
import { ClsModule } from "nestjs-cls";
import { LoggerModule } from "nestjs-pino";
import { type Env } from "@aureus/shared";
import { ConfigModule, ENV } from "./config/config.module";
import { ScopeModule } from "./common/scope/scope.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { OutboxModule } from "./realtime/outbox.module";
import { ReconciliationModule } from "./reconciliation/reconciliation.module";
import { buildLoggerParams } from "./common/logging/logger.config";

/**
 * Worker application module (BullMQ consumers + outbox relay). Shares the domain
 * providers with the web app; processors are registered in later phases (outbox
 * relay, AML scan, settlement, reports, RG enforcement, KYC poll — docs/01 §7).
 * ClsModule is provided (without HTTP middleware) so the shared PrismaModule's
 * scoped-client factory can resolve ClsService; worker code uses prismaSystem.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env) => buildLoggerParams(env),
    }),
    ClsModule.forRoot({ global: true }),
    ConfigModule,
    ScopeModule,
    PrismaModule,
    RedisModule,
    OutboxModule,
    ReconciliationModule,
  ],
})
export class WorkerModule {}
