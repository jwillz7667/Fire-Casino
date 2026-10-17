"use client";

import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  operatorSummarySchema,
  type OperatorLoginInput,
  type OperatorSummary,
} from "@aureus/shared";
import { useQueryClient } from "@tanstack/react-query";
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from "./api";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface OperatorLoginResponse {
  accessToken: string;
  expiresIn: number;
  operator: OperatorSummary;
}

interface AuthContextValue {
  status: AuthStatus;
  principal: OperatorSummary | null;
  login: (input: OperatorLoginInput) => Promise<OperatorSummary>;
  logout: () => Promise<void>;
  /** Re-fetch /auth/me (e.g. after MFA enrollment changes requiresMfaEnrollment). */
  reload: () => Promise<void>;
  setPrincipal: (next: OperatorSummary) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [principal, setPrincipalState] = useState<OperatorSummary | null>(null);

  const loadMe = useCallback(async (): Promise<void> => {
    const me = await api.get<OperatorSummary>("/auth/me");
    // A refresh cookie may belong to the player app; never hydrate the
    // privileged shell from a player principal.
    operatorSummarySchema.parse(me);
    setPrincipalState(me);
    setStatus("authenticated");
  }, []);

  // On mount: try to restore the session from the refresh cookie, then hydrate
  // the principal. Any failure lands on "unauthenticated" — the shell redirects.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = await refreshSession();
      if (cancelled) return;
      if (!restored) {
        setStatus("unauthenticated");
        return;
      }
      try {
        await loadMe();
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setStatus("unauthenticated");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  // When the api client gives up on a 401, drop the principal so the guard
  // bounces the user to /login.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      queryClient.clear();
      setPrincipalState(null);
      setStatus("unauthenticated");
    });
    return () => {
      setSessionExpiredHandler(() => {
        /* no-op */
      });
    };
  }, [queryClient]);

  const login = useCallback(
    async (input: OperatorLoginInput): Promise<OperatorSummary> => {
      const res = await api.post<OperatorLoginResponse>("/auth/operator/login", input);
      // Drop cached balances, ledger rows and permissions from the previous user.
      queryClient.clear();
      setAccessToken(res.accessToken);
      setPrincipalState(res.operator);
      setStatus("authenticated");
      return res.operator;
    },
    [queryClient],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* best-effort; clear local state regardless */
    }
    setAccessToken(null);
    queryClient.clear();
    setPrincipalState(null);
    setStatus("unauthenticated");
  }, [queryClient]);

  const reload = useCallback(async (): Promise<void> => {
    await loadMe();
  }, [loadMe]);

  const setPrincipal = useCallback((next: OperatorSummary): void => {
    setPrincipalState(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, principal, login, logout, reload, setPrincipal }),
    [status, principal, login, logout, reload, setPrincipal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** The authenticated operator principal; throws if used outside an authed tree. */
export function usePrincipal(): OperatorSummary {
  const { principal } = useAuth();
  if (!principal) throw new Error("usePrincipal requires an authenticated principal");
  return principal;
}
