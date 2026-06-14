"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CoinSpinner, SectionTitle, StatusPill } from "@aureus/ui";
import { AppShell } from "@/components/shell/AppShell";
import { KycForm } from "@/components/kyc/KycForm";
import { useCompliance } from "@/lib/hooks";

export default function KycPage(): React.ReactElement {
  return (
    <AppShell active="me">
      <Kyc />
    </AppShell>
  );
}

function Kyc(): React.ReactElement {
  const compliance = useCompliance();
  const status = compliance.data?.kycStatus;
  const alreadySubmitted = status === "PENDING" || status === "VERIFIED";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/me"
          aria-label="Back to account"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-mid transition-colors hover:bg-surface-3 hover:text-text-hi"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold text-text-hi">Verify your identity</h1>
      </div>

      {compliance.isLoading ? (
        <CoinSpinner label="Loading…" />
      ) : alreadySubmitted ? (
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <SectionTitle>Status</SectionTitle>
          {status ? <StatusPill status={status} /> : null}
          <p className="max-w-xs text-sm text-text-mid">
            {status === "VERIFIED"
              ? "You're verified — cash outs are unlocked."
              : "Your documents are under review. We'll update you soon."}
          </p>
          <Link href="/cashout" className="text-sm font-medium text-gold-light">
            Go to cash out
          </Link>
        </Card>
      ) : (
        <KycForm />
      )}
    </div>
  );
}
