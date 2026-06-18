"use client";

import { type ReactElement, useEffect } from "react";
import { Button, EmptyState } from "@aureus/ui";

/**
 * Route-segment error boundary (docs/06 §4). Any render/runtime throw inside the
 * authenticated app degrades to a recoverable panel instead of an unrecoverable
 * white screen. Pairs with global-error.tsx for failures above the layout.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  useEffect(() => {
    // Logged once at the boundary; never surfaced to the user verbatim.
    console.error("Console route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        title="Something went wrong on this screen"
        description="The error has been logged. You can retry, or head back to the dashboard."
        action={
          <div className="flex gap-2">
            <Button onClick={() => { reset(); }}>Try again</Button>
            <Button variant="secondary" onClick={() => { window.location.assign("/"); }}>
              Dashboard
            </Button>
          </div>
        }
      />
    </div>
  );
}
