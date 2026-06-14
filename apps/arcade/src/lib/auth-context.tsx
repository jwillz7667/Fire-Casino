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
