import { z } from "zod";
import { playerStatusSchema } from "../enums";

export const createPlayerSchema = z.object({
  username: z.string().min(3).max(60),
  tempPassword: z.string().min(8).max(128),
  displayName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(160).optional(),
});
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;

export const updatePlayerSchema = z.object({
  displayName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(160).optional(),
});
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;

export const listPlayersQuerySchema = z.object({
  operatorId: z.string().optional(),
  status: playerStatusSchema.optional(),
  q: z.string().max(60).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListPlayersQuery = z.infer<typeof listPlayersQuerySchema>;

export const resetPlayerPasswordSchema = z.object({
  tempPassword: z.string().min(8).max(128),
});
export type ResetPlayerPasswordInput = z.infer<typeof resetPlayerPasswordSchema>;

export const transferPlayerSchema = z.object({
  toOperatorId: z.string().min(1),
});
export type TransferPlayerInput = z.infer<typeof transferPlayerSchema>;

/**
 * Unified per-player timeline (docs/05 §4). Cursor is an ISO timestamp; the
 * server merges ledger entries, game sessions, and redemptions ordered by time.
 */
export const playerHistoryQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PlayerHistoryQuery = z.infer<typeof playerHistoryQuerySchema>;

/** Round-level drill-down of a single play session (cursor is the last round id). */
export const sessionRoundsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SessionRoundsQuery = z.infer<typeof sessionRoundsQuerySchema>;
