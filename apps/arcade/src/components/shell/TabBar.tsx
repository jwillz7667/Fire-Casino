"use client";

import Link from "next/link";
import { ArrowUpFromLine, Gamepad2, User, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@aureus/ui";

export type TabKey = "play" | "wallet" | "cashout" | "me";

interface TabDef {
  key: TabKey;
  href: string;
  label: string;
  Icon: LucideIcon;
}

const TABS: TabDef[] = [
  { key: "play", href: "/", label: "Play", Icon: Gamepad2 },
  { key: "wallet", href: "/wallet", label: "Wallet", Icon: Wallet },
  { key: "cashout", href: "/cashout", label: "Cash Out", Icon: ArrowUpFromLine },
  { key: "me", href: "/me", label: "Me", Icon: User },
];

/** Thumb-reachable bottom nav (docs/07 §1). */
export function TabBar({ active }: { active: TabKey }): React.ReactElement {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] border-t border-hairline bg-trench/95 backdrop-blur supports-[backdrop-filter]:bg-trench/80"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex">
        {TABS.map(({ key, href, label, Icon }) => {
          const selected = key === active;
          return (
            <li key={key} className="flex-1">
              <Link
                href={href}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] font-medium transition-colors",
                  selected ? "text-gold-light" : "text-text-mid hover:text-text-hi",
                )}
              >
                <Icon className={cn("h-5 w-5", selected && "drop-shadow-[0_0_6px_rgba(232,184,75,0.55)]")} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
