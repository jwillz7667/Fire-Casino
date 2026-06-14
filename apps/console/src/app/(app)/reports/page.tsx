"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { exportReportSchema, type ReportType, reportTypeSchema } from "@aureus/shared";
import { Button, EmptyState, Field, ForbiddenState, Input, Panel, SectionTitle, Skeleton, Tabs, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { CreditFlowReport } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { CreditFlowChart } from "@/components/credit-flow-chart";

const TAB_LABELS: Record<ReportType, string> = {
  "credit-flow": "Credit flow",
  "player-activity": "Player activity",
  revenue: "Revenue",
  margin: "Margin",
  settlement: "Settlement",
  redemptions: "Redemptions",
};

const TAB_DESCRIPTIONS: Record<ReportType, string> = {
  "credit-flow": "Issued, transferred, recharged and redeemed over time.",
  "player-activity": "Recharges, redemptions and net by player and agent.",
  revenue: "House edge accrued to the REVENUE account by period.",
  margin: "Buy vs sell unit-price spread per node — the off-platform profit view.",
  settlement: "Outstanding cash owed up and down the chain.",
  redemptions: "The redemption pipeline and settlement status.",
};

function toIso(date: string): string | undefined {
  if (date === "") return undefined;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function ReportsPage(): ReactElement {
  const principal = usePrincipal();
  const toast = useToast();
  const [tab, setTab] = useState<ReportType>("credit-flow");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const canView = hasPermission(principal, "report.view");

  const creditFlow = useQuery({
    queryKey: ["reports", "credit-flow", from, to],
    queryFn: () => {
      const params = new URLSearchParams({ granularity: "day" });
      const f = toIso(from);
      const t = toIso(to);
      if (f) params.set("from", f);
      if (t) params.set("to", t);
      return api.get<CreditFlowReport>(`/reports/credit-flow?${params.toString()}`);
    },
    enabled: canView && tab === "credit-flow",
    retry: false,
  });

  const exportReport = useMutation({
    mutationFn: () => {
      const parsed = exportReportSchema.safeParse({ type: tab, format: "csv", from: toIso(from), to: toIso(to) });
      if (!parsed.success) throw new Error("Invalid export parameters");
      return api.post<{ jobId?: string }>("/reports/export", parsed.data);
    },
    onSuccess: () => {
      toast.push({ title: "Export queued", description: "Your CSV will be available shortly.", intent: "success" });
    },
    onError: (err) => {
      toast.push({ title: "Export failed", description: errorMessage(err), intent: "danger" });
    },
  });

  if (!canView) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        subtitle="Scoped reporting across your subtree."
        actions={
          <Button variant="secondary" onClick={() => { exportReport.mutate(); }} loading={exportReport.isPending}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" className="w-44">
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); }} />
        </Field>
        <Field label="To" className="w-44">
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); }} />
        </Field>
      </div>

      <Tabs
        active={tab}
        onChange={(k) => { setTab(k as ReportType); }}
        items={reportTypeSchema.options.map((t) => ({ key: t, label: TAB_LABELS[t] }))}
      />

      <Panel className="flex flex-col gap-4">
        <div>
          <SectionTitle>{TAB_LABELS[tab]}</SectionTitle>
          <p className="mt-1 text-sm text-text-mid">{TAB_DESCRIPTIONS[tab]}</p>
        </div>

        {tab === "credit-flow" ? (
          creditFlow.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : creditFlow.data ? (
            <CreditFlowChart points={creditFlow.data.points} />
          ) : (
            <EmptyState title="No data" description="Adjust the date range or export to CSV." />
          )
        ) : (
          <EmptyState
            title="Export to view"
            description="This report is best consumed as a CSV. Use Export above for the selected range."
            action={
              <Button variant="secondary" size="sm" onClick={() => { exportReport.mutate(); }} loading={exportReport.isPending}>
                <Download className="h-4 w-4" />
                Export {TAB_LABELS[tab]}
              </Button>
            }
          />
        )}
      </Panel>
    </div>
  );
}
