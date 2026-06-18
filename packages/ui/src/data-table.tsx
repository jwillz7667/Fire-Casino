"use client";

import { type ReactElement, type ReactNode, useMemo, useState } from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
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
  /**
   * Make this column sortable. Provide a comparable value per row; the table
   * sorts the currently-loaded rows client-side (cursor pages append to them).
   */
  sortAccessor?: (row: Row) => string | number | bigint | null | undefined;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

function compareValues(
  a: string | number | bigint | null | undefined,
  b: string | number | bigint | null | undefined,
): number {
  // Nullish always sorts last regardless of direction's later inversion.
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "bigint" || typeof b === "bigint") {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
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
  const [sort, setSort] = useState<SortState>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortAccessor) return rows;
    const accessor = col.sortAccessor;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => factor * compareValues(accessor(a), accessor(b)));
  }, [rows, sort, columns]);

  function toggleSort(key: string): void {
    setSort((prev) =>
      prev?.key === key
        ? prev.dir === "asc"
          ? { key, dir: "desc" }
          : null
        : { key, dir: "asc" },
    );
  }

  if (loading) return <CoinSpinner label="Loading…" />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <div className={cn("overflow-hidden rounded-md border border-hairline", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr className="border-b border-hairline">
              {columns.map((c) => {
                const sortable = Boolean(c.sortAccessor);
                const active = sort?.key === c.key;
                const alignClass = ALIGN[c.align ?? (c.numeric ? "right" : "left")];
                return (
                  <th
                    key={c.key}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn(
                      "px-3 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-text-mid",
                      alignClass,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => { toggleSort(c.key); }}
                        className={cn(
                          "inline-flex items-center gap-1 transition-colors hover:text-text-hi",
                          c.numeric || c.align === "right" ? "flex-row-reverse" : "",
                          active && "text-text-hi",
                        )}
                      >
                        {c.header}
                        {active ? (
                          sort.dir === "asc" ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowActions ? <th className="w-10 px-3 py-2.5" /> : null}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
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
