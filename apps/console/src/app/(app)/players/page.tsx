"use client";

import { type ReactElement, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wallet } from "lucide-react";
import {
  Button,
  type Column,
  DataTable,
  ForbiddenState,
  Money,
  Panel,
  SearchInput,
  SegmentedControl,
  StatusPill,
} from "@aureus/ui";
import { api, toQuery } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { Page, PlayerListItem } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { PageHeader } from "@/components/page-header";
import { CreatePlayerDialog } from "@/components/players/create-player-dialog";
import { RechargeDialog } from "@/components/players/recharge-dialog";
import { formatDate } from "@/lib/format";

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "SUSPENDED", label: "Suspended" },
  { key: "SELF_EXCLUDED", label: "Excluded" },
];

export default function PlayersPage(): ReactElement {
  const principal = usePrincipal();
  const router = useRouter();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [recharge, setRecharge] = useState<PlayerListItem | null>(null);

  const canView = hasPermission(principal, "player.view");
  const canCreate = hasPermission(principal, "player.create");
  const canRecharge = hasPermission(principal, "player.recharge");

  const list = useCursorList<PlayerListItem>(["players", "list", status, search], (cursor) =>
    api.get<Page<PlayerListItem>>(
      `/players${toQuery({
        status: status === "all" ? undefined : status,
        q: search === "" ? undefined : search,
        limit: 50,
        cursor,
      })}`,
    ),
    { enabled: canView },
  );

  const columns: Column<PlayerListItem>[] = [
    {
      key: "username",
      header: "Player",
      sortAccessor: (p) => p.username,
      render: (p) => (
        <div className="flex flex-col">
          <span className="font-medium text-text-hi">{p.username}</span>
          {p.displayName ? <span className="text-xs text-text-lo">{p.displayName}</span> : null}
        </div>
      ),
    },
    {
      key: "agent",
      header: "Owning agent",
      sortAccessor: (p) => p.owningAgentName,
      render: (p) => <span className="text-text-mid">{p.owningAgentName}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      numeric: true,
      sortAccessor: (p) => p.wallets.reduce((sum, w) => sum + BigInt(w.balanceMinor), 0n),
      render: (p) =>
        p.wallets.length > 0 ? (
          <div className="flex flex-col items-end gap-0.5">
            {p.wallets.map((w) => (
              <Money key={w.currency} valueMinor={w.balanceMinor} currency={w.currency} size="sm" showCurrency />
            ))}
          </div>
        ) : (
          <span className="text-text-lo">—</span>
        ),
    },
    {
      key: "recharged",
      header: "Lifetime recharged",
      numeric: true,
      sortAccessor: (p) => BigInt(p.lifetimeRechargedMinor),
      render: (p) => <Money valueMinor={p.lifetimeRechargedMinor} size="sm" />,
    },
    {
      key: "redeemed",
      header: "Lifetime redeemed",
      numeric: true,
      sortAccessor: (p) => BigInt(p.lifetimeRedeemedMinor),
      render: (p) => <Money valueMinor={p.lifetimeRedeemedMinor} size="sm" />,
    },
    { key: "status", header: "Status", sortAccessor: (p) => p.status, render: (p) => <StatusPill status={p.status} /> },
    {
      key: "lastLogin",
      header: "Last active",
      sortAccessor: (p) => p.lastLoginAt ?? "",
      render: (p) => formatDate(p.lastLoginAt),
    },
  ];

  if (!canView) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Players"
        subtitle="Every player in your subtree."
        actions={
          canCreate ? (
            <Button onClick={() => { setCreateOpen(true); }}>
              <Plus className="h-4 w-4" />
              Create player
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          items={STATUS_FILTERS}
          active={status}
          onChange={setStatus}
        />
        <div className="w-full max-w-xs">
          <SearchInput value={search} onChange={setSearch} placeholder="Search username…" />
        </div>
      </div>

      <Panel className="p-0">
        <DataTable
          columns={columns}
          rows={list.items}
          getRowId={(p) => p.id}
          loading={list.isLoading}
          emptyTitle="No players"
          emptyDescription={canCreate ? "Create your first player." : "No players match these filters."}
          onRowClick={(p) => { router.push(`/players/${p.id}`); }}
          rowActions={
            canRecharge
              ? (p) => (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { setRecharge(p); }}
                    disabled={p.status !== "ACTIVE"}
                  >
                    <Wallet className="h-4 w-4" />
                    Recharge
                  </Button>
                )
              : undefined
          }
          nextCursor={list.nextCursor}
          onLoadMore={list.loadMore}
          loadingMore={list.isFetchingNextPage}
        />
      </Panel>

      <CreatePlayerDialog open={createOpen} onClose={() => { setCreateOpen(false); }} />
      {recharge ? (
        <RechargeDialog
          open={recharge !== null}
          onClose={() => { setRecharge(null); }}
          playerId={recharge.id}
          playerUsername={recharge.username}
        />
      ) : null}
    </div>
  );
}
