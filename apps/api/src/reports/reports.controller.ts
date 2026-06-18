import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import {
  type CreditFlowQuery,
  creditFlowQuerySchema,
  type ExportReportInput,
  exportReportSchema,
  type LedgerTxLookup,
  ledgerTxLookupSchema,
  type ReportRangeQuery,
  reportRangeQuerySchema,
} from "@aureus/shared";
import { Auth, CurrentUser, RequirePermission } from "../common/auth/auth.decorators";
import { type OperatorPrincipal } from "../common/auth/principal";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ReportsService } from "./reports.service";

@Controller("reports")
@Auth("operator")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("overview")
  @RequirePermission("report.view")
  overview(@CurrentUser() caller: OperatorPrincipal) {
    return this.reports.overview(caller);
  }

  @Get("activity")
  @RequirePermission("report.view")
  activity(@CurrentUser() caller: OperatorPrincipal) {
    return this.reports.activity(caller);
  }

  @Get("credit-flow")
  @RequirePermission("report.view")
  creditFlow(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(creditFlowQuerySchema)) query: CreditFlowQuery,
  ) {
    return this.reports.creditFlow(caller, query);
  }

  @Get("redemptions")
  @RequirePermission("report.view")
  redemptions(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(reportRangeQuerySchema)) query: ReportRangeQuery,
  ) {
    return this.reports.redemptionsReport(caller, query);
  }

  @Get("player-activity")
  @RequirePermission("report.view")
  playerActivity(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(reportRangeQuerySchema)) query: ReportRangeQuery,
  ) {
    return this.reports.playerActivity(caller, query);
  }

  /** Per-agent holdings + credits sold/removed to players (R3, docs/06 §3.9). */
  @Get("agent-sales")
  @RequirePermission("report.view")
  agentSales(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(reportRangeQuerySchema)) query: ReportRangeQuery,
  ) {
    return this.reports.agentSales(caller, query);
  }

  @Get("revenue")
  @RequirePermission("report.view")
  revenue(
    @CurrentUser() caller: OperatorPrincipal,
    @Query(new ZodValidationPipe(reportRangeQuerySchema)) query: ReportRangeQuery,
  ) {
    return this.reports.revenue(caller, query);
  }

  @Get("margin")
  @RequirePermission("report.view")
  margin(@CurrentUser() caller: OperatorPrincipal) {
    return this.reports.margin(caller);
  }

  @Get("settlement")
  @RequirePermission("report.view")
  settlement(@CurrentUser() caller: OperatorPrincipal) {
    return this.reports.settlement(caller);
  }

  // ---- ledger health (admin/finance) — static sub-path before the bare one ---

  @Get("ledger-health/transaction")
  @RequirePermission("report.ledger_health")
  lookupTransaction(@Query(new ZodValidationPipe(ledgerTxLookupSchema)) query: LedgerTxLookup) {
    return this.reports.lookupTransaction(query);
  }

  @Get("ledger-health")
  @RequirePermission("report.ledger_health")
  ledgerHealth() {
    return this.reports.ledgerHealth();
  }

  /** Run the integrity sweep on demand (the "run reconciliation now" button, docs/06 §3.10). */
  @Post("ledger-health/run")
  @HttpCode(200)
  @RequirePermission("report.ledger_health")
  runReconciliation() {
    return this.reports.ledgerHealth();
  }

  @Post("export")
  @HttpCode(200)
  @RequirePermission("report.view")
  export(
    @CurrentUser() caller: OperatorPrincipal,
    @Body(new ZodValidationPipe(exportReportSchema)) body: ExportReportInput,
  ) {
    return this.reports.exportCsv(caller, body);
  }
}
