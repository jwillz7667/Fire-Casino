"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { startSessionSchema, type Currency } from "@aureus/shared";
import { api } from "@/lib/api";
import { messageForError } from "@/lib/errors";
import { useWallet } from "@/lib/hooks";
import { newIdempotencyKey } from "@/lib/idempotency";
import { balanceFor } from "@/lib/mode";
import { qk } from "@/lib/queries";
import type { BetResponse, GameDTO, StartSessionResponse, WalletResponse } from "@/lib/types";

/**
 * Hosted Godot/WASM build, served SAME-ORIGIN from the arcade's own static dir
 * (public/royal-ascendant/v1). The `nothreads` export needs no COOP/COEP headers, so
 * a plain static host (Vercel) serves it — no external CDN/R2 step. The env var can
 * still override it (e.g. to move the build to a CDN later).
 */
const SAME_ORIGIN_URL = "/royal-ascendant/v3/index.html";
export const ROYAL_GAME_URL = process.env.NEXT_PUBLIC_ROYAL_GAME_URL ?? SAME_ORIGIN_URL;

const GAME_URL = ROYAL_GAME_URL;
const GAME_ORIGIN = (() => {
  try {
    return GAME_URL ? new URL(GAME_URL).origin : "*";
  } catch {
    return "*"; // relative same-origin path → postMessage validates by `source`
  }
})();

/**
 * Embeds the Royal Ascendant Godot/WASM client and is the server-authoritative
 * bridge: the iframe asks to place a bet over postMessage, this owns the session and
 * calls the Aureus API, and only the returned outcome is sent back for the game to
 * animate. The client never decides a result. Balance + wallet cache stay in sync.
 */
export function RoyalGodot({
  game,
  currency,
}: {
  game: GameDTO;
  currency: Currency;
}): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const sessionRef = useRef<StartSessionResponse | null>(null);
  const balanceRef = useRef<string>("0");

  // The game is landscape (1280×720). On a portrait phone, fitting 16:9 into a tall
  // screen leaves huge black bars, so rotate the iframe 90° to fill the long axis
  // (the player turns the phone to play). In landscape it fills upright.
  const [frameStyle, setFrameStyle] = useState<React.CSSProperties>({ width: "100%", height: "100%" });
  useEffect(() => {
    function apply(): void {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (h > w) {
        setFrameStyle({
          position: "absolute",
          width: `${h}px`,
          height: `${w}px`,
          left: `${(w - h) / 2}px`,
          top: `${(h - w) / 2}px`,
          transform: "rotate(90deg)",
          transformOrigin: "center center",
        });
      } else {
        setFrameStyle({ width: "100%", height: "100%", transform: "none" });
      }
    }
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  const sendInitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (wallet.data) {
      balanceRef.current = balanceFor(wallet.data.wallets, currency);
      sendInitRef.current();
    }
  }, [wallet.data, currency]);

  const post = useCallback((type: string, payload: unknown, reqId?: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: "royal-host", type, payload, reqId },
      GAME_ORIGIN,
    );
  }, []);

  const sendInit = useCallback(() => {
    post("init", {
      balanceMinor: balanceRef.current,
      currency,
      minBetMinor: game.minBetMinor,
      maxBetMinor: game.maxBetMinor,
    });
  }, [post, currency, game.minBetMinor, game.maxBetMinor]);

  useEffect(() => {
    sendInitRef.current = sendInit;
  }, [sendInit]);

  const ensureSession = useCallback(async (): Promise<StartSessionResponse> => {
    if (sessionRef.current) return sessionRef.current;
    const body = startSessionSchema.parse({
      gameCode: game.code,
      currency,
      clientSeed: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    });
    const session = await api.post<StartSessionResponse>("/sessions", body);
    sessionRef.current = session;
    return session;
  }, [game.code, currency]);

  const placeBet = useCallback(
    async (sessionId: string, betMinor: number): Promise<BetResponse> =>
      api.post<BetResponse>(
        `/sessions/${sessionId}/bet`,
        { betMinor: String(betMinor) },
        { idempotencyKey: newIdempotencyKey() },
      ),
    [],
  );

  const handleBet = useCallback(
    async (betMinor: number, reqId: string) => {
      try {
        let session = await ensureSession();
        let result: BetResponse;
        try {
          result = await placeBet(session.sessionId, betMinor);
        } catch {
          sessionRef.current = null;
          session = await ensureSession();
          result = await placeBet(session.sessionId, betMinor);
        }
        balanceRef.current = result.balanceAfterMinor;
        queryClient.setQueryData<WalletResponse>(qk.wallet, (prev) =>
          prev
            ? {
                wallets: prev.wallets.map((w) =>
                  w.currency === currency ? { ...w, balanceMinor: result.balanceAfterMinor } : w,
                ),
              }
            : prev,
        );
        void queryClient.invalidateQueries({ queryKey: qk.wallet });
        void queryClient.invalidateQueries({ queryKey: qk.walletHistory });
        post("betResult", { outcome: result.round.outcome, balanceAfterMinor: result.balanceAfterMinor }, reqId);
      } catch (err) {
        post("betError", { message: messageForError(err) }, reqId);
      }
    },
    [ensureSession, placeBet, queryClient, currency, post],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      if (GAME_ORIGIN !== "*" && e.origin !== GAME_ORIGIN) return;
      const m = e.data as { source?: string; type?: string; reqId?: string; payload?: { betMinor?: number } };
      if (!m || m.source !== "royal-game") return;
      if (m.type === "requestInit") {
        sendInit();
      } else if (m.type === "placeBet" && m.payload && typeof m.payload.betMinor === "number") {
        void handleBet(m.payload.betMinor, m.reqId ?? "");
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [sendInit, handleBet]);

  if (!GAME_URL) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-hairline bg-surface-1 text-center text-sm text-text-mid">
        Royal Ascendant is loading on the game server — set NEXT_PUBLIC_ROYAL_GAME_URL.
      </div>
    );
  }

  // Full-screen overlay: the Godot canvas fills the viewport and its stretch system
  // letterboxes the 1280×720 landscape design to fit.
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black">
      <iframe
        ref={iframeRef}
        src={GAME_URL}
        onLoad={sendInit}
        title="Royal Ascendant"
        allow="autoplay; fullscreen"
        className="border-0"
        style={frameStyle}
      />
      <Link
        href="/"
        aria-label="Back to lobby"
        className="absolute left-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
    </div>
  );
}
