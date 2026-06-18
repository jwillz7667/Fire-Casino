"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { RealtimeEvent } from "@aureus/shared";
import { api } from "./api";
import { API_ORIGIN } from "./env";

interface RealtimeTokenResponse {
  token: string;
  rooms: string[];
  expiresInSeconds: number;
}

export type RealtimeHandler = (event: RealtimeEvent, payload: Record<string, unknown>) => void;

// Map an inbound event to the query-key roots that should refetch. The socket is
// an optimization: on reconnect we refetch everything so a dropped event never
// leaves the UI stale (docs/05 §11 — "refetch wins").
const INVALIDATION: Record<RealtimeEvent, string[]> = {
  "balance.changed": ["self-balance", "ledger-drawer", "operator", "operators", "player", "players", "reports"],
  "order.updated": ["orders", "order", "reports", "notifications"],
  "recharge.requested": ["notifications", "reports", "players"],
  "player.created": ["players", "notifications"],
  "redemption.updated": ["redemptions", "redemption", "reports", "notifications"],
  "redemption.queued": ["redemptions", "reports", "notifications"],
  "aml.flagged": ["aml", "notifications"],
  announcement: ["announcements", "notifications"],
  "session.round": ["player", "reports"],
};

function invalidateForEvent(client: QueryClient, event: RealtimeEvent): void {
  const roots = INVALIDATION[event];
  for (const root of roots) {
    void client.invalidateQueries({ queryKey: [root] });
  }
}

/**
 * Subscribe to the principal's realtime rooms and reconcile the query cache on
 * server events. Fully defensive: if the token mint or socket connection fails,
 * the hook silently no-ops and the app keeps working off normal refetches.
 */
export function useRealtime(enabled: boolean, onEvent?: RealtimeHandler): void {
  const queryClient = useQueryClient();
  const handlerRef = useRef<RealtimeHandler | undefined>(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let socket: Socket | null = null;
    let rooms: string[] = [];

    // Mint a FRESH token for every (re)connection attempt. The server disconnects
    // a socket when its access token expires, so reusing a stale token would loop;
    // re-minting also reloads the principal server-side, making this the path that
    // drops a deactivated account. A failed mint yields no token → the handshake is
    // rejected and socket.io retries later (the app still works off refetches).
    const authProvider = (cb: (data: { token?: string }) => void): void => {
      api
        .post<RealtimeTokenResponse>("/realtime/token")
        .then((res) => {
          rooms = res.rooms;
          cb({ token: res.token });
        })
        .catch(() => { cb({}); });
    };

    socket = io(API_ORIGIN, {
      auth: authProvider,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
    });

    const subscribe = (): void => {
      if (rooms.length > 0) socket?.emit("subscribe", { rooms });
    };

    socket.on("connect", () => {
      subscribe();
      // A (re)connect may have missed events — reconcile broadly.
      void queryClient.invalidateQueries();
    });

    const events = Object.keys(INVALIDATION) as RealtimeEvent[];
    for (const event of events) {
      socket.on(event, (payload: Record<string, unknown>) => {
        invalidateForEvent(queryClient, event);
        handlerRef.current?.(event, payload ?? {});
      });
    }

    return () => {
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [enabled, queryClient]);
}
