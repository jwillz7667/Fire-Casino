"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  type RealtimeEvent,
  realtimeEventSchema,
  type RealtimeTokenResponse,
} from "@aureus/shared";
import { api } from "./api";
import { pushAnnouncement } from "./announcements";
import { qk } from "./queries";
import { API_ORIGIN } from "./env";

interface RealtimeOptions {
  enabled: boolean;
  playerId?: string;
  onEvent?: (event: RealtimeEvent, payload: unknown) => void;
}

/**
 * Connects to the realtime gateway and keeps the cache honest: balance.changed /
 * redemption.updated / order.updated / recharge.requested invalidate the
 * relevant queries so a refetch wins on reconnect. Fully defensive — if the
 * realtime token or socket is unavailable, the app keeps working on
 * refetch/polling and never throws.
 */
export function useRealtime({ enabled, playerId, onEvent }: RealtimeOptions): void {
  const queryClient = useQueryClient();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let socket: Socket | null = null;
    let cancelled = false;
    let rooms: string[] = [];
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    // The gateway disconnects sockets at token expiry. Mint again on EVERY
    // handshake so a reconnect never loops with the old expired token.
    const authProvider = (cb: (data: { token?: string }) => void): void => {
      api
        .post<RealtimeTokenResponse>("/realtime/token")
        .then((auth) => {
          if (cancelled) return;
          rooms = auth.rooms;
          cb({ token: auth.token });
        })
        .catch(() => {
          if (!cancelled) cb({});
        });
    };

    socket = io(API_ORIGIN, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      auth: authProvider,
      reconnection: true,
      reconnectionDelay: 1_000,
    });

    socket.on("connect", () => {
      if (rooms.length > 0) socket?.emit("subscribe", { rooms });
      // Refetch every affected screen after any connection, including recovery
      // from a deliberate server disconnect (not covered by Manager reconnect).
      void queryClient.invalidateQueries();
    });

    socket.on("disconnect", (reason) => {
      if (reason !== "io server disconnect" || cancelled) return;
      reconnectTimer = setTimeout(() => {
        if (!cancelled) socket?.connect();
      }, 1_000);
    });

    socket.onAny((event: string, payload: unknown) => {
      const parsed = realtimeEventSchema.safeParse(event);
      if (!parsed.success) return;
      handleEvent(parsed.data, queryClient);
      if (parsed.data === "announcement") captureAnnouncement(payload);
      onEventRef.current?.(parsed.data, payload);
    });

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [enabled, playerId, queryClient]);
}

function captureAnnouncement(payload: unknown): void {
  if (payload && typeof payload === "object" && "id" in payload && "title" in payload) {
    const p = payload as { id: unknown; title: unknown; body?: unknown };
    if (typeof p.id === "string" && typeof p.title === "string") {
      pushAnnouncement({
        id: p.id,
        title: p.title,
        body: typeof p.body === "string" ? p.body : undefined,
      });
    }
  }
}

function handleEvent(event: RealtimeEvent, queryClient: ReturnType<typeof useQueryClient>): void {
  switch (event) {
    case "balance.changed":
    case "session.round":
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      void queryClient.invalidateQueries({ queryKey: qk.walletHistory });
      break;
    case "recharge.requested":
    case "order.updated":
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      void queryClient.invalidateQueries({ queryKey: qk.walletHistory });
      break;
    case "redemption.updated":
    case "redemption.queued":
      void queryClient.invalidateQueries({ queryKey: qk.redemptions });
      void queryClient.invalidateQueries({ queryKey: qk.wallet });
      break;
    case "announcement":
    case "aml.flagged":
    case "player.created":
      break;
  }
}
