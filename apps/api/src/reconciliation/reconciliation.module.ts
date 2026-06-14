import { Module } from "@nestjs/common";
import { RedisModule } from "../redis/redis.module";
import { ReconciliationProcessor } from "./reconciliation.processor";
import { ReconciliationService } from "./reconciliation.service";

/**
 * Worker-side module (docs/09 Phase 13): the BullMQ scheduler/worker that runs
 * the ledger integrity sweep on a fixed interval. Imported by worker.module.ts.
 * PRISMA_SYSTEM, ENV and RedisService are global, but RedisModule is imported
 * explicitly to make the dependency visible.
 */
@Module({
  imports: [RedisModule],
  providers: [ReconciliationService, ReconciliationProcessor],
})
export class ReconciliationModule {}
