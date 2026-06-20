"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Full-screen host for a Godot/WASM game iframe, shared by every game so responsiveness is
 * identical everywhere. The iframe is inset by the device SAFE-AREA (notch, home indicator,
 * rounded corners) via `env(safe-area-inset-*)`, so in an installed PWA ("Add to Home
 * Screen", display: standalone) the game — and its bottom controls — never sit under the
 * status bar or home indicator. In a normal browser tab the insets are 0, so it fills the
 * viewport. `viewport-fit=cover` (set in the root layout) is what makes the env() insets
 * resolve. The black backdrop fills the inset margins behind the game.
 */
export const GameViewport = forwardRef<
  HTMLIFrameElement,
  { src: string; title: string; onLoad: () => void }
>(function GameViewport({ src, title, onLoad }, ref) {
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black">
      <div
        className="absolute inset-0"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <iframe
          ref={ref}
          src={src}
          onLoad={onLoad}
          title={title}
          allow="autoplay; fullscreen"
          className="h-full w-full border-0"
        />
      </div>
      <Link
        href="/"
        aria-label="Back to lobby"
        style={{
          top: "calc(env(safe-area-inset-top) + 0.75rem)",
          left: "calc(env(safe-area-inset-left) + 0.75rem)",
        }}
        className="absolute z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
    </div>
  );
});
