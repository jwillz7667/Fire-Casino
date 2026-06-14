"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Drawer, EmptyState, Money, SectionTitle, Skeleton, StatusPill } from "@aureus/ui";
import { api, ApiError } from "@/lib/api";
import type { BalanceEntry } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

interface OperatorLedgerEntry {
  id: string;
  type: string;
  direction: "DEBIT" | "CREDIT";
  currency: BalanceEntry["currency"];
  amountMinor: string;
  balanceAfterMinor: string;
  memo: string | null;
  createdAt: string;
}

/** Mini ledger drawer (docs/06 §1): own balances + the most recent movements. */
export function LedgerDrawer({
  open,
  onClose,
  operatorId,
}: {
  open: boolean;
  onClose: () => void;
  operatorId: string;
}): ReactElement {
  const balances = useQuery({
    queryKey: ["self-balance", operatorId],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${operatorId}/balance`),
    enabled: open,
  });

  const history = useQuery({
    queryKey: ["ledger-drawer", operatorId],
    queryFn: () => api.get<{ items: OperatorLedgerEntry[] }>(`/operators/${operatorId}/ledger?limit=20`),
    enabled: open,
    retry: false,
  });

  const historyUnavailable = history.error instanceof ApiError && history.error.status === 404;

  return (
    <Drawer open={open} onClose={onClose} title="Your balance">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <SectionTitle>Balances</SectionTitle>
          {balances.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="flex flex-col gap-1.5 rounded-md border border-hairline bg-surface-2 p-3">
              {(balances.data ?? []).map((b) => (
                <div key={b.currency} className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-text-lo">{b.currency}</span>
                  <Money valueMinor={b.balanceMinor} currency={b.currency} size="lg" />
                </div>
              ))}
              {(balances.data ?? []).length === 0 ? (
                <span className="text-sm text-text-lo">No accounts.</span>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <SectionTitle>Recent movements</SectionTitle>
          {history.isLoading && !historyUnavailable ? (
            <Skeleton className="h-24 w-full" />
          ) : historyUnavailable || (history.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No recent movements" description="Credit movements on your node will appear here." />
          ) : (
            <ul className="flex flex-col divide-y divide-hairline rounded-md border border-hairline">
              {(history.data?.items ?? []).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <StatusPill status={e.type} />
                      <span className="text-xs text-text-lo">{formatDateTime(e.createdAt)}</span>
                    </div>
                    {e.memo ? <span className="mt-0.5 text-xs text-text-mid">{e.memo}</span> : null}
                  </div>
                  <Money
                    valueMinor={e.direction === "DEBIT" ? `-${e.amountMinor}` : e.amountMinor}
                    currency={e.currency}
                    signed
                    size="sm"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link
          href={`/operators/${operatorId}?tab=credit`}
          onClick={onClose}
          className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-lumen hover:bg-surface-3"
        >
          View full credit history
        </Link>
      </div>
    </Drawer>
  );
}
