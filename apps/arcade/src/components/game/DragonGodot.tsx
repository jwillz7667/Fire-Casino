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
 * dragon-hoard/v1) — the ~46MB build is too large to bundle into the Vercel deploy, so
 * it is served from R2 like Phoenix. The `nothreads` export needs no COOP/COEP headers.
 * NEXT_PUBLIC_DRAGON_GAME_URL overrides it (e.g. a different CDN or a local build).
 * Re-upload with games/dragon-hoard/web/build.sh (bump the version prefix per rebuild).
 */
const R2_GAME_URL =
  "https://pub-a2458a29274f4f5ba61f429adf2fcf8f.r2.dev/dragon-hoard/v2/index.html";
export const DRAGON_GAME_URL = process.env.NEXT_PUBLIC_DRAGON_GAME_URL ?? R2_GAME_URL;

const GAME_URL = DRAGON_GAME_URL;
// Resolve a CONCRETE origin so postMessage validates by origin (not just by `source`).
// The default is a relative same-origin path, so resolve it against the page origin;
// an absolute NEXT_PUBLIC_DRAGON_GAME_URL keeps its own origin. SSR (no window) yields
// "*", but the listener/post only run client-side after the module loads in the browser.
const GAME_ORIGIN = (() => {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : undefined;
    return GAME_URL ? new URL(GAME_URL, base).origin : "*";
  } catch {
    return "*";
  }
})();

/**
 * Embeds the Dragon's Hoard Bonanza Godot/WASM client and is the server-authoritative
 * bridge: the iframe asks to place a bet over postMessage, this owns the session and
 * calls the Aureus API, and only the returned outcome is sent back for the game to
 * animate. The client never decides a result. Balance + wallet cache stay in sync.
 */
export function DragonGodot({
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

  // The Godot client is responsive (portrait-native on phones, landscape on desktop):
  // it reads the real viewport and re-lays-out itself, so the iframe simply fills the
  // screen in its natural orientation — no rotation hack needed.
  const sendInitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (wallet.data) {
      balanceRef.current = balanceFor(wallet.data.wallets, currency);
      sendInitRef.current();
    }
  }, [wallet.data, currency]);

  const post = useCallback((type: string, payload: unknown, reqId?: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: "dragon-host", type, payload, reqId },
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
      // One idempotency key per logical bet, REUSED on the retry. The server dedupes on
      // round:sessionId:key, so if the first attempt actually committed but its response
      // was lost (timeout / gateway 5xx after commit), the retry collapses to the same
      // round — never a second, independent debit.
      const idempotencyKey = newIdempotencyKey();
      try {
        const session = await ensureSession();
        let result: BetResponse;
        try {
          result = await placeBet(session.sessionId, betMinor, idempotencyKey);
        } catch {
          try {
            // Retry the SAME (session, key) once — money-safe via server idempotency.
            result = await placeBet(session.sessionId, betMinor, idempotencyKey);
          } catch (retryErr) {
            // Still failing: drop the (possibly expired) session so the NEXT spin opens a
            // fresh one, and surface the error instead of ever placing a new bet.
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
      if (!m || m.source !== "dragon-game") return;
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
        Dragon&apos;s Hoard Bonanza is loading on the game server — set NEXT_PUBLIC_DRAGON_GAME_URL.
      </div>
    );
  }

  // Full-screen overlay: the Godot canvas fills the viewport and its responsive layout
  // adapts to the real shape (portrait on phones, landscape on desktop).
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black">
      <iframe
        ref={iframeRef}
        src={GAME_URL}
        onLoad={sendInit}
        title="Dragon's Hoard Bonanza"
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
