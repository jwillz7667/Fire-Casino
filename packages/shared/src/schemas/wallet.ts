import { z } from "zod";
import { zMinorPositive } from "../money";

export const rechargeSchema = z.object({
  playerId: z.string().min(1),
  amountMinor: zMinorPositive,
  unitPriceCents: z.number().int().nonnegative().optional(),
  note: z.string().max(280).optional(),
});
export type RechargeInput = z.infer<typeof rechargeSchema>;

/**
 * Agent removes credits from a player's wallet (docs/03 §4.4). The amount is
 * burned to the SINK account — the agent's balance is never credited. A reason
 * is required because the action is irreversible and audited.
 */
export const removeCreditsSchema = z.object({
  playerId: z.string().min(1),
  amountMinor: zMinorPositive,
  reason: z.string().min(1).max(280),
});
export type RemoveCreditsInput = z.infer<typeof removeCreditsSchema>;

export const rechargeRequestSchema = z.object({
  amountMinor: zMinorPositive,
  note: z.string().max(280).optional(),
});
export type RechargeRequestInput = z.infer<typeof rechargeRequestSchema>;

export const walletHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type WalletHistoryQuery = z.infer<typeof walletHistoryQuerySchema>;
