"use client";

import { type ReactElement, useEffect } from "react";

/**
 * Root error boundary (Next.js global-error). Replaces the root layout when an
 * error escapes it, so it renders its own <html>/<body>. Kept dependency-free
 * and inline-styled so the fallback itself can never throw.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  useEffect(() => {
    console.error("Console global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0b",
          color: "#e7e7ea",
          fontFamily: "system-ui, sans-serif",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>The console hit an unexpected error</h1>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>
            The error has been logged. Try reloading.
          </p>
          <button
            onClick={() => { reset(); }}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#1a1a1c",
              color: "#e7e7ea",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
