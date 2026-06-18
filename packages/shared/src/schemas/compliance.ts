import { z } from "zod";
import { zMinorNonNegative, zMinorPositive } from "../money";
import {
  amlSeveritySchema,
  amlStatusSchema,
  geoActionSchema,
  rgLimitTypeSchema,
  rgPeriodSchema,
} from "../enums";

/**
 * Compliance management contracts — docs/05 §8. The enforcement hooks
 * (checkDeposit/checkPlay/checkRedeem/checkLogin) are internal; these schemas
 * cover the admin + player-facing management endpoints that write the underlying
 * records the hooks read.
 */

// ---- geo rules ---------------------------------------------------------------

export const upsertGeoRuleSchema = z.object({
  region: z.string().min(2).max(10).transform((s) => s.toUpperCase()),
  action: geoActionSchema,
  reason: z.string().max(280).optional(),
});
export type UpsertGeoRuleInput = z.infer<typeof upsertGeoRuleSchema>;

// ---- KYC ---------------------------------------------------------------------

export const kycSubmitSchema = z.object({
  idType: z.string().min(2).max(60),
  // z.url() accepts javascript:/data: schemes, which become a stored-XSS sink when
  // rendered into an <a href> for a privileged reviewer (audit S2). Allow only
  // http(s).
  documentUrl: z
    .string()
    .url()
    .max(500)
    .refine((v) => {
      try {
        const proto = new URL(v).protocol;
        return proto === "http:" || proto === "https:";
      } catch {
        return false;
      }
    }, "Document URL must use http(s)"),
  level: z.number().int().min(1).max(3).default(1),
});
export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;

export const kycDecisionSchema = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
  reason: z.string().max(280).optional(),
  level: z.number().int().min(1).max(3).optional(),
});
export type KycDecisionInput = z.infer<typeof kycDecisionSchema>;

export const kycQueueQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type KycQueueQuery = z.infer<typeof kycQueueQuerySchema>;

export const presignKycDocSchema = z.object({
  filename: z.string().min(1).max(200),
});
export type PresignKycDocInput = z.infer<typeof presignKycDocSchema>;

// ---- responsible gaming ------------------------------------------------------

export const setRgLimitSchema = z
  .object({
    type: rgLimitTypeSchema,
    period: rgPeriodSchema,
    valueMinor: zMinorNonNegative.optional(),
    minutes: z.number().int().positive().max(1440).optional(),
  })
  .refine(
    (v) => (v.type === "SESSION_TIME" ? v.minutes !== undefined : v.valueMinor !== undefined),
    "SESSION_TIME requires minutes; other limit types require valueMinor",
  );
export type SetRgLimitInput = z.infer<typeof setRgLimitSchema>;

export const selfExcludeSchema = z.object({
  until: z.string().datetime().optional(),
  reason: z.string().max(280).optional(),
});
export type SelfExcludeInput = z.infer<typeof selfExcludeSchema>;

// ---- AML ---------------------------------------------------------------------

export const amlFlagsQuerySchema = z.object({
  severity: amlSeveritySchema.optional(),
  status: amlStatusSchema.optional(),
  subjectId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AmlFlagsQuery = z.infer<typeof amlFlagsQuerySchema>;

export const resolveAmlFlagSchema = z.object({
  resolution: z.enum(["CLEARED", "ESCALATED", "REVIEWING"]),
  note: z.string().max(280).optional(),
});
export type ResolveAmlFlagInput = z.infer<typeof resolveAmlFlagSchema>;

/** Operator-initiated manual AML flag (the "raise a flag" action in the queue). */
export const raiseAmlFlagSchema = z.object({
  subjectType: z.enum(["PLAYER", "OPERATOR"]),
  subjectId: z.string().min(1),
  ruleCode: z.string().min(2).max(60).regex(/^[A-Z0-9_]+$/, "uppercase letters, digits, underscores"),
  severity: amlSeveritySchema,
  reason: z.string().min(3).max(280),
});
export type RaiseAmlFlagInput = z.infer<typeof raiseAmlFlagSchema>;

// ---- promotions --------------------------------------------------------------

export const createPromotionSchema = z.object({
  code: z.string().min(3).max(40).transform((s) => s.toUpperCase()),
  description: z.string().max(280).optional(),
  currency: z.enum(["PLAY", "PRIZE", "CREDIT"]).default("PLAY"),
  grantMinor: zMinorPositive,
  isAmoe: z.boolean().default(false),
  maxRedemptions: z.number().int().positive().optional(),
  perPlayerLimit: z.number().int().positive().max(100).default(1),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

export const redeemPromoSchema = z.object({
  code: z.string().min(3).max(40).transform((s) => s.toUpperCase()),
});
export type RedeemPromoInput = z.infer<typeof redeemPromoSchema>;
