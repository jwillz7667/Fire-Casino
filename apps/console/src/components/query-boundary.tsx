"use client";

import type { ReactElement, ReactNode } from "react";
import {
  Button,
  CoinSpinner,
  EmptyState,
  ForbiddenState,
  RegionBlockedState,
} from "@aureus/ui";
import { ApiError } from "@/lib/api";

/**
 * Standard async boundary: spinner while loading, and clean domain states for
 * scope/region errors (docs/06 §4) instead of a stack trace.
 */
export function QueryBoundary({
  isLoading,
  error,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  children: ReactNode;
}): ReactElement {
  if (isLoading) return <CoinSpinner label="Loading…" />;

  if (error) {
    if (error instanceof ApiError) {
      if (error.code === "OUT_OF_SCOPE") return <ForbiddenState />;
      if (error.code === "REGION_BLOCKED") return <RegionBlockedState />;
      if (error.code === "FORBIDDEN" || error.status === 403) {
        return <ForbiddenState message={error.message} />;
      }
    }
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return (
      <EmptyState
        title="Couldn't load this"
        description={message}
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      />
    );
  }

  return <>{children}</>;
}
