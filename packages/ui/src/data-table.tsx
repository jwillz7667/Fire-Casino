"use client";

import { type ReactElement, type ReactNode } from "react";
import { Button } from "./controls";
import { CoinSpinner, EmptyState } from "./surfaces";
import { cn } from "./cn";

export interface Column<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  align?: "left" | "right" | "center";
  /** Money/number columns render mono+tabular and right-align by default. */
  numeric?: boolean;
  className?: string;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: Row) => void;
  rowActions?: (row: Row) => ReactNode;
  nextCursor?: string;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  className?: string;
}

const ALIGN: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * The console workhorse table (docs/08 §7): sticky header on surface-2, tabular
 * money columns, row actions, cursor "load more" pagination, and designed empty
 * + loading states.
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  loading = false,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  onRowClick,
  rowActions,
  nextCursor,
  onLoadMore,
  loadingMore = false,
  className,
}: DataTableProps<Row>): ReactElement {
  if (loading) return <CoinSpinner label="Loading…" />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <div className={cn("overflow-hidden rounded-md border border-hairline", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="border-b border-hairline">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-3 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-text-mid",
                    ALIGN[c.align ?? (c.numeric ? "right" : "left")],
                  )}
                >
                  {c.header}
                </th>
              ))}
              {rowActions ? <th className="w-10 px-3 py-2.5" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => { onRowClick(row); } : undefined}
                className={cn(
                  "border-b border-hairline/60 transition-colors last:border-0",
                  onRowClick && "cursor-pointer hover:bg-surface-2/60",
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2.5 text-text-hi",
                      ALIGN[c.align ?? (c.numeric ? "right" : "left")],
                      c.numeric && "font-mono tabular-nums",
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
                {rowActions ? (
                  <td className="px-3 py-2.5 text-right" onClick={(e) => { e.stopPropagation(); }}>
                    {rowActions(row)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextCursor && onLoadMore ? (
        <div className="flex justify-center border-t border-hairline bg-surface-1 p-3">
          <Button variant="ghost" size="sm" onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
