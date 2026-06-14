import { z } from "zod";

/**
 * Realtime (Socket.io) contracts — docs/05 §11. Clients may only subscribe to
 * rooms within their principal scope; the server validates every room name
 * against the principal before joining. All state changes originate from
 * OutboxEvent rows relayed by the worker, never from the client.
 */

/** The server→client event names emitted from the outbox (docs/05 §11). */
export const realtimeEventSchema = z.enum([
  "balance.changed",
  "order.updated",
  "recharge.requested",
  "player.created",
  "redemption.updated",
  "redemption.queued",
  "aml.flagged",
  "announcement",
  "session.round",
]);
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

/** A room name pattern: `player:{id}`, `operator:{id}`, or `admin:global`. */
const roomName = z.string().regex(/^(player:[\w-]+|operator:[\w-]+|admin:global)$/, "INVALID_ROOM");

export const subscribeSchema = z.object({
  rooms: z.array(roomName).min(1).max(50),
});
export type SubscribeInput = z.infer<typeof subscribeSchema>;

/** Response of POST /realtime/token: a short-lived socket auth token + the rooms it permits. */
export interface RealtimeTokenResponse {
  token: string;
  rooms: string[];
  expiresInSeconds: number;
}

/** Room helpers (single definition shared by API + clients). */
export const playerRoom = (playerId: string): string => `player:${playerId}`;
export const operatorRoom = (operatorId: string): string => `operator:${operatorId}`;
export const ADMIN_ROOM = "admin:global" as const;
