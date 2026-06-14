import { z } from "zod";
import { platformModeSchema } from "../env";
import { operatorTierSchema } from "../enums";

/**
 * Settings contracts — docs/05 §9, docs/06 §3.14. Platform settings are
 * super-admin only and mode/critical-money changes are audited. CREDIT_MINOR_UNITS
 * is read-only after launch and is therefore not updatable here.
 */

/** Redemption approval routing stored on Operator.settings (docs/04 §3). */
export const redemptionApprovalSchema = z.object({
  thresholdMinor: z.bigint().or(z.string().regex(/^\d+$/)).optional(),
  approverTier: operatorTierSchema.optional(),
  funding: z.enum(["AGENT_FUNDED", "UPLINE_REIMBURSED"]).default("AGENT_FUNDED"),
});
export type RedemptionApproval = z.infer<typeof redemptionApprovalSchema>;

export const updatePlatformSettingsSchema = z.object({
  PLATFORM_MODE: platformModeSchema.optional(),
  REDEMPTION_KYC_THRESHOLD_MINOR: z.coerce.number().int().nonnegative().optional(),
  DEFAULT_GAME_RTP_BPS: z.coerce.number().int().min(1).max(10_000).optional(),
  KYC_ENFORCED: z.boolean().optional(),
  GEO_ENFORCED: z.boolean().optional(),
});
export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;

/** Per-node settings a non-super-admin can change for itself (docs/06 §3.14). */
export const updateNodeSettingsSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  buyUnitPriceCents: z.number().int().nonnegative().optional(),
  sellUnitPriceCents: z.number().int().nonnegative().optional(),
  prizeBonusBps: z.number().int().min(0).max(100_000).optional(),
  redemptionApproval: redemptionApprovalSchema.optional(),
});
export type UpdateNodeSettingsInput = z.infer<typeof updateNodeSettingsSchema>;
