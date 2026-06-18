"use client";

import { type ReactElement, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Ban, CircleCheck, Pencil, ShieldCheck, XCircle } from "lucide-react";
import {
  Badge,
  BalanceChip,
  Button,
  type Column,
  DataTable,
  EmptyState,
  KpiStat,
  Money,
  Panel,
  SectionTitle,
  StatusPill,
  Tabs,
  useToast,
} from "@aureus/ui";
import { api, ApiError } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { BalanceEntry, CreditOrder, OperatorNode, OperatorStats, Page } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { PageHeader } from "@/components/page-header";
import { QueryBoundary } from "@/components/query-boundary";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EditOperatorDialog } from "@/components/operators/edit-operator-dialog";
import { GrantsDialog } from "@/components/operators/grants-dialog";
import { TransferCreditsDialog } from "@/components/operators/transfer-credits-dialog";
import { formatDate, formatCents, humanize } from "@/lib/format";

type TabKey = "overview" | "children" | "credit" | "orders" | "settings";

interface OperatorLedgerEntry {
  id: string;
  type: string;
  direction: "DEBIT" | "CREDIT";
  currency: BalanceEntry["currency"];
  amountMinor: string;
  balanceAfterMinor: string;
  memo: string | null;
  createdAt: string;
}

export default function OperatorDetailPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();

  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "overview";
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [editOpen, setEditOpen] = useState(false);
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const operator = useQuery({
    queryKey: ["operator", id],
    queryFn: () => api.get<OperatorNode>(`/operators/${id}`),
  });
  const balance = useQuery({
    queryKey: ["operator", id, "balance"],
    queryFn: () => api.get<BalanceEntry[]>(`/operators/${id}/balance`),
    enabled: operator.isSuccess,
  });
  const stats = useQuery({
    queryKey: ["operator", id, "stats"],
    queryFn: () => api.get<OperatorStats>(`/operators/${id}/stats`),
    enabled: operator.isSuccess && hasPermission(principal, "report.view"),
    retry: false,
  });

  const setStatus = useMutation({
    mutationFn: (action: "suspend" | "activate") => api.post<OperatorNode>(`/operators/${id}/${action}`),
    onSuccess: (_data, action) => {
      toast.push({ title: action === "suspend" ? "Operator suspended" : "Operator activated", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["operator", id] });
      void queryClient.invalidateQueries({ queryKey: ["operators"] });
    },
    onError: (err) => {
      toast.push({ title: "Action failed", description: err instanceof ApiError ? err.message : "", intent: "danger" });
    },
  });

  const closeNode = useMutation({
    mutationFn: () => api.post<OperatorNode>(`/operators/${id}/close`),
    onSuccess: () => {
      toast.push({ title: "Operator closed", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["operators"] });
      setCloseOpen(false);
      router.push("/operators");
    },
    onError: (err) => {
      toast.push({ title: "Couldn't close", description: err instanceof ApiError ? err.message : "", intent: "danger" });
      setCloseOpen(false);
    },
  });

  const node = operator.data;
  const isDirectChild = node?.parentId === principal.operatorId;
  const canManage = hasPermission(principal, "operator.suspend");
  const canTransfer = hasPermission(principal, "credit.transfer_down") && isDirectChild;
  const canGrant = hasPermission(principal, "operator.create_child");
  const canEdit = hasPermission(principal, "operator.set_pricing");

  return (
    <div className="flex flex-col gap-6">
      <Link href="/operators" className="text-sm text-text-mid hover:text-text-hi">
        ← All operators
      </Link>

      <QueryBoundary isLoading={operator.isLoading} error={operator.error} onRetry={() => { void operator.refetch(); }}>
        {node ? (
          <>
            <PageHeader
              title={
                <span className="flex items-center gap-3">
                  {node.displayName}
                  <Badge intent="gold">{humanize(node.tier)}</Badge>
                  <StatusPill status={node.status} />
                </span>
              }
              subtitle={<span className="font-mono text-xs">{node.path}</span>}
              actions={
                <div className="flex flex-wrap gap-2">
                  {canEdit ? (
                    <Button variant="secondary" size="sm" onClick={() => { setEditOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                  ) : null}
                  {canTransfer ? (
                    <Button variant="secondary" size="sm" onClick={() => { setTransferOpen(true); }}>
                      <ArrowLeftRight className="h-4 w-4" />
                      Transfer
                    </Button>
                  ) : null}
                  {canGrant ? (
                    <Button variant="secondary" size="sm" onClick={() => { setGrantsOpen(true); }}>
                      <ShieldCheck className="h-4 w-4" />
                      Grants
                    </Button>
                  ) : null}
                  {canManage && node.status === "ACTIVE" ? (
                    <Button variant="ghost" size="sm" onClick={() => { setStatus.mutate("suspend"); }}>
                      <Ban className="h-4 w-4" />
                      Suspend
                    </Button>
                  ) : null}
                  {canManage && node.status === "SUSPENDED" ? (
                    <Button variant="ghost" size="sm" onClick={() => { setStatus.mutate("activate"); }}>
                      <CircleCheck className="h-4 w-4" />
                      Activate
                    </Button>
                  ) : null}
                  {canManage && node.status !== "CLOSED" ? (
                    <Button variant="ghost" size="sm" onClick={() => { setCloseOpen(true); }}>
                      <XCircle className="h-4 w-4" />
                      Close
                    </Button>
                  ) : null}
                </div>
              }
            />

            <Tabs
              active={tab}
              onChange={(k) => { setTab(k as TabKey); }}
              items={[
                { key: "overview", label: "Overview" },
                { key: "children", label: "Children" },
                { key: "credit", label: "Credit history" },
                { key: "orders", label: "Orders" },
                { key: "settings", label: "Settings" },
              ]}
            />

            {tab === "overview" ? <OverviewTab balances={balance.data ?? []} stats={stats.data} /> : null}
            {tab === "children" ? <ChildrenTab parentId={id} /> : null}
            {tab === "credit" ? <CreditHistoryTab operatorId={id} /> : null}
            {tab === "orders" ? <OrdersTab operatorId={id} /> : null}
            {tab === "settings" ? (
              <Panel className="flex flex-col gap-4">
                <SectionTitle>Pricing &amp; settings</SectionTitle>
                <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                  <Detail label="Buy price" value={formatCents(node.buyUnitPriceCents)} />
                  <Detail label="Sell price" value={formatCents(node.sellUnitPriceCents)} />
                  <Detail label="Depth" value={String(node.depth)} />
                  <Detail label="Created" value={formatDate(node.createdAt)} />
                  <Detail
                    label="Prize bonus"
                    value={node.prizeBonusBps != null ? `${node.prizeBonusBps} bps` : "—"}
                  />
                </dl>

                <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-2 p-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-text-mid">Redemption routing</span>
                  {node.redemptionApproval ? (
                    <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                      <Detail
                        label="Approver tier"
                        value={node.redemptionApproval.approverTier ? humanize(node.redemptionApproval.approverTier) : "—"}
                      />
                      <Detail
                        label="Threshold"
                        value={
                          node.redemptionApproval.thresholdMinor != null
                            ? String(node.redemptionApproval.thresholdMinor)
                            : "—"
                        }
                      />
                      <Detail
                        label="Funding"
                        value={node.redemptionApproval.funding ? humanize(node.redemptionApproval.funding) : "—"}
                      />
                    </dl>
                  ) : (
                    <span className="text-sm text-text-lo">Not routed — redemptions follow the default path.</span>
                  )}
                </div>

                {canEdit ? (
                  <div>
                    <Button variant="secondary" size="sm" onClick={() => { setEditOpen(true); }}>
                      Edit settings
                    </Button>
                  </div>
                ) : null}
              </Panel>
            ) : null}

            <EditOperatorDialog open={editOpen} onClose={() => { setEditOpen(false); }} operator={node} />
            {grantsOpen ? (
              <GrantsDialog
                open={grantsOpen}
                onClose={() => { setGrantsOpen(false); }}
                operatorId={id}
                current={node.grants ?? []}
              />
            ) : null}
            <TransferCreditsDialog
              open={transferOpen}
              onClose={() => { setTransferOpen(false); }}
              fromOperatorId={principal.operatorId}
              toOperator={{ id: node.id, displayName: node.displayName }}
            />
            <ConfirmDialog
              open={closeOpen}
              onClose={() => { setCloseOpen(false); }}
              onConfirm={() => { closeNode.mutate(); }}
              title="Close this operator?"
              description="Closing is terminal and requires a zero balance and no children."
              confirmLabel="Close operator"
              danger
              loading={closeNode.isPending}
            />
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}

function OverviewTab({
  balances,
  stats,
}: {
  balances: BalanceEntry[];
  stats: OperatorStats | undefined;
}): ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-col gap-3">
        <SectionTitle>Balance</SectionTitle>
        {balances.length > 0 ? (
          <BalanceChip balances={balances.map((b) => ({ currency: b.currency, valueMinor: b.balanceMinor }))} />
        ) : (
          <span className="text-sm text-text-lo">No accounts.</span>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiStat
          label="Circulation below"
          valueMinor={stats?.circulationBelowMinor}
          value={stats ? undefined : "—"}
        />
        <KpiStat label="Operators below" value={stats?.operatorCount ?? "—"} />
        <KpiStat label="Active players" value={stats?.activePlayers ?? "—"} />
      </div>
    </div>
  );
}

function ChildrenTab({ parentId }: { parentId: string }): ReactElement {
  const router = useRouter();
  const list = useCursorList<OperatorNode>(["operators", "children", parentId], (cursor) =>
    api.get<Page<OperatorNode>>(
      `/operators?scope=children&parentId=${parentId}&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
    ),
  );
  const columns: Column<OperatorNode>[] = [
    { key: "name", header: "Operator", render: (o) => <span className="text-text-hi">{o.displayName}</span> },
    { key: "tier", header: "Tier", render: (o) => <Badge intent="gold">{humanize(o.tier)}</Badge> },
    { key: "status", header: "Status", render: (o) => <StatusPill status={o.status} /> },
    { key: "created", header: "Created", render: (o) => formatDate(o.createdAt) },
  ];
  return (
    <Panel className="p-0">
      <DataTable
        columns={columns}
        rows={list.items}
        getRowId={(o) => o.id}
        loading={list.isLoading}
        emptyTitle="No children"
        onRowClick={(o) => { router.push(`/operators/${o.id}`); }}
        nextCursor={list.nextCursor}
        onLoadMore={list.loadMore}
        loadingMore={list.isFetchingNextPage}
      />
    </Panel>
  );
}

function CreditHistoryTab({ operatorId }: { operatorId: string }): ReactElement {
  const list = useCursorList<OperatorLedgerEntry>(
    ["operator", operatorId, "ledger"],
    (cursor) =>
      api.get<Page<OperatorLedgerEntry>>(
        `/operators/${operatorId}/ledger?limit=50${cursor ? `&cursor=${cursor}` : ""}`,
      ),
  );

  if (list.error instanceof ApiError) {
    return (
      <Panel>
        <EmptyState title="Credit history unavailable" description="No ledger entries to show for this node yet." />
      </Panel>
    );
  }

  const columns: Column<OperatorLedgerEntry>[] = [
    { key: "type", header: "Type", render: (e) => <StatusPill status={e.type} /> },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      render: (e) => (
        <Money
          valueMinor={e.direction === "DEBIT" ? `-${e.amountMinor}` : e.amountMinor}
          currency={e.currency}
          signed
          size="sm"
        />
      ),
    },
    {
      key: "balance",
      header: "Balance after",
      numeric: true,
      render: (e) => <Money valueMinor={e.balanceAfterMinor} currency={e.currency} size="sm" />,
    },
    { key: "memo", header: "Memo", render: (e) => e.memo ?? "—" },
    { key: "at", header: "When", render: (e) => formatDate(e.createdAt) },
  ];

  return (
    <Panel className="p-0">
      <DataTable
        columns={columns}
        rows={list.items}
        getRowId={(e) => e.id}
        loading={list.isLoading}
        emptyTitle="No credit history"
        nextCursor={list.nextCursor}
        onLoadMore={list.loadMore}
        loadingMore={list.isFetchingNextPage}
      />
    </Panel>
  );
}

function OrdersTab({ operatorId }: { operatorId: string }): ReactElement {
  const router = useRouter();
  const list = useCursorList<CreditOrder>(["operator", operatorId, "orders"], (cursor) =>
    api.get<Page<CreditOrder>>(
      `/orders?operatorId=${operatorId}&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
    ),
  );

  if (list.error instanceof ApiError) {
    return (
      <Panel>
        <EmptyState title="Orders unavailable" description="No credit orders to show for this node yet." />
      </Panel>
    );
  }

  const columns: Column<CreditOrder>[] = [
    {
      key: "direction",
      header: "Direction",
      render: (o) =>
        o.buyerOperatorId === operatorId ? (
          <Badge intent="warning">Buying</Badge>
        ) : (
          <Badge intent="gold">Selling</Badge>
        ),
    },
    {
      key: "counterparty",
      header: "Counterparty",
      render: (o) =>
        o.buyerOperatorId === operatorId
          ? (o.sellerName ?? "Upline")
          : (o.buyerName ?? o.buyerOperatorId.slice(0, 8)),
    },
    {
      key: "quantity",
      header: "Quantity",
      numeric: true,
      render: (o) => <Money valueMinor={o.quantityMinor} currency={o.currency} size="sm" />,
    },
    { key: "total", header: "Total", numeric: true, render: (o) => formatCents(o.totalCents) },
    { key: "status", header: "Status", render: (o) => <StatusPill status={o.status} /> },
    { key: "at", header: "Requested", render: (o) => formatDate(o.createdAt) },
  ];

  return (
    <Panel className="p-0">
      <DataTable
        columns={columns}
        rows={list.items}
        getRowId={(o) => o.id}
        loading={list.isLoading}
        emptyTitle="No orders"
        emptyDescription="This operator has no credit orders."
        onRowClick={(o) => { router.push(`/credits?order=${o.id}`); }}
        nextCursor={list.nextCursor}
        onLoadMore={list.loadMore}
        loadingMore={list.isFetchingNextPage}
      />
    </Panel>
  );
}

function Detail({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.6875rem] uppercase tracking-wide text-text-lo">{label}</dt>
      <dd className="text-text-hi">{value}</dd>
    </div>
  );
}
