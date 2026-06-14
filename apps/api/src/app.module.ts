import { Module } from "@nestjs/common";
import { ClsModule } from "nestjs-cls";
import { ConfigModule } from "./config/config.module";
import { ScopeModule } from "./common/scope/scope.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { AuthModule } from "./auth/auth.module";
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
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    ConfigModule,
    ScopeModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
