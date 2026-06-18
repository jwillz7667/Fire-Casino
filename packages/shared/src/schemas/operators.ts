import { z } from "zod";
import { operatorTierSchema } from "../enums";
import { zMinorPositive } from "../money";
import { GRANTABLE_PERMISSIONS } from "../permissions";

/**
 * Operator-configurable settings. Deliberately a CLOSED set (`.strict()`):
 * `permissions` is NOT a member, so the generic create/update path can never
 * write a grant. Permissions are conferred only through the dedicated, gated
 * grants endpoint (docs/04 §3, prevents self-escalation — see permissions.ts).
 */
export const operatorSettingsSchema = z
  .object({
    redemptionApproval: z.enum(["self", "upline"]).optional(),
    locale: z.string().min(2).max(20).optional(),
    timezone: z.string().min(1).max(60).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type OperatorSettingsInput = z.infer<typeof operatorSettingsSchema>;

export const createOperatorSchema = z.object({
  tier: operatorTierSchema,
  displayName: z.string().min(1).max(120),
  username: z.string().min(3).max(60),
  tempPassword: z.string().min(8).max(128),
  parentId: z.string().optional(), // defaults to the caller; if set, must be in subtree
  buyUnitPriceCents: z.number().int().nonnegative().optional(),
  sellUnitPriceCents: z.number().int().nonnegative().optional(),
  settings: operatorSettingsSchema.optional(),
});
export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;

export const updateOperatorSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  buyUnitPriceCents: z.number().int().nonnegative().nullable().optional(),
  sellUnitPriceCents: z.number().int().nonnegative().nullable().optional(),
  settings: operatorSettingsSchema.optional(),
});
export type UpdateOperatorInput = z.infer<typeof updateOperatorSchema>;

/** Body for the gated grants endpoint: the full set of granted permissions. */
export const setOperatorGrantsSchema = z.object({
  permissions: z.array(z.enum(GRANTABLE_PERMISSIONS)).max(GRANTABLE_PERMISSIONS.length),
});
export type SetOperatorGrantsInput = z.infer<typeof setOperatorGrantsSchema>;

export const listOperatorsQuerySchema = z.object({
  parentId: z.string().optional(),
  scope: z.enum(["children", "subtree"]).default("children"),
  q: z.string().max(120).optional(), // matches displayName or username (case-insensitive)
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListOperatorsQuery = z.infer<typeof listOperatorsQuerySchema>;

export const issueCreditsSchema = z.object({
  operatorId: z.string().min(1),
  quantityMinor: zMinorPositive,
  memo: z.string().max(280).optional(),
});
export type IssueCreditsInput = z.infer<typeof issueCreditsSchema>;

export const transferCreditsSchema = z.object({
  toOperatorId: z.string().min(1),
  quantityMinor: zMinorPositive,
  unitPriceCents: z.number().int().nonnegative().optional(),
  memo: z.string().max(280).optional(),
});
export type TransferCreditsInput = z.infer<typeof transferCreditsSchema>;
