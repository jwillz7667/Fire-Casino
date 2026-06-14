"use client";

import { type ReactElement, useState } from "react";
import Link from "next/link";
import { EmptyState, ForbiddenState, Panel, Tabs } from "@aureus/ui";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { KycQueue } from "@/components/compliance/kyc-queue";
import { GeoRules } from "@/components/compliance/geo-rules";
import { AmlFlags } from "@/components/compliance/aml-flags";
import { Promotions } from "@/components/compliance/promotions";

type TabKey = "kyc" | "geo" | "aml" | "rg" | "promos";

export default function CompliancePage(): ReactElement {
  const principal = usePrincipal();
  const [tab, setTab] = useState<TabKey>("kyc");

  if (!hasPermission(principal, "compliance.view")) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Compliance" subtitle="KYC, geo, AML, responsible gaming and promotions." />

      <Tabs
        active={tab}
        onChange={(k) => { setTab(k as TabKey); }}
        items={[
          { key: "kyc", label: "KYC queue" },
          { key: "geo", label: "Geo rules" },
          { key: "aml", label: "AML flags" },
          { key: "rg", label: "Responsible gaming" },
          { key: "promos", label: "Promotions" },
        ]}
      />

      {tab === "kyc" ? <KycQueue /> : null}
      {tab === "geo" ? <GeoRules /> : null}
      {tab === "aml" ? <AmlFlags /> : null}
      {tab === "promos" ? <Promotions /> : null}
      {tab === "rg" ? (
        <Panel>
          <EmptyState
            title="Responsible gaming is per-player"
            description="View and override deposit/loss/session limits and process self-exclusion from a player's profile."
            action={
              <Link href="/players" className="text-sm text-lumen hover:underline">
                Go to Players →
              </Link>
            }
          />
        </Panel>
      ) : null}
    </div>
  );
}
