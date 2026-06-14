"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@aureus/ui";
import { ApiError } from "./api";
import { AuthProvider } from "./auth-context";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Don't hammer the API on auth/scope/validation errors — only retry
          // transient failures, and only briefly.
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** App-wide client providers: TanStack Query, toasts, and auth. */
export function Providers({ children }: { children: ReactNode }): ReactElement {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
