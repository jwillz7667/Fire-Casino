"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { exportReportSchema, type ReportType, reportTypeSchema } from "@aureus/shared";
import { Badge, Button, EmptyState, Field, ForbiddenState, Input, Money, Panel, SectionTitle, Skeleton, Tabs, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type {
  AgentSalesReport,
  CreditFlowReport,
  MarginReport,
  PlayerActivityReport,
  RedemptionsReport,
  RevenueReport,
  SettlementReport,
} from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { formatCents, formatDate, humanize } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { CreditFlowChart } from "@/components/credit-flow-chart";

const TAB_LABELS: Record<ReportType, string> = {
  "credit-flow": "Credit flow",
  "player-activity": "Player activity",
  "agent-sales": "Agent sales",
  revenue: "Revenue",
  margin: "Margin",
  settlement: "Settlement",
  redemptions: "Redemptions",
};

const TAB_DESCRIPTIONS: Record<ReportType, string> = {
  "credit-flow": "Issued, transferred, recharged and redeemed over time.",
  "player-activity": "Recharges, redemptions and net by player and agent.",
  "agent-sales": "Per-agent holdings, plus credits sold and removed to players.",
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

/** Turn the synchronous CSV body into a client-side file download. */
function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  const agentSales = useQuery({
    queryKey: ["reports", "agent-sales", from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      const f = toIso(from);
      const t = toIso(to);
      if (f) params.set("from", f);
      if (t) params.set("to", t);
      const qs = params.toString();
      return api.get<AgentSalesReport>(`/reports/agent-sales${qs ? `?${qs}` : ""}`);
    },
    enabled: canView && tab === "agent-sales",
    retry: false,
  });

  function rangeQs(): string {
    const params = new URLSearchParams();
    const f = toIso(from);
    const t = toIso(to);
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  const playerActivity = useQuery({
    queryKey: ["reports", "player-activity", from, to],
    queryFn: () => api.get<PlayerActivityReport>(`/reports/player-activity${rangeQs()}`),
    enabled: canView && tab === "player-activity",
    retry: false,
  });
  const revenue = useQuery({
    queryKey: ["reports", "revenue", from, to],
    queryFn: () => api.get<RevenueReport>(`/reports/revenue${rangeQs()}`),
    enabled: canView && tab === "revenue",
    retry: false,
  });
  const margin = useQuery({
    queryKey: ["reports", "margin"],
    queryFn: () => api.get<MarginReport>("/reports/margin"),
    enabled: canView && tab === "margin",
    retry: false,
  });
  const settlement = useQuery({
    queryKey: ["reports", "settlement"],
    queryFn: () => api.get<SettlementReport>("/reports/settlement"),
    enabled: canView && tab === "settlement",
    retry: false,
  });
  const redemptions = useQuery({
    queryKey: ["reports", "redemptions", from, to],
    queryFn: () => api.get<RedemptionsReport>(`/reports/redemptions${rangeQs()}`),
    enabled: canView && tab === "redemptions",
    retry: false,
  });

  const exportReport = useMutation({
    mutationFn: () => {
      const parsed = exportReportSchema.safeParse({ type: tab, format: "csv", from: toIso(from), to: toIso(to) });
      if (!parsed.success) throw new Error("Invalid export parameters");
      // The API returns the CSV body synchronously ({ filename, csv }) — not a job.
      return api.post<{ filename: string; csv: string }>("/reports/export", parsed.data);
    },
    onSuccess: ({ filename, csv }) => {
      downloadCsv(filename, csv);
      toast.push({ title: "Export ready", description: `Downloaded ${filename}.`, intent: "success" });
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
            <CreditFlowChart points={creditFlow.data.buckets} />
          ) : (
            <EmptyState title="No data" description="Adjust the date range or export to CSV." />
          )
        ) : tab === "agent-sales" ? (
          agentSales.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : agentSales.data && agentSales.data.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-text-lo">
                    <th className="py-2 pr-4 font-medium">Agent</th>
                    <th className="py-2 pr-4 text-right font-medium">Holdings</th>
                    <th className="py-2 pr-4 text-right font-medium">Sold to players</th>
                    <th className="py-2 pr-4 text-right font-medium">Removed</th>
                    <th className="py-2 text-right font-medium">Net to players</th>
                  </tr>
                </thead>
                <tbody>
                  {agentSales.data.items.map((row) => (
                    <tr key={row.operatorId} className="border-b border-hairline/60">
                      <td className="py-2.5 pr-4">
                        <span className="flex items-center gap-2">
                          <span className="text-text-hi">{row.displayName}</span>
                          <Badge intent="info">{row.tier}</Badge>
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <Money valueMinor={row.holdingsMinor} currency={agentSales.data.currency} size="sm" />
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <Money valueMinor={row.soldToPlayersMinor} currency={agentSales.data.currency} size="sm" />
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <Money valueMinor={row.removedFromPlayersMinor} currency={agentSales.data.currency} size="sm" />
                      </td>
                      <td className="py-2.5 text-right">
                        <Money valueMinor={row.netToPlayersMinor} currency={agentSales.data.currency} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No agents yet" description="Per-agent sales will appear once agents recharge players." />
          )
        ) : tab === "player-activity" ? (
          <PlayerActivityTable data={playerActivity.data} loading={playerActivity.isLoading} />
        ) : tab === "revenue" ? (
          <RevenuePanel data={revenue.data} loading={revenue.isLoading} />
        ) : tab === "margin" ? (
          <MarginTable data={margin.data} loading={margin.isLoading} />
        ) : tab === "settlement" ? (
          <SettlementPanel data={settlement.data} loading={settlement.isLoading} />
        ) : (
          <RedemptionsPanel data={redemptions.data} loading={redemptions.isLoading} />
        )}
      </Panel>
    </div>
  );
}

function StatTile({ label, node }: { label: string; node: ReactElement }): ReactElement {
  return (
    <div className="rounded-md border border-hairline bg-surface-2 p-3">
      <div className="text-xs uppercase tracking-wide text-text-lo">{label}</div>
      <div className="mt-1.5">{node}</div>
    </div>
  );
}

const TH = "border-b border-hairline text-left text-xs uppercase tracking-wide text-text-lo";

function PlayerActivityTable({ data, loading }: { data?: PlayerActivityReport; loading: boolean }): ReactElement {
  if (loading) return <Skeleton className="h-56 w-full" />;
  if (!data || data.items.length === 0)
    return <EmptyState title="No player activity" description="Recharges and redemptions in the selected range will appear here." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={TH}>
            <th className="py-2 pr-4 font-medium">Player</th>
            <th className="py-2 pr-4 text-right font-medium">Recharged</th>
            <th className="py-2 pr-4 text-right font-medium">Redeemed</th>
            <th className="py-2 text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.playerId} className="border-b border-hairline/60">
              <td className="py-2.5 pr-4 text-text-hi">{r.username}</td>
              <td className="py-2.5 pr-4 text-right"><Money valueMinor={r.rechargedMinor} size="sm" /></td>
              <td className="py-2.5 pr-4 text-right"><Money valueMinor={r.redeemedMinor} size="sm" /></td>
              <td className="py-2.5 text-right"><Money valueMinor={r.netMinor} signed size="sm" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevenuePanel({ data, loading }: { data?: RevenueReport; loading: boolean }): ReactElement {
  if (loading) return <Skeleton className="h-28 w-full" />;
  if (!data) return <EmptyState title="No revenue data" />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Bets" node={<Money valueMinor={data.betsMinor} currency={data.currency} />} />
      <StatTile label="Wins" node={<Money valueMinor={data.winsMinor} currency={data.currency} />} />
      <StatTile label="House edge" node={<Money valueMinor={data.revenueMinor} currency={data.currency} signed />} />
      {data.platformRevenueMinor ? (
        <StatTile label="Platform REVENUE" node={<Money valueMinor={data.platformRevenueMinor} currency={data.currency} />} />
      ) : null}
    </div>
  );
}

function MarginTable({ data, loading }: { data?: MarginReport; loading: boolean }): ReactElement {
  if (loading) return <Skeleton className="h-56 w-full" />;
  if (!data || data.nodes.length === 0)
    return <EmptyState title="No margin data" description="Buy/sell spreads appear once nodes have pricing and settled orders." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={TH}>
            <th className="py-2 pr-4 font-medium">Node</th>
            <th className="py-2 pr-4 text-right font-medium">Buy ¢</th>
            <th className="py-2 pr-4 text-right font-medium">Sell ¢</th>
            <th className="py-2 pr-4 text-right font-medium">Spread ¢</th>
            <th className="py-2 text-right font-medium">Margin</th>
          </tr>
        </thead>
        <tbody>
          {data.nodes.map((n) => (
            <tr key={n.operatorId} className="border-b border-hairline/60">
              <td className="py-2.5 pr-4">
                <span className="flex items-center gap-2">
                  <span className="text-text-hi">{n.displayName}</span>
                  <Badge intent="info">{n.tier}</Badge>
                </span>
              </td>
              <td className="py-2.5 pr-4 text-right text-text-mid">{formatCents(n.buyUnitPriceCents)}</td>
              <td className="py-2.5 pr-4 text-right text-text-mid">{formatCents(n.sellUnitPriceCents)}</td>
              <td className="py-2.5 pr-4 text-right text-text-mid">{formatCents(n.spreadCents)}</td>
              <td className="py-2.5 text-right text-text-hi">{formatCents(n.marginCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2.5 pr-4 text-xs uppercase tracking-wide text-text-lo" colSpan={4}>
              Total margin
            </td>
            <td className="py-2.5 text-right font-medium text-text-hi">{formatCents(data.totalMarginCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SettlementPanel({ data, loading }: { data?: SettlementReport; loading: boolean }): ReactElement {
  if (loading) return <Skeleton className="h-56 w-full" />;
  if (!data) return <EmptyState title="No settlement data" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Receivable" node={<span className="text-success">{formatCents(data.receivableCents)}</span>} />
        <StatTile label="Payable" node={<span className="text-danger">{formatCents(data.payableCents)}</span>} />
        <StatTile label="Net" node={<span className="text-text-hi">{formatCents(data.netCents)}</span>} />
      </div>
      {data.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={TH}>
                <th className="py-2 pr-4 font-medium">Operator</th>
                <th className="py-2 pr-4 font-medium">Counterparty</th>
                <th className="py-2 pr-4 text-right font-medium">Net ¢</th>
                <th className="py-2 text-right font-medium">Last event</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="border-b border-hairline/60">
                  <td className="py-2.5 pr-4 font-mono text-xs text-text-mid">{r.operatorId.slice(0, 8)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-text-mid">{r.counterpartyId.slice(0, 8)}</td>
                  <td className="py-2.5 pr-4 text-right text-text-hi">{formatCents(r.netCents)}</td>
                  <td className="py-2.5 text-right text-text-lo">{formatDate(r.lastEventAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No outstanding settlements" />
      )}
    </div>
  );
}

function RedemptionsPanel({ data, loading }: { data?: RedemptionsReport; loading: boolean }): ReactElement {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!data) return <EmptyState title="No redemption data" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Pending" node={<Money valueMinor={data.pendingMinor} />} />
        <StatTile label="Approved" node={<Money valueMinor={data.approvedMinor} />} />
        <StatTile label="Settled" node={<Money valueMinor={data.settledMinor} />} />
      </div>
      {data.byStatus.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={TH}>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 text-right font-medium">Count</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.byStatus.map((s) => (
                <tr key={s.status} className="border-b border-hairline/60">
                  <td className="py-2.5 pr-4 text-text-hi">{humanize(s.status)}</td>
                  <td className="py-2.5 pr-4 text-right text-text-mid">{s.count}</td>
                  <td className="py-2.5 text-right"><Money valueMinor={s.totalMinor} size="sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No redemptions in range" />
      )}
    </div>
  );
}
