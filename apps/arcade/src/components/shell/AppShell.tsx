"use client";

import { type ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CoinSpinner } from "@aureus/ui";
import { useAuth } from "@/lib/auth-context";
import { useRealtime } from "@/lib/socket";
import { MobileTopbar } from "./MobileTopbar";
import { TabBar, type TabKey } from "./TabBar";

/**
 * Authenticated shell: topbar (live balance) + content + bottom tab bar, capped
 * to a single phone-width column. Guards the route (bounces to /login once the
 * session restore has settled) and wires the realtime cache reconciliation.
 */
export function AppShell({
  active,
  children,
}: {
  active: TabKey;
  children: ReactNode;
}): ReactNode {
  const { ready, isAuthenticated, player } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !isAuthenticated) router.replace("/login");
  }, [ready, isAuthenticated, router]);

  useRealtime({ enabled: isAuthenticated, playerId: player?.playerId });

  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <CoinSpinner label="Loading…" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-abyss">
      <MobileTopbar />
      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
      <TabBar active={active} />
    </div>
  );
}
