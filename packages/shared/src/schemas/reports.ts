import { z } from "zod";

/**
 * Reporting contracts — docs/05 §9. All report queries are scoped server-side to
 * the caller's subtree; an explicit operatorId narrows further (and is itself
 * subtree-checked). Date bounds are ISO timestamps.
 */

const isoDate = z.string().datetime();

export const reportRangeQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  operatorId: z.string().optional(),
});
export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;

export const reportGranularitySchema = z.enum(["day", "week", "month"]);
export type ReportGranularity = z.infer<typeof reportGranularitySchema>;

export const creditFlowQuerySchema = reportRangeQuerySchema.extend({
  granularity: reportGranularitySchema.default("day"),
});
export type CreditFlowQuery = z.infer<typeof creditFlowQuerySchema>;

export const reportTypeSchema = z.enum([
  "credit-flow",
  "player-activity",
  "agent-sales",
  "revenue",
  "margin",
  "settlement",
  "redemptions",
]);
export type ReportType = z.infer<typeof reportTypeSchema>;

export const exportReportSchema = z.object({
  type: reportTypeSchema,
  format: z.enum(["csv"]).default("csv"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  operatorId: z.string().optional(),
});
export type ExportReportInput = z.infer<typeof exportReportSchema>;

export const auditQuerySchema = z.object({
  actorId: z.string().optional(),
  actorType: z.enum(["USER", "PLAYER", "SYSTEM"]).optional(),
  action: z.string().max(120).optional(),
  targetType: z.string().max(60).optional(),
  targetId: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** Transaction explorer lookup on the ledger-health page (docs/06 §3.10). */
export const ledgerTxLookupSchema = z.object({
  id: z.string().optional(),
  idempotencyKey: z.string().optional(),
});
export type LedgerTxLookup = z.infer<typeof ledgerTxLookupSchema>;
