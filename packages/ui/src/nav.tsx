"use client";

import { type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem {
  key: string;
  label: ReactNode;
  badge?: ReactNode;
}

export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("flex gap-1 border-b border-hairline", className)} role="tablist">
      {items.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={selected}
            onClick={() => {
              onChange(t.key);
            }}
            className={cn(
              "relative inline-flex items-center gap-2 px-3 py-2.5 text-sm transition-colors outline-none",
              selected ? "text-text-hi" : "text-text-mid hover:text-text-hi",
            )}
          >
            {t.label}
            {t.badge}
            {selected ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("inline-flex rounded-md border border-hairline bg-surface-2 p-0.5", className)}>
      {items.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => {
              onChange(t.key);
            }}
            className={cn(
              "rounded-sm px-3 py-1.5 text-sm transition-colors outline-none",
              selected ? "bg-surface-3 text-text-hi shadow-sm" : "text-text-mid hover:text-text-hi",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
