import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeController } from "./realtime.controller";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";

/**
 * Realtime web module (docs/05 §11): the Socket.io gateway, the handshake-token
 * endpoint, and the principal-loading service. Imports AuthModule for
 * TokenService; ledger/audit are not needed here. The outbox relay that feeds
 * this gateway runs in the worker (OutboxModule).
 */
@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeGateway, RealtimeService],
})
export class RealtimeModule {}
