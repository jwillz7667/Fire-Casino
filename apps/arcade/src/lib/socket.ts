"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  playerRoom,
  type RealtimeEvent,
  realtimeEventSchema,
  type RealtimeTokenResponse,
} from "@aureus/shared";
import { api } from "./api";
import { pushAnnouncement } from "./announcements";
import { qk } from "./queries";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

    void (async () => {
      let auth: RealtimeTokenResponse;
      try {
        auth = await api.post<RealtimeTokenResponse>("/realtime/token");
      } catch {
        // Realtime is optional; refetch-on-focus covers correctness.
        return;
      }
      if (cancelled) return;

      const rooms = auth.rooms.length > 0 ? auth.rooms : playerId ? [playerRoom(playerId)] : [];

      socket = io(SOCKET_URL, {
        transports: ["websocket"],
        withCredentials: true,
        auth: { token: auth.token },
        reconnection: true,
      });

      const subscribe = (): void => {
        if (rooms.length > 0) socket?.emit("subscribe", { rooms });
      };

      socket.on("connect", subscribe);
      socket.io.on("reconnect", () => {
        subscribe();
        // A dropped/restored socket may have missed events — reconcile.
        void queryClient.invalidateQueries({ queryKey: qk.wallet });
      });

      socket.onAny((event: string, payload: unknown) => {
        const parsed = realtimeEventSchema.safeParse(event);
        if (!parsed.success) return;
        handleEvent(parsed.data, queryClient);
        if (parsed.data === "announcement") captureAnnouncement(payload);
        onEventRef.current?.(parsed.data, payload);
      });
    })();

    return () => {
      cancelled = true;
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [enabled, playerId, queryClient]);
}

function captureAnnouncement(payload: unknown): void {
  if (payload && typeof payload === "object" && "id" in payload && "title" in payload) {
    const p = payload as { id: unknown; title: unknown; body?: unknown };
    if (typeof p.id === "string" && typeof p.title === "string") {
      pushAnnouncement({ id: p.id, title: p.title, body: typeof p.body === "string" ? p.body : undefined });
    }
  }
}

function handleEvent(
  event: RealtimeEvent,
  queryClient: ReturnType<typeof useQueryClient>,
): void {
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
