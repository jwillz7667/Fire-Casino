"use client";

import { Info } from "lucide-react";
import { CoinMark, Money, SectionTitle, Skeleton } from "@aureus/ui";
import { AppShell } from "@/components/shell/AppShell";
import { RedeemForm } from "@/components/cashout/RedeemForm";
import { RedemptionHistory } from "@/components/cashout/RedemptionHistory";
import { useAuth } from "@/lib/auth-context";
import { useCompliance, useWallet } from "@/lib/hooks";
import { balanceFor, cashoutCurrency, currencyLabel } from "@/lib/mode";
import { MIN_REDEEM_MINOR } from "@/lib/constants";

export default function CashoutPage(): React.ReactElement {
  return (
    <AppShell active="cashout">
      <Cashout />
    </AppShell>
  );
}

function Cashout(): React.ReactElement {
  const { mode } = useAuth();
  const currency = cashoutCurrency(mode);
  const wallet = useWallet();
  const compliance = useCompliance();

  const redeemable = wallet.data ? balanceFor(wallet.data.wallets, currency) : "0";
  // Only block on KYC when we positively know it isn't verified; otherwise let
  // the server gate (the compliance endpoint may be unavailable).
  const kycRequired =
    mode === "COMPLIANCE" && compliance.data !== undefined && compliance.data.kycStatus !== "VERIFIED";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <SectionTitle>Cash out</SectionTitle>
        <div className="flex items-center justify-between gap-3 rounded-md border border-ember/30 bg-ember/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <CoinMark variant="ember" size="lg" glow />
            <div>
              <div className="text-sm font-semibold text-text-hi">Redeemable</div>
              <div className="text-xs text-text-mid">{currencyLabel(currency)} you can cash out.</div>
            </div>
          </div>
          {wallet.isLoading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <Money valueMinor={redeemable} currency={currency} size="lg" />
          )}
        </div>
      </section>

      {mode === "OPERATOR" ? (
        <div className="flex items-start gap-2 rounded-md border border-hairline bg-surface-2 px-3 py-2.5 text-xs text-text-mid">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-lumen" />
          <span>Cash outs are arranged with your agent. Submit a request and they&apos;ll handle payout offline.</span>
        </div>
      ) : null}

      <RedeemForm
        currency={currency}
        redeemableMinor={redeemable}
        minMinor={MIN_REDEEM_MINOR}
        kycRequired={kycRequired}
      />

      <RedemptionHistory />
    </div>
  );
}
