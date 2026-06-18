"use client";

import { useCallback, useEffect, useRef } from "react";
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
 * Hosted Godot/WASM build on public Cloudflare R2 (bucket `goldwave`, prefix
 * cosmic-slots/v1) — served from R2 like Phoenix/Dragon (too large to bundle into the
 * Vercel deploy). The `nothreads` export needs no COOP/COEP headers.
 * NEXT_PUBLIC_COSMIC_GAME_URL overrides it. Re-upload with games/cosmic-slots/web/build.sh
 * (bump the version prefix per rebuild).
 */
const R2_GAME_URL =
  "https://pub-a2458a29274f4f5ba61f429adf2fcf8f.r2.dev/cosmic-slots/v3/index.html";
export const COSMIC_GAME_URL = process.env.NEXT_PUBLIC_COSMIC_GAME_URL ?? R2_GAME_URL;

const GAME_URL = COSMIC_GAME_URL;
// Resolve a CONCRETE origin so postMessage validates by origin (not just by `source`).
const GAME_ORIGIN = (() => {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : undefined;
    return GAME_URL ? new URL(GAME_URL, base).origin : "*";
  } catch {
    return "*";
  }
})();

/**
 * Embeds the Cosmic Slots Godot/WASM client and is the server-authoritative bridge: the
 * iframe asks to place a bet over postMessage, this owns the session and calls the Aureus
 * API, and only the returned outcome is sent back for the game to animate. The client
 * never decides a result. Balance + wallet cache stay in sync.
 */
export function CosmicGodot({
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
  const sendInitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (wallet.data) {
      balanceRef.current = balanceFor(wallet.data.wallets, currency);
      sendInitRef.current();
    }
  }, [wallet.data, currency]);

  const post = useCallback((type: string, payload: unknown, reqId?: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: "cosmic-host", type, payload, reqId },
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
    async (sessionId: string, betMinor: number, idempotencyKey: string): Promise<BetResponse> =>
      api.post<BetResponse>(
        `/sessions/${sessionId}/bet`,
        { betMinor: String(betMinor) },
        { idempotencyKey },
      ),
    [],
  );

  const handleBet = useCallback(
    async (betMinor: number, reqId: string) => {
      // One idempotency key per logical bet, REUSED on the retry — money-safe via server
      // idempotency (round:sessionId:key), so a lost-after-commit response never double-debits.
      const idempotencyKey = newIdempotencyKey();
      try {
        const session = await ensureSession();
        let result: BetResponse;
        try {
          result = await placeBet(session.sessionId, betMinor, idempotencyKey);
        } catch {
          try {
            result = await placeBet(session.sessionId, betMinor, idempotencyKey);
          } catch (retryErr) {
            sessionRef.current = null;
            throw retryErr;
          }
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
      if (!m || m.source !== "cosmic-game") return;
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
        Cosmic Slots is loading on the game server — set NEXT_PUBLIC_COSMIC_GAME_URL.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black">
      <iframe
        ref={iframeRef}
        src={GAME_URL}
        onLoad={sendInit}
        title="Cosmic Slots"
        allow="autoplay; fullscreen"
        className="h-full w-full border-0"
      />
      <Link
        href="/"
        aria-label="Back to lobby"
        style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)", left: "calc(env(safe-area-inset-left) + 0.75rem)" }}
        className="absolute left-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
    </div>
  );
}
