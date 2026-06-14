import { z } from "zod";
import { ADMIN_ROOM, operatorRoom, type OperatorTier, playerRoom } from "@aureus/shared";
import { type Principal } from "../common/auth/principal";

/**
 * Pure room-scoping rules (docs/05 §11). No DI, no DB — unit-testable in
 * isolation. A client may only ever join rooms inside its principal scope:
 *   - player  → its own `player:{id}` room only
 *   - operator → its own `operator:{id}` room, any descendant `operator:{id}`
 *     room (resolved with a DB subtree check the gateway performs), and, for
 *     SUPER_ADMIN/ADMIN tiers, the `admin:global` room
 * The descendant-operator case cannot be decided here (it needs the target's
 * materialized path), so `canJoinRoom` returns a `check-operator` marker the
 * gateway resolves against the DB.
 */

export function isAdminTier(tier: OperatorTier): boolean {
  return tier === "SUPER_ADMIN" || tier === "ADMIN";
}

/** The single room a principal owns (auto-joined on connect). */
export function selfRoom(principal: Principal): string {
  return principal.kind === "operator"
    ? operatorRoom(principal.operatorId)
    : playerRoom(principal.playerId);
}

/**
 * Rooms a principal is unconditionally allowed to join without a DB check:
 * its own room, plus `admin:global` for admin tiers. Descendant operator rooms
 * are intentionally not enumerated (potentially unbounded) — they are joined
 * on demand via an explicit subscribe + subtree check.
 */
export function allowedRoomsFor(principal: Principal): string[] {
  if (principal.kind === "player") return [playerRoom(principal.playerId)];
  const rooms = [operatorRoom(principal.operatorId)];
  if (isAdminTier(principal.tier)) rooms.push(ADMIN_ROOM);
  return rooms;
}

export type RoomDecision =
  | { kind: "allow" }
  | { kind: "deny" }
  /** Gateway must load the operator and verify it is within the caller's subtree. */
  | { kind: "check-operator"; operatorId: string };

type ParsedRoom =
  | { type: "admin" }
  | { type: "player"; id: string }
  | { type: "operator"; id: string };

function parseRoom(room: string): ParsedRoom | null {
  if (room === ADMIN_ROOM) return { type: "admin" };
  const idx = room.indexOf(":");
  if (idx <= 0) return null;
  const prefix = room.slice(0, idx);
  const id = room.slice(idx + 1);
  if (!id) return null;
  if (prefix === "player") return { type: "player", id };
  if (prefix === "operator") return { type: "operator", id };
  return null;
}

/**
 * Decide whether `principal` may join `room`. For operator rooms outside the
 * caller's own id, pass `isDescendantOperator` to resolve synchronously (e.g.
 * in tests); omit it to receive a `check-operator` marker for the gateway to
 * resolve against the DB.
 */
export function canJoinRoom(
  principal: Principal,
  room: string,
  isDescendantOperator?: (operatorId: string) => boolean,
): RoomDecision {
  const parsed = parseRoom(room);
  if (!parsed) return { kind: "deny" };

  if (parsed.type === "admin") {
    return principal.kind === "operator" && isAdminTier(principal.tier)
      ? { kind: "allow" }
      : { kind: "deny" };
  }

  if (parsed.type === "player") {
    return principal.kind === "player" && principal.playerId === parsed.id
      ? { kind: "allow" }
      : { kind: "deny" };
  }

  // operator room
  if (principal.kind !== "operator") return { kind: "deny" };
  if (parsed.id === principal.operatorId) return { kind: "allow" };
  if (isDescendantOperator) {
    return isDescendantOperator(parsed.id) ? { kind: "allow" } : { kind: "deny" };
  }
  return { kind: "check-operator", operatorId: parsed.id };
}

/**
 * Transport contract for the outbox relay → gateway bridge. The worker has no
 * Socket.io server, so it publishes each outbox event as JSON on this Redis
 * channel; every web node subscribes and re-emits to its *local* sockets only,
 * so each connected client receives exactly one copy regardless of node count.
 */
export const REALTIME_RELAY_CHANNEL = "realtime:relay";

export const relayMessageSchema = z.object({
  rooms: z.array(z.string()).min(1),
  event: z.string().min(1),
  payload: z.unknown(),
});
export type RelayMessage = z.infer<typeof relayMessageSchema>;
