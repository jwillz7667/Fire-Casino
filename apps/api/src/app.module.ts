import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { LoggerModule } from "nestjs-pino";
import { ThrottlerModule } from "@nestjs/throttler";
import { type Env } from "@aureus/shared";
import { ConfigModule, ENV } from "./config/config.module";
import { buildLoggerParams } from "./common/logging/logger.config";
import { buildThrottlerOptions } from "./common/throttler/throttler.config";
import { SensitiveFieldsInterceptor } from "./common/serialization/sensitive-fields.interceptor";
import { RedisService } from "./redis/redis.service";
import { ScopeModule } from "./common/scope/scope.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { LedgerModule } from "./ledger/ledger.module";
import { OperatorsModule } from "./operators/operators.module";
import { OrdersModule } from "./orders/orders.module";
import { PlayersModule } from "./players/players.module";
import { GamesModule } from "./games/games.module";
import { ComplianceModule } from "./compliance/compliance.module";
import { StorageModule } from "./storage/storage.module";
import { HealthModule } from "./health/health.module";

/**
 * Web application module (HTTP + Socket.io). The ClsModule middleware
 * establishes the per-request AsyncLocalStorage store consumed by the auth
 * guards and the scoped Prisma client. Remaining domain modules (operators,
 * ledger, orders, wallet, games, redemptions, compliance, audit, realtime,
 * outbox, notifications) are added in their build phases.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env) => buildLoggerParams(env),
    }),
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    ConfigModule,
    ScopeModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [RedisService, ENV],
      useFactory: (redis: RedisService, env: Env) => buildThrottlerOptions(redis.client, env),
    }),
    AuthModule,
    AuditModule,
    StorageModule,
    ComplianceModule,
    LedgerModule,
    OperatorsModule,
    OrdersModule,
    PlayersModule,
    GamesModule,
    HealthModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: SensitiveFieldsInterceptor }],
})
export class AppModule {}
