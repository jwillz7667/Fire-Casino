"use client";

import { Button, EmptyState, Money, Skeleton } from "@aureus/ui";
import type { WalletHistoryItem } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  RECHARGE: "Recharge",
  PROMO_GRANT: "Bonus",
  GAME_BET: "Bet",
  GAME_WIN: "Win",
  GAME_ROUND_NET: "Round",
  REDEEM_HOLD: "Cash out (held)",
  REDEEM_CANCEL: "Cash out returned",
  REDEEM_SETTLE: "Cash out paid",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
  ISSUE: "Issued",
  TRANSFER: "Transfer",
};

function labelFor(type: string): string {
  return TYPE_LABEL[type] ?? type.replaceAll("_", " ").toLowerCase();
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Player's own activity list — reused by Wallet and Me (docs/07 §2.4/2.6). */
export function HistoryList({
  items,
  loading,
  hasMore,
  onLoadMore,
  loadingMore,
  emptyTitle = "No activity yet",
  emptyDescription,
}: {
  items: WalletHistoryItem[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}): React.ReactElement {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-surface-1">
        {items.map((item) => {
          const signed = `${item.direction === "DEBIT" ? "-" : ""}${item.amountMinor}`;
          return (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-hi">{labelFor(item.type)}</div>
                <div className="text-xs text-text-lo">{formatWhen(item.createdAt)}</div>
              </div>
              <div className="flex flex-col items-end">
                <Money valueMinor={signed} currency={item.currency} signed size="sm" />
                <span className="text-[0.625rem] text-text-lo">
                  bal <Money valueMinor={item.balanceAfterMinor} currency={item.currency} size="sm" />
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore ? (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
