"use client";

import { type ReactElement } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Banknote, ClipboardList, TriangleAlert } from "lucide-react";
import { KpiStat, Money, Panel, SectionTitle, Skeleton, StatusPill } from "@aureus/ui";
import { api, ApiError } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type {
  ActivityItem,
  BalanceEntry,
  CreditFlowReport,
  CreditOrder,
  Page,
  RedemptionQueueItem,
  ReportsOverview,
} from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { CreditFlowChart } from "@/components/credit-flow-chart";
import { humanize, timeAgo } from "@/lib/format";

export default function DashboardPage(): ReactElement {
  const principal = usePrincipal();
  const isSuperAdmin = principal.tier === "SUPER_ADMIN";

  const overview = useQuery({
    queryKey: ["reports", "overview"],
    queryFn: () => api.get<ReportsOverview>("/reports/overview"),
    retry: false,
  });
  const creditFlow = useQuery({
    queryKey: ["reports", "credit-flow", "dashboard"],
    queryFn: () => api.get<CreditFlowReport>("/reports/credit-flow?granularity=day"),
    retry: false,
  });
  const redemptions = useQuery({
    queryKey: ["redemptions", "queue", "PENDING"],
    queryFn: () => api.get<Page<RedemptionQueueItem>>("/redemptions/queue?status=PENDING&limit=50"),
    enabled: hasPermission(principal, "redemption.view"),
    retry: false,
  });
  const ordersInbox = useQuery({
    queryKey: ["orders", "seller", "REQUESTED"],
    queryFn: () => api.get<Page<CreditOrder>>("/orders?role=seller&status=REQUESTED&limit=50"),
    enabled: hasPermission(principal, "order.view"),
    retry: false,
  });
  const balance = useQuery({
    queryKey: ["self-balance", principal.operatorId],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${principal.operatorId}/balance`),
    retry: false,
  });
  const activity = useQuery({
    queryKey: ["reports", "activity"],
    queryFn: () => api.get<{ items: ActivityItem[] }>("/reports/activity"),
    retry: false,
  });

  const data = overview.data;
  const pendingRedemptionCount = data?.pendingRedemptions.count ?? redemptions.data?.items.length;
  const pendingOrderInbox = data?.pendingOrders.inbox ?? ordersInbox.data?.items.length;
  const lowBalance = (balance.data ?? []).filter((b) => BigInt(b.balanceMinor) <= 0n);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome, ${principal.displayName}`}
        subtitle="A scoped snapshot of everything below your node."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiStat
          label="Circulation below me"
          valueMinor={data?.creditsInCirculationMinor}
          value={data ? undefined : "—"}
          hint="Operator + player balances"
        />
        <KpiStat label="Active players" value={data?.activePlayers ?? "—"} hint="In your subtree" />
        <KpiStat
          label="Net recharges today"
          valueMinor={data?.netRechargesTodayMinor}
          value={data ? undefined : "—"}
        />
        <KpiStat
          label="Pending redemptions"
          value={pendingRedemptionCount ?? "—"}
          hint={data ? undefined : "Awaiting approval"}
        />
        <KpiStat label="Pending orders (in)" value={pendingOrderInbox ?? "—"} hint="Inbox awaiting you" />
      </div>

      {isSuperAdmin ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiStat
            label="Total minted"
            valueMinor={data?.totalMintedMinor}
            value={data?.totalMintedMinor ? undefined : "—"}
          />
          <KpiStat
            label="House revenue"
            valueMinor={data?.revenueMinor}
            value={data?.revenueMinor ? undefined : "—"}
            hint="Accrued house edge"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <SectionTitle>Credit flow · last 30 days</SectionTitle>
            <Link href="/reports" className="text-xs text-lumen hover:underline">
              Full reports →
            </Link>
          </div>
          {creditFlow.isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <CreditFlowChart points={creditFlow.data?.buckets ?? []} />
          )}
        </Panel>

        <Panel>
          <SectionTitle className="mb-4">Needs your attention</SectionTitle>
          <div className="flex flex-col gap-2">
            {lowBalance.length > 0 ? (
              <AttentionRow
                icon={<TriangleAlert className="h-4 w-4 text-warning" />}
                title="Low own balance"
                detail={
                  <span className="flex items-center gap-1">
                    <Money valueMinor={lowBalance[0]?.balanceMinor ?? "0"} currency={lowBalance[0]?.currency} size="sm" />
                  </span>
                }
                href={`/operators/${principal.operatorId}`}
              />
            ) : null}

            {(redemptions.data?.items ?? []).slice(0, 5).map((r) => (
              <AttentionRow
                key={r.id}
                icon={<Banknote className="h-4 w-4 text-ember" />}
                title={`Redemption · ${r.playerUsername}`}
                detail={<Money valueMinor={r.amountMinor} currency={r.currency} size="sm" />}
                meta={timeAgo(r.createdAt)}
                href={`/redemptions/${r.id}`}
              />
            ))}

            {(ordersInbox.data?.items ?? []).slice(0, 5).map((o) => (
              <AttentionRow
                key={o.id}
                icon={<ClipboardList className="h-4 w-4 text-lumen" />}
                title="Credit order request"
                detail={<Money valueMinor={o.quantityMinor} currency={o.currency} size="sm" />}
                meta={<StatusPill status={o.status} />}
                href="/credits"
              />
            ))}

            {lowBalance.length === 0 &&
            (redemptions.data?.items.length ?? 0) === 0 &&
            (ordersInbox.data?.items.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-text-lo">Nothing needs your attention. Nice.</p>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionTitle className="mb-4">Recent activity</SectionTitle>
        {activity.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (activity.data?.items.length ?? 0) === 0 ? (
          <p className="py-4 text-center text-sm text-text-lo">No recent activity in your subtree.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline">
            {(activity.data?.items ?? []).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-text-hi">{humanize(a.type)}</span>
                  <span className="text-[0.6875rem] text-text-lo">{timeAgo(a.at)}</span>
                </span>
                <Money valueMinor={a.amountMinor} currency={a.currency} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {overview.error instanceof ApiError ? (
        <p className="text-xs text-text-lo">
          Some aggregate metrics are unavailable right now; live queues above reflect current state.
        </p>
      ) : null}
    </div>
  );
}

function AttentionRow({
  icon,
  title,
  detail,
  meta,
  href,
}: {
  icon: ReactElement;
  title: string;
  detail: ReactElement;
  meta?: ReactElement | string;
  href: string;
}): ReactElement {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface-2 px-3 py-2 transition-colors hover:bg-surface-3"
    >
      <div className="flex items-center gap-2.5">
        {icon}
        <div className="flex flex-col">
          <span className="text-sm text-text-hi">{title}</span>
          {meta ? <span className="text-[0.6875rem] text-text-lo">{meta}</span> : null}
        </div>
      </div>
      {detail}
    </Link>
  );
}
