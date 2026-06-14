"use client";

import { CoinMark, Money, Skeleton } from "@aureus/ui";
import { type Currency, walletCurrencies } from "@aureus/shared";
import { useAuth } from "@/lib/auth-context";
import { useWallet } from "@/lib/hooks";
import { balanceFor } from "@/lib/mode";

const EXPLAIN: Record<Currency, { title: string; note: string }> = {
  PLAY: { title: "Play", note: "Use this to play games." },
  PRIZE: { title: "Prize", note: "Winnings you can cash out." },
  CREDIT: { title: "Credit", note: "Your balance for play and cash out." },
};

/** Two-balance clarity (docs/07 §3): PLAY gold vs PRIZE ember, unmistakable. */
export function BalanceSummary(): React.ReactElement {
  const { mode } = useAuth();
  const wallet = useWallet();
  const currencies = walletCurrencies(mode);

  if (wallet.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <Skeleton className="h-20 w-full rounded-md" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {currencies.map((currency) => {
        const info = EXPLAIN[currency];
        return (
          <div
            key={currency}
            className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 ${
              currency === "PRIZE" ? "border-ember/30 bg-ember/5" : "border-gold/30 bg-gold/5"
            }`}
          >
            <div className="flex items-center gap-3">
              <CoinMark variant={currency === "PRIZE" ? "ember" : "gold"} size="lg" glow />
              <div>
                <div className="text-sm font-semibold text-text-hi">{info.title}</div>
                <div className="text-xs text-text-mid">{info.note}</div>
              </div>
            </div>
            <Money
              valueMinor={wallet.data ? balanceFor(wallet.data.wallets, currency) : "0"}
              currency={currency}
              size="lg"
            />
          </div>
        );
      })}
    </div>
  );
}
