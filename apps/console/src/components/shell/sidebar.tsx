"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { OperatorSummary } from "@aureus/shared";
import { ScopeIndicator, cn } from "@aureus/ui";
import { api } from "@/lib/api";
import type { Page, RedemptionQueueItem } from "@/lib/types";
import type { CreditOrder } from "@/lib/types";
import { hasPermission } from "@/lib/permissions";
import { BrandLogo } from "./brand-logo";
import { NAV_ITEMS, type NavBadge } from "./nav-config";

function useBadgeCounts(principal: OperatorSummary): Record<NavBadge, number> {
  const redemptions = useQuery({
    queryKey: ["redemptions", "badge"],
    queryFn: () => api.get<Page<RedemptionQueueItem>>("/redemptions/queue?status=PENDING&limit=50"),
    enabled: hasPermission(principal, "redemption.view"),
    retry: false,
    refetchInterval: 60_000,
  });
  const orders = useQuery({
    queryKey: ["orders", "badge"],
    queryFn: () => api.get<Page<CreditOrder>>("/orders?role=seller&status=REQUESTED&limit=50"),
    enabled: hasPermission(principal, "order.view"),
    retry: false,
    refetchInterval: 60_000,
  });
  return {
    redemptions: redemptions.data?.items.length ?? 0,
    orders: orders.data?.items.length ?? 0,
  };
}

export function Sidebar({ principal }: { principal: OperatorSummary }): ReactElement {
  const pathname = usePathname();
  const badges = useBadgeCounts(principal);

  const items = NAV_ITEMS.filter((item) => item.permission === null || hasPermission(principal, item.permission));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-hairline bg-surface-1">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <BrandLogo size="md" glow priority />
        <span className="font-display text-lg font-semibold text-text-hi">Goldwave</span>
      </div>

      <div className="mx-3 mb-2 rounded-md border border-hairline bg-surface-2 px-3 py-2">
        <ScopeIndicator displayName={principal.displayName} tier={principal.tier} />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const badgeCount = item.badge ? badges[item.badge] : 0;
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-surface-3 text-text-hi"
                      : "text-text-mid hover:bg-surface-2 hover:text-text-hi",
                  )}
                >
                  <Icon className={cn("h-[1.1rem] w-[1.1rem]", active ? "text-gold-light" : "")} />
                  <span className="flex-1">{item.label}</span>
                  {badgeCount > 0 ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ember/20 px-1.5 text-[0.6875rem] font-semibold text-ember">
                      {badgeCount > 49 ? "49+" : badgeCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-hairline px-4 py-3">
        <Link href="/dev/styleguide" className="text-[0.6875rem] uppercase tracking-wide text-text-lo hover:text-text-mid">
          Style guide
        </Link>
      </div>
    </aside>
  );
}
