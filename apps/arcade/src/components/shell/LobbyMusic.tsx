"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Music, VolumeX } from "lucide-react";

const PREF_KEY = "gw_lobby_music";

/**
 * Background casino-lobby music + an on/off toggle in the topbar. The preference is
 * persisted; default is ON. Two real-world guards: (1) browsers block autoplay-with-sound
 * until a user gesture, so if play() is rejected we resume on the first pointer interaction;
 * (2) the music PAUSES on /play/* routes so it never plays over a game's own soundtrack
 * (the Godot games render as a full-screen overlay above this shell).
 */
export function LobbyMusic(): React.ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const pathname = usePathname();
  const inGame = pathname?.startsWith("/play") ?? false;

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(PREF_KEY) : null;
    setOn(saved === null ? true : saved === "1");
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (typeof window !== "undefined") window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
    if (on && !inGame) {
      a.volume = 0.32;
      // Autoplay-with-sound is often blocked until a gesture — resume on first pointer.
      void a.play().catch(() => {
        const resume = (): void => {
          void a.play().catch(() => undefined);
        };
        document.addEventListener("pointerdown", resume, { once: true });
      });
    } else {
      a.pause();
    }
  }, [on, inGame]);

  return (
    <>
      <audio ref={audioRef} src="/audio/lobby-music.mp3" loop preload="auto" />
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        aria-label={on ? "Turn lobby music off" : "Turn lobby music on"}
        aria-pressed={on}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface-2 text-text-mid transition-colors hover:text-text-hi"
      >
        {on ? <Music className="h-5 w-5 text-gold-light" /> : <VolumeX className="h-5 w-5" />}
      </button>
    </>
  );
}
