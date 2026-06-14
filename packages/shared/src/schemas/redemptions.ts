import { z } from "zod";
import { zMinorPositive } from "../money";
import { redemptionStatusSchema } from "../enums";

/**
 * Redemption (cashout) request/response contracts — docs/05 §7, docs/03 §4.5.
 * Only PRIZE (compliance) or CREDIT (operator) redeems; PLAY never does. The
 * redeemable currency is decided server-side from PLATFORM_MODE, so the client
 * never names it.
 */
export const createRedemptionSchema = z.object({
  amountMinor: zMinorPositive,
  method: z.string().min(2).max(60),
  payoutDetails: z.record(z.string(), z.string().max(280)).optional(),
});
export type CreateRedemptionInput = z.infer<typeof createRedemptionSchema>;

export const listRedemptionsQuerySchema = z.object({
  status: redemptionStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListRedemptionsQuery = z.infer<typeof listRedemptionsQuerySchema>;

export const redemptionQueueQuerySchema = z.object({
  status: redemptionStatusSchema.optional(),
  playerId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RedemptionQueueQuery = z.infer<typeof redemptionQueueQuerySchema>;

export const rejectRedemptionSchema = z.object({
  reason: z.string().min(2).max(280),
});
export type RejectRedemptionInput = z.infer<typeof rejectRedemptionSchema>;

export const settleRedemptionSchema = z.object({
  payoutRef: z.string().min(1).max(120),
  proofUrl: z.string().url().max(500).optional(),
});
export type SettleRedemptionInput = z.infer<typeof settleRedemptionSchema>;

export const cancelRedemptionSchema = z.object({
  reason: z.string().max(280).optional(),
});
export type CancelRedemptionInput = z.infer<typeof cancelRedemptionSchema>;
