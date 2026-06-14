import { Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module";
import { OutboxRelayService } from "./outbox-relay.service";

/**
 * Worker module hosting the transactional outbox relay (docs/01 §5). RedisModule
 * is @Global and already imported by WorkerModule, but it is imported here too so
 * this module is self-contained and can be wired in any worker composition.
 */
@Module({
  imports: [RedisModule],
  providers: [OutboxRelayService],
  exports: [OutboxRelayService],
})
export class OutboxModule {}
