"use client";

import { type ReactElement, type ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CoinSpinner } from "@aureus/ui";
import { useAuth } from "@/lib/auth-context";
import { useRealtime } from "@/lib/socket";
import { MfaGate } from "./mfa-gate";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * Authenticated shell: redirects to /login when there is no session, drives
 * forced MFA enrollment, opens the realtime socket, and frames every page with
 * the topbar + scoped sidebar.
 */
export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const router = useRouter();
  const { status, principal } = useAuth();

  useRealtime(status === "authenticated");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated" || !principal) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <CoinSpinner label="Loading console…" />
      </div>
    );
  }

  if (principal.requiresMfaEnrollment) {
    return <MfaGate />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar principal={principal} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar principal={principal} />
        <main className="flex-1 overflow-y-auto bg-canvas px-6 py-6">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
