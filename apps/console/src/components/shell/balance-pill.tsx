"use client";

import { type ReactElement, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BalanceChip, Skeleton } from "@aureus/ui";
import { api } from "@/lib/api";
import type { BalanceEntry } from "@/lib/types";
import { LedgerDrawer } from "./ledger-drawer";

/** Topbar balance pill — own credit balance(s), live via balance.changed. */
export function BalancePill({ operatorId }: { operatorId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const balances = useQuery({
    queryKey: ["self-balance", operatorId],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${operatorId}/balance`),
  });

  return (
    <>
      {balances.isLoading ? (
        <Skeleton className="h-9 w-28 rounded-full" />
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          aria-label="Open balance details"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-lumen/70"
        >
          <BalanceChip
            balances={(balances.data ?? []).map((b) => ({ currency: b.currency, valueMinor: b.balanceMinor }))}
          />
        </button>
      )}
      <LedgerDrawer open={open} onClose={() => { setOpen(false); }} operatorId={operatorId} />
    </>
  );
}
