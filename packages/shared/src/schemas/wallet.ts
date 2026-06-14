import { z } from "zod";
import { zMinorPositive } from "../money";

export const rechargeSchema = z.object({
  playerId: z.string().min(1),
  amountMinor: zMinorPositive,
  unitPriceCents: z.number().int().nonnegative().optional(),
  note: z.string().max(280).optional(),
});
export type RechargeInput = z.infer<typeof rechargeSchema>;

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
