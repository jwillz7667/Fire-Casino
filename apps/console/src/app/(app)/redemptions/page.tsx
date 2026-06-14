"use client";

import { type ReactElement, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Column,
  DataTable,
  ForbiddenState,
  Money,
  Panel,
  SegmentedControl,
  StatusPill,
} from "@aureus/ui";
import { api, toQuery } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { Page, RedemptionQueueItem } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { PageHeader } from "@/components/page-header";
import { timeAgo } from "@/lib/format";

const FILTERS: { key: string; label: string }[] = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "PAID", label: "Paid" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
];

export default function RedemptionsPage(): ReactElement {
  const principal = usePrincipal();
  const router = useRouter();
  const [status, setStatus] = useState<string>("PENDING");

  const canView = hasPermission(principal, "redemption.view");

  const list = useCursorList<RedemptionQueueItem>(["redemptions", "queue", status], (cursor) =>
    api.get<Page<RedemptionQueueItem>>(
      `/redemptions/queue${toQuery({
        status: status === "all" ? undefined : status,
        limit: 50,
        cursor,
      })}`,
    ),
    { enabled: canView },
  );

  const columns: Column<RedemptionQueueItem>[] = [
    { key: "player", header: "Player", render: (r) => <span className="font-medium text-text-hi">{r.playerUsername}</span> },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      render: (r) => <Money valueMinor={r.amountMinor} currency={r.currency} size="sm" />,
    },
    { key: "method", header: "Method", render: (r) => r.method ?? "—" },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
    { key: "age", header: "Age", render: (r) => timeAgo(r.createdAt) },
  ];

  if (!canView) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Redemptions" subtitle="The cashout approval queue for your subtree." />

      <SegmentedControl items={FILTERS} active={status} onChange={setStatus} />

      <Panel className="p-0">
        <DataTable
          columns={columns}
          rows={list.items}
          getRowId={(r) => r.id}
          loading={list.isLoading}
          emptyTitle="Queue is clear"
          emptyDescription="No redemptions match this filter."
          onRowClick={(r) => { router.push(`/redemptions/${r.id}`); }}
          nextCursor={list.nextCursor}
          onLoadMore={list.loadMore}
          loadingMore={list.isFetchingNextPage}
        />
      </Panel>
    </div>
  );
}
