import { z } from "zod";
import { operatorTierSchema } from "../enums";
import { zMinorPositive } from "../money";

export const createOperatorSchema = z.object({
  tier: operatorTierSchema,
  displayName: z.string().min(1).max(120),
  username: z.string().min(3).max(60),
  tempPassword: z.string().min(8).max(128),
  parentId: z.string().optional(), // defaults to the caller; if set, must be in subtree
  buyUnitPriceCents: z.number().int().nonnegative().optional(),
  sellUnitPriceCents: z.number().int().nonnegative().optional(),
  settings: z.record(z.unknown()).optional(),
});
export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;

export const updateOperatorSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  buyUnitPriceCents: z.number().int().nonnegative().nullable().optional(),
  sellUnitPriceCents: z.number().int().nonnegative().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
});
export type UpdateOperatorInput = z.infer<typeof updateOperatorSchema>;

export const listOperatorsQuerySchema = z.object({
  parentId: z.string().optional(),
  scope: z.enum(["children", "subtree"]).default("children"),
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
