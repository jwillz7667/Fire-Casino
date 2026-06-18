"use client";

import { type ReactElement, useMemo } from "react";
import { fromMinor } from "@aureus/shared";
import { EmptyState } from "@aureus/ui";
import type { CreditFlowPoint } from "@/lib/types";
import { formatDate } from "@/lib/format";

type Series = "issuedMinor" | "transferredMinor" | "rechargedMinor" | "redeemedMinor";

const SERIES: { key: Series; label: string; color: string }[] = [
  { key: "issuedMinor", label: "Issued", color: "var(--color-gold)" },
  { key: "rechargedMinor", label: "Recharged", color: "var(--color-lumen)" },
  { key: "transferredMinor", label: "Transferred", color: "var(--color-hairline-strong)" },
  { key: "redeemedMinor", label: "Redeemed", color: "var(--color-ember)" },
];

/** Grouped-bar credit flow over time, pure SVG (docs/06 §3.1). */
export function CreditFlowChart({ points }: { points?: CreditFlowPoint[] }): ReactElement {
  const data = points ?? [];
  const max = useMemo(() => {
    let m = 1n;
    for (const p of data) {
      for (const s of SERIES) {
        const v = BigInt(p[s.key] || "0");
        if (v > m) m = v;
      }
    }
    return m;
  }, [data]);

  if (data.length === 0) {
    return <EmptyState title="No credit flow yet" description="Issues, recharges and redemptions will chart here." />;
  }

  const height = 200;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-text-mid">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ height: height + 28 }}>
        {data.map((p) => (
          <div key={p.bucket} className="flex min-w-12 flex-1 flex-col items-center gap-1">
            <div className="flex h-[200px] w-full items-end justify-center gap-0.5">
              {SERIES.map((s) => {
                const value = BigInt(p[s.key] || "0");
                const pct = max > 0n ? Number((value * 1000n) / max) / 10 : 0;
                const barHeight = Math.max(value > 0n ? 2 : 0, (pct / 100) * height);
                return (
                  <div
                    key={s.key}
                    className="w-1.5 rounded-t-sm"
                    style={{ height: `${barHeight}px`, background: s.color }}
                    title={`${s.label}: ${fromMinor(value)}`}
                  />
                );
              })}
            </div>
            <span className="text-[0.625rem] text-text-lo">{formatDate(p.bucket)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
