"use client";

import { type ReactElement, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { OperatorTier } from "@aureus/shared";
import { Button, Panel, SearchInput } from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import type { OperatorTreeNode } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { QueryBoundary } from "@/components/query-boundary";
import { TreeNodeCard } from "@/components/operators/tree-node-card";
import { CreateOperatorDialog } from "@/components/operators/create-operator-dialog";

function flatten(node: OperatorTreeNode): OperatorTreeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function matches(node: OperatorTreeNode, term: string): boolean {
  const t = term.toLowerCase();
  return (
    node.displayName.toLowerCase().includes(t) ||
    node.tier.toLowerCase().includes(t) ||
    node.status.toLowerCase().includes(t)
  );
}

export default function OrgPage(): ReactElement {
  const principal = usePrincipal();
  const canCreate = hasPermission(principal, "operator.create_child");

  const tree = useQuery({
    queryKey: ["operators", "tree", principal.operatorId],
    queryFn: () => api.get<OperatorTreeNode>(`/operators/${principal.operatorId}/tree?depth=6`),
  });

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set([principal.operatorId]));
  const [createParent, setCreateParent] = useState<{ id: string; tier: OperatorTier; displayName: string } | null>(
    null,
  );

  const visibleIds = useMemo(() => {
    if (!tree.data || search.trim() === "") return null;
    const ids = new Set<string>();
    const all = flatten(tree.data);
    for (const node of all) {
      if (matches(node, search)) {
        // include the node and its ancestor chain by path
        for (const other of all) {
          if (node.path === other.path || node.path.startsWith(`${other.path}.`)) ids.add(other.id);
        }
      }
    }
    return ids;
  }, [tree.data, search]);

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: OperatorTreeNode, depth: number): ReactElement | null {
    if (visibleIds && !visibleIds.has(node.id)) return null;
    const isExpanded = visibleIds ? true : expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.id} className="flex flex-col gap-1.5">
        <TreeNodeCard
          node={node}
          depth={depth}
          expanded={isExpanded}
          hasChildren={hasChildren}
          onToggle={() => { toggle(node.id); }}
          canAddChild={canCreate && node.tier !== "STORE"}
          onAddChild={() => {
            setCreateParent({ id: node.id, tier: node.tier, displayName: node.displayName });
          }}
        />
        {isExpanded ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Organization"
        subtitle="Your subtree, rooted at your node."
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setCreateParent({ id: principal.operatorId, tier: principal.tier, displayName: principal.displayName });
              }}
            >
              <Plus className="h-4 w-4" />
              Add operator
            </Button>
          ) : undefined
        }
      />

      <div className="max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, tier, status…" />
      </div>

      <Panel>
        <QueryBoundary isLoading={tree.isLoading} error={tree.error} onRetry={() => { void tree.refetch(); }}>
          <div className="flex flex-col gap-1.5">{tree.data ? renderNode(tree.data, 0) : null}</div>
        </QueryBoundary>
      </Panel>

      {createParent ? (
        <CreateOperatorDialog
          open={createParent !== null}
          onClose={() => { setCreateParent(null); }}
          parent={createParent}
        />
      ) : null}
    </div>
  );
}
