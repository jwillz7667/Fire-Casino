"use client";

import { type ReactElement, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wallet } from "lucide-react";
import {
  Button,
  type Column,
  DataTable,
  ForbiddenState,
  Panel,
  SearchInput,
  SegmentedControl,
  StatusPill,
} from "@aureus/ui";
import { api, toQuery } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { Page, PlayerRow } from "@/lib/types";
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
  const [recharge, setRecharge] = useState<PlayerRow | null>(null);

  const canView = hasPermission(principal, "player.view");
  const canCreate = hasPermission(principal, "player.create");
  const canRecharge = hasPermission(principal, "player.recharge");

  const list = useCursorList<PlayerRow>(["players", "list", status, search], (cursor) =>
    api.get<Page<PlayerRow>>(
      `/players${toQuery({
        status: status === "all" ? undefined : status,
        q: search === "" ? undefined : search,
        limit: 50,
        cursor,
      })}`,
    ),
    { enabled: canView },
  );

  const columns: Column<PlayerRow>[] = [
    {
      key: "username",
      header: "Player",
      render: (p) => (
        <div className="flex flex-col">
          <span className="font-medium text-text-hi">{p.username}</span>
          {p.displayName ? <span className="text-xs text-text-lo">{p.displayName}</span> : null}
        </div>
      ),
    },
    { key: "status", header: "Status", render: (p) => <StatusPill status={p.status} /> },
    { key: "lastLogin", header: "Last active", render: (p) => formatDate(p.lastLoginAt) },
    { key: "created", header: "Joined", render: (p) => formatDate(p.createdAt) },
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
