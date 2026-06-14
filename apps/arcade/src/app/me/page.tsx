"use client";

import { LogOut } from "lucide-react";
import { Button, Card, SectionTitle, StatusPill } from "@aureus/ui";
import { AppShell } from "@/components/shell/AppShell";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { RgLimitsForm } from "@/components/account/RgLimitsForm";
import { SelfExclusionFlow } from "@/components/account/SelfExclusionFlow";
import { KycStatusCard } from "@/components/account/KycStatusCard";
import { HistoryFeed } from "@/components/HistoryFeed";
import { useAuth } from "@/lib/auth-context";
import { spendCurrency } from "@/lib/mode";

export default function MePage(): React.ReactElement {
  return (
    <AppShell active="me">
      <Account />
    </AppShell>
  );
}

function Account(): React.ReactElement {
  const { player, mode, logout } = useAuth();
  const currency = spendCurrency(mode);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <SectionTitle>Account</SectionTitle>
        <Card className="flex items-center justify-between p-4">
          <div>
            <div className="text-base font-semibold text-text-hi">
              {player?.displayName ?? player?.username ?? "Player"}
            </div>
            <div className="text-xs text-text-lo">@{player?.username}</div>
          </div>
          {player ? <StatusPill status={player.status} /> : null}
        </Card>
      </section>

      {mode === "COMPLIANCE" ? <KycStatusCard /> : null}

      <RgLimitsForm spendCurrency={currency} />

      <SelfExclusionFlow />

      <section className="flex flex-col gap-3">
        <SectionTitle>Change password</SectionTitle>
        <Card className="p-4">
          <ChangePasswordForm />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Transaction history</SectionTitle>
        <HistoryFeed
          emptyTitle="Nothing yet"
          emptyDescription="Your recharges, plays, and cash outs will appear here."
        />
      </section>

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          void logout();
        }}
      >
        <LogOut className="h-4 w-4" />
        Log out
      </Button>
    </div>
  );
}
