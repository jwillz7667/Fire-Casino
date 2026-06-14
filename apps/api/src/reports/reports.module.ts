import { Module } from "@nestjs/common";
import { ReconciliationService } from "../reconciliation/reconciliation.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * Scoped reporting + the read side of ledger health (docs/06 §3.9-3.10). The
 * reconciliation checks are shared with the worker's scheduled job; this module
 * provides ReconciliationService for the on-demand "run reconciliation now" and
 * transaction-explorer endpoints and re-exports it. Ledger, audit and config are
 * global, so no further imports are needed.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReconciliationService],
  exports: [ReconciliationService],
})
export class ReportsModule {}
