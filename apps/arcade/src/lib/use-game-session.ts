"use client";

import { useCallback, useEffect, useRef } from "react";
import { type Currency, startSessionSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import type { EndSessionResponse, StartSessionResponse } from "@/lib/types";

/**
 * How long the app may be backgrounded and still RESUME the same game session on
 * return. Below this, a return is treated as a quick app-switch (keep playing the
 * same session); at or beyond it, returning forces a brand-new session.
 *
 * Owner rule: leaving a game ⇒ a new session is required on return, EXCEPT a short
 * app-switch. Aligned with the auth background-timeout (10 min): a background+return
 * within 10 min keeps the same session (keep playing); beyond it — by which point the
 * auth session has also expired and forced a re-login — a fresh session opens.
 */
export const SESSION_RESUME_GRACE_MS = 600_000;

interface UseGameSessionArgs {
  gameCode: string;
  currency: Currency;
}

interface GameSession {
  /** Cached session, lazily created on first call (one create per session). */
  ensureSession: () => Promise<StartSessionResponse>;
  /** End the cached session server-side (best-effort) and drop it locally. */
  endSessionNow: () => void;
  /** Drop the cached session locally WITHOUT a server end (poisoned session). */
  resetSession: () => void;
}

/**
 * Owns a single game session's lifecycle for a Godot bridge component:
 * lazily creates the session on first bet, caches it across bets, and enforces the
 * leave-the-game policy. Real navigation away (unmount) ends the session, so the
 * next visit starts fresh; a quick app-switch (background < grace) keeps the same
 * session. Bet placement, idempotency, balances and the postMessage bridge stay in
 * the component — only session create/cache/end lives here.
 */
export function useGameSession({ gameCode, currency }: UseGameSessionArgs): GameSession {
  const sessionRef = useRef<StartSessionResponse | null>(null);

  const ensureSession = useCallback(async (): Promise<StartSessionResponse> => {
    if (sessionRef.current) return sessionRef.current;
    const body = startSessionSchema.parse({
      gameCode,
      currency,
      clientSeed: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    });
    const session = await api.post<StartSessionResponse>("/sessions", body);
    sessionRef.current = session;
    return session;
  }, [gameCode, currency]);

  const resetSession = useCallback((): void => {
    sessionRef.current = null;
  }, []);

  const endSessionNow = useCallback((): void => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    // Fire-and-forget: the player is gone, so a failed/expired end must not throw.
    void api.post<EndSessionResponse>(`/sessions/${session.sessionId}/end`).catch(() => {});
  }, []);

  // Real navigation away (component unmount) ends the session ⇒ a fresh one opens on
  // return. The app-switch exception is handled by the visibilitychange effect below.
  useEffect(() => {
    return () => {
      endSessionNow();
    };
  }, [endSessionNow]);

  // App-switch exception. We never end the session merely on `hidden` (the player may
  // be returning immediately); we only DECIDE on return: a long background (>= grace)
  // forces a new session, a quick one keeps the current session.
  useEffect(() => {
    let hiddenAt: number | null = null;
    function onVisibility(): void {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt === null) return;
      const elapsed = Date.now() - hiddenAt;
      hiddenAt = null;
      if (elapsed >= SESSION_RESUME_GRACE_MS) endSessionNow();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [endSessionNow]);

  return { ensureSession, endSessionNow, resetSession };
}
