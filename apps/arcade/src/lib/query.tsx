"use client";

import { type ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@aureus/ui";
import { ApiError } from "./api";
import { AuthProvider } from "./auth-context";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Reconnect/refocus refetches truth — the server is authoritative
        // (docs/07 §3). Don't retry 4xx; those are deterministic.
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/** Root client providers: TanStack Query + Toasts + Auth. */
export function Providers({ children }: { children: ReactNode }): ReactNode {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
