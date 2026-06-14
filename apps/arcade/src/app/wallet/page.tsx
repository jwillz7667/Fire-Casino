"use client";

import { SectionTitle } from "@aureus/ui";
import { AppShell } from "@/components/shell/AppShell";
import { BalanceSummary } from "@/components/wallet/BalanceSummary";
import { RechargeRequestForm } from "@/components/wallet/RechargeRequestForm";
import { HistoryFeed } from "@/components/HistoryFeed";

export default function WalletPage(): React.ReactElement {
  return (
    <AppShell active="wallet">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <SectionTitle>Your balance</SectionTitle>
          <BalanceSummary />
        </section>

        <RechargeRequestForm />

        <section className="flex flex-col gap-3">
          <SectionTitle>Recent activity</SectionTitle>
          <HistoryFeed
            emptyTitle="No activity yet"
            emptyDescription="Your recharges and winnings will show up here."
          />
        </section>
      </div>
    </AppShell>
  );
}
