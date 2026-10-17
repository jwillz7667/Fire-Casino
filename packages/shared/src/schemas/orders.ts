import { z } from "zod";
import { creditOrderStatusSchema } from "../enums";
import { zMinorPositive } from "../money";

// These URLs are rendered as links in the privileged console. A syntactically
// valid URL may still be an executable javascript: or data: payload.
export const proofUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  }, "Proof URL must use http(s)");

export const createOrderSchema = z.object({
  quantityMinor: zMinorPositive,
  note: z.string().max(280).optional(),
  paymentMethod: z.string().max(40).optional(),
  paymentRef: z.string().max(120).optional(),
  proofUrl: proofUrlSchema.optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const markOrderPaidSchema = z.object({
  paymentMethod: z.string().min(1).max(40),
  paymentRef: z.string().max(120).optional(),
  proofUrl: proofUrlSchema.optional(),
});
export type MarkOrderPaidInput = z.infer<typeof markOrderPaidSchema>;

export const rejectOrderSchema = z.object({
  reason: z.string().max(280).optional(),
});
export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;

export const listOrdersQuerySchema = z.object({
  role: z.enum(["buyer", "seller"]).default("buyer"),
  status: creditOrderStatusSchema.optional(),
  // When set, list every order where this operator is buyer or seller (its full
  // order history on the operator-detail Orders tab). Must be in the caller's
  // subtree — enforced server-side. Overrides `role`.
  operatorId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const presignProofSchema = z.object({
  filename: z.string().min(1).max(160),
});
export type PresignProofInput = z.infer<typeof presignProofSchema>;
