"use client";

import { type ReactElement, useState } from "react";
import { Coins, Plus } from "lucide-react";
import {
  Button,
  type Column,
  DataTable,
  ForbiddenState,
  Money,
  Panel,
  SectionTitle,
  StatusPill,
  Tabs,
} from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { CreditOrder, Page } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { PageHeader } from "@/components/page-header";
import { IssueDialog } from "@/components/credits/issue-dialog";
import { NewOrderDialog } from "@/components/credits/new-order-dialog";
import { OrderRowActions } from "@/components/credits/order-row-actions";
import { formatCents, formatDate } from "@/lib/format";

export default function CreditsPage(): ReactElement {
  const principal = usePrincipal();
  const [role, setRole] = useState<"seller" | "buyer">("seller");
  const [issueOpen, setIssueOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);

  const canView = hasPermission(principal, "order.view");
  const canMint = hasPermission(principal, "credit.mint");
  const canRequest = hasPermission(principal, "order.request_up");

  const orders = useCursorList<CreditOrder>(["orders", "list", role], (cursor) =>
    api.get<Page<CreditOrder>>(`/orders?role=${role}&limit=50${cursor ? `&cursor=${cursor}` : ""}`),
    { enabled: canView },
  );

  const columns: Column<CreditOrder>[] = [
    {
      key: "quantity",
      header: "Quantity",
      numeric: true,
      render: (o) => <Money valueMinor={o.quantityMinor} currency={o.currency} size="sm" />,
    },
    { key: "price", header: "Cash", numeric: true, render: (o) => formatCents(o.totalCents) },
    { key: "method", header: "Method", render: (o) => o.paymentMethod ?? "—" },
    { key: "status", header: "Status", render: (o) => <StatusPill status={o.status} /> },
    { key: "created", header: "Requested", render: (o) => formatDate(o.createdAt) },
  ];

  if (!canView) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Credits"
        subtitle="Issue new credits and manage the buy/sell order workflow."
        actions={
          <div className="flex gap-2">
            {canMint ? (
              <Button onClick={() => { setIssueOpen(true); }}>
                <Coins className="h-4 w-4" />
                Issue credits
              </Button>
            ) : null}
            {canRequest ? (
              <Button variant="secondary" onClick={() => { setOrderOpen(true); }}>
                <Plus className="h-4 w-4" />
                Request credits
              </Button>
            ) : null}
          </div>
        }
      />

      <Panel className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <SectionTitle>Orders</SectionTitle>
          <Tabs
            active={role}
            onChange={(k) => { setRole(k as "seller" | "buyer"); }}
            items={[
              { key: "seller", label: "Inbox (selling)" },
              { key: "buyer", label: "Outbox (buying)" },
            ]}
          />
        </div>

        <DataTable
          columns={columns}
          rows={orders.items}
          getRowId={(o) => o.id}
          loading={orders.isLoading}
          emptyTitle={role === "seller" ? "No incoming orders" : "No outgoing orders"}
          emptyDescription={
            role === "seller"
              ? "Requests from your children will appear here."
              : "Request credits from your upline to get started."
          }
          rowActions={(o) => <OrderRowActions order={o} role={role} />}
          nextCursor={orders.nextCursor}
          onLoadMore={orders.loadMore}
          loadingMore={orders.isFetchingNextPage}
        />
      </Panel>

      <IssueDialog open={issueOpen} onClose={() => { setIssueOpen(false); }} />
      <NewOrderDialog open={orderOpen} onClose={() => { setOrderOpen(false); }} />
    </div>
  );
}
