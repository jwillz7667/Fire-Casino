"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Badge, IconButton, Money, StatusPill, cn } from "@aureus/ui";
import type { OperatorTreeNode } from "@/lib/types";
import { humanize } from "@/lib/format";

export function TreeNodeCard({
  node,
  depth,
  expanded,
  hasChildren,
  onToggle,
  onAddChild,
  canAddChild,
}: {
  node: OperatorTreeNode;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onAddChild: () => void;
  canAddChild: boolean;
}): ReactElement {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-hairline bg-surface-1 px-2.5 py-2 transition-colors hover:border-hairline-strong"
      style={{ marginLeft: depth * 20 }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasChildren}
        aria-label={expanded ? "Collapse" : "Expand"}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-sm text-text-lo",
          hasChildren ? "hover:bg-surface-3 hover:text-text-hi" : "opacity-30",
        )}
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      <Link href={`/operators/${node.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="truncate text-sm font-medium text-text-hi">{node.displayName}</span>
        <Badge intent="gold">{humanize(node.tier)}</Badge>
        <StatusPill status={node.status} />
        {node.balances && node.balances.length > 0 ? (
          <span className="flex items-center gap-1.5">
            {node.balances.map((b) => (
              <Money key={b.currency} valueMinor={b.balanceMinor} currency={b.currency} size="sm" />
            ))}
          </span>
        ) : null}
        {hasChildren ? (
          <span className="ml-auto text-[0.6875rem] text-text-lo">{node.children.length} direct</span>
        ) : null}
      </Link>

      {canAddChild ? (
        <IconButton
          label="Add child operator"
          onClick={(e) => {
            e.preventDefault();
            onAddChild();
          }}
        >
          <Plus className="h-4 w-4" />
        </IconButton>
      ) : null}
    </div>
  );
}
