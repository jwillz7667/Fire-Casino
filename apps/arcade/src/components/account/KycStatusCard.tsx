"use client";

import Link from "next/link";
import { BadgeCheck, FileCheck2 } from "lucide-react";
import { Button, Card, SectionTitle, StatusPill } from "@aureus/ui";
import type { KycStatus } from "@aureus/shared";
import { useCompliance } from "@/lib/hooks";

const COPY: Record<KycStatus, string> = {
  NONE: "Verify your identity to unlock cash outs.",
  PENDING: "Your documents are under review.",
  VERIFIED: "Your identity is verified.",
  REJECTED: "Verification didn't go through. Please try again.",
};

export function KycStatusCard(): React.ReactElement {
  const compliance = useCompliance();
  const status: KycStatus = compliance.data?.kycStatus ?? "NONE";
  const canStart = status === "NONE" || status === "REJECTED";

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        {status === "VERIFIED" ? (
          <BadgeCheck className="h-4 w-4 text-success" />
        ) : (
          <FileCheck2 className="h-4 w-4 text-lumen" />
        )}
        <SectionTitle>Identity verification</SectionTitle>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-text-mid">{COPY[status]}</p>
        <StatusPill status={status} />
      </div>

      {canStart ? (
        <Link href="/kyc" className="w-full">
          <Button className="w-full">Start verification</Button>
        </Link>
      ) : null}
    </Card>
  );
}
