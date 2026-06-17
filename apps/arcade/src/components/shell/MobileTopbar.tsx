"use client";

import Link from "next/link";
import { CircleUserRound } from "lucide-react";
import { BalanceChip, Skeleton } from "@aureus/ui";
import { walletCurrencies } from "@aureus/shared";
import { useAuth } from "@/lib/auth-context";
import { useWallet } from "@/lib/hooks";
import { balanceFor, currencyLabel } from "@/lib/mode";
import { BrandLogo } from "./BrandLogo";
import { LobbyMusic } from "./LobbyMusic";

/** Always-visible balance + profile (docs/07 §1). Dual PLAY/PRIZE in compliance. */
export function MobileTopbar(): React.ReactElement {
  const { mode } = useAuth();
  const wallet = useWallet();
  const currencies = walletCurrencies(mode);

  const balances = wallet.data
    ? currencies.map((currency) => ({
        currency,
        valueMinor: balanceFor(wallet.data.wallets, currency),
        label: currencyLabel(currency).toUpperCase(),
      }))
    : [];

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-hairline bg-trench/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-trench/80">
      <Link href="/" className="flex items-center gap-2" aria-label="Goldwave Casino home">
        <BrandLogo size="md" glow priority />
        <span className="font-display text-lg font-semibold text-gold-light">Goldwave</span>
      </Link>

      <div className="flex items-center gap-2">
        {wallet.isLoading ? (
          <Skeleton className="h-9 w-40 rounded-full" />
        ) : (
          <BalanceChip balances={balances} size="sm" />
        )}
        <LobbyMusic />
        <Link
          href="/me"
          aria-label="Account"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface-2 text-text-mid transition-colors hover:text-text-hi"
        >
          <CircleUserRound className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
