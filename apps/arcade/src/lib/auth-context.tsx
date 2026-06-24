"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  type PlatformMode,
  type PlayerLoginInput,
  type PlayerSummary,
} from "@aureus/shared";
import { api, setAccessToken, setAuthLostHandler, tryRefresh } from "./api";
import { detectMode } from "./mode";

interface AuthContextValue {
  player: PlayerSummary | null;
  /** True once the initial session-restore attempt has settled. */
  ready: boolean;
  isAuthenticated: boolean;
  mode: PlatformMode;
  login: (input: PlayerLoginInput) => Promise<PlayerSummary>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * How long the app may be backgrounded before the player is forced to log back in.
 * A short app-switch (switch to another app and return quickly) keeps the player
 * logged in so they can resume playing; a background of >= 10 minutes expires the
 * session and bounces to login. This is auth-level — leaving a game does NOT log out
 * (that only ends the game session and returns to the lobby).
 */
const AUTH_BACKGROUND_TIMEOUT_MS = 600_000;

interface PlayerLoginResponse {
  accessToken: string;
  expiresIn: number;
  player: PlayerSummary;
}

function isPlayerSummary(value: OperatorOrPlayer): value is PlayerSummary {
  return "playerId" in value;
}

type OperatorOrPlayer = PlayerSummary | { userId: string };

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [player, setPlayer] = useState<PlayerSummary | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  const refreshMe = useCallback(async () => {
    const me = await api.get<OperatorOrPlayer>("/auth/me");
    if (isPlayerSummary(me)) setPlayer(me);
  }, []);

  // Restore the session on mount via the refresh cookie, then load /auth/me.
  useEffect(() => {
    let active = true;
    void (async () => {
      const ok = await tryRefresh();
      if (ok) {
        try {
          const me = await api.get<OperatorOrPlayer>("/auth/me");
          if (active && isPlayerSummary(me)) setPlayer(me);
        } catch {
          // No valid session; fall through to unauthenticated.
        }
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Hard auth loss (refresh failed mid-session): drop the principal and bounce
  // to login unless we're already there.
  useEffect(() => {
    setAuthLostHandler(() => {
      setAccessToken(null);
      setPlayer(null);
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        router.replace("/login");
      }
    });
    return () => {
      setAuthLostHandler(null);
    };
  }, [router]);

  const login = useCallback(async (input: PlayerLoginInput) => {
    const res = await api.post<PlayerLoginResponse>("/auth/player/login", input);
    setAccessToken(res.accessToken);
    setPlayer(res.player);
    return res.player;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Best-effort; clear local state regardless.
    }
    setAccessToken(null);
    setPlayer(null);
    router.replace("/login");
  }, [router]);

  // Force a re-login after a long background. We only DECIDE on return: never log out
  // merely on `hidden` (the player may be switching back immediately). A background of
  // >= AUTH_BACKGROUND_TIMEOUT_MS expires the session; a shorter one keeps them in.
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
      if (elapsed >= AUTH_BACKGROUND_TIMEOUT_MS && player !== null) {
        void logout();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [logout, player]);

  const mode = useMemo<PlatformMode>(
    () => (player ? detectMode(player.wallets) : "OPERATOR"),
    [player],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      player,
      ready,
      isAuthenticated: player !== null,
      mode,
      login,
      logout,
      refreshMe,
    }),
    [player, ready, mode, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
