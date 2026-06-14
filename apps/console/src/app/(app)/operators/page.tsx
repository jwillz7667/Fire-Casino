"use client";

import { type ReactElement, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge, Button, type Column, DataTable, Panel, SegmentedControl, StatusPill } from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { OperatorNode, Page } from "@/lib/types";
import { useCursorList } from "@/lib/use-cursor-list";
import { PageHeader } from "@/components/page-header";
import { CreateOperatorDialog } from "@/components/operators/create-operator-dialog";
import { ForbiddenState } from "@aureus/ui";
import { formatDate, humanize } from "@/lib/format";

export default function OperatorsPage(): ReactElement {
  const principal = usePrincipal();
  const router = useRouter();
  const [scope, setScope] = useState<"children" | "subtree">("children");
  const [createOpen, setCreateOpen] = useState(false);

  const canView = hasPermission(principal, "operator.view_subtree");
  const canCreate = hasPermission(principal, "operator.create_child");

  const list = useCursorList<OperatorNode>(
    ["operators", "list", scope],
    (cursor) =>
      api.get<Page<OperatorNode>>(`/operators?scope=${scope}&limit=50${cursor ? `&cursor=${cursor}` : ""}`),
    { enabled: canView },
  );

  const columns: Column<OperatorNode>[] = [
    { key: "name", header: "Operator", render: (o) => <span className="font-medium text-text-hi">{o.displayName}</span> },
    { key: "tier", header: "Tier", render: (o) => <Badge intent="gold">{humanize(o.tier)}</Badge> },
    { key: "status", header: "Status", render: (o) => <StatusPill status={o.status} /> },
    { key: "depth", header: "Depth", numeric: true, render: (o) => o.depth },
    { key: "created", header: "Created", render: (o) => formatDate(o.createdAt) },
  ];

  if (!canView) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operators"
        subtitle="Manage the nodes in your distribution tree."
        actions={
          canCreate ? (
            <Button onClick={() => { setCreateOpen(true); }}>
              <Plus className="h-4 w-4" />
              Add operator
            </Button>
          ) : undefined
        }
      />

      <SegmentedControl
        items={[
          { key: "children", label: "Direct children" },
          { key: "subtree", label: "Whole subtree" },
        ]}
        active={scope}
        onChange={(k) => { setScope(k as "children" | "subtree"); }}
      />

      <Panel className="p-0">
        <DataTable
          columns={columns}
          rows={list.items}
          getRowId={(o) => o.id}
          loading={list.isLoading}
          emptyTitle="No operators"
          emptyDescription="Create your first child operator to get started."
          onRowClick={(o) => { router.push(`/operators/${o.id}`); }}
          nextCursor={list.nextCursor}
          onLoadMore={list.loadMore}
          loadingMore={list.isFetchingNextPage}
        />
      </Panel>

      <CreateOperatorDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); }}
        parent={{ id: principal.operatorId, tier: principal.tier, displayName: principal.displayName }}
      />
    </div>
  );
}
