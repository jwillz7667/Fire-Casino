import { z } from "zod";
import { creditOrderStatusSchema } from "../enums";
import { zMinorPositive } from "../money";

export const createOrderSchema = z.object({
  quantityMinor: zMinorPositive,
  note: z.string().max(280).optional(),
  paymentMethod: z.string().max(40).optional(),
  paymentRef: z.string().max(120).optional(),
  proofUrl: z.string().url().max(500).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const markOrderPaidSchema = z.object({
  paymentMethod: z.string().min(1).max(40),
  paymentRef: z.string().max(120).optional(),
  proofUrl: z.string().url().max(500).optional(),
});
export type MarkOrderPaidInput = z.infer<typeof markOrderPaidSchema>;

export const rejectOrderSchema = z.object({
  reason: z.string().max(280).optional(),
});
export type RejectOrderInput = z.infer<typeof rejectOrderSchema>;

export const listOrdersQuerySchema = z.object({
  role: z.enum(["buyer", "seller"]).default("buyer"),
  status: creditOrderStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const presignProofSchema = z.object({
  filename: z.string().min(1).max(160),
});
export type PresignProofInput = z.infer<typeof presignProofSchema>;
