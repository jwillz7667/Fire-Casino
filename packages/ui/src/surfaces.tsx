import { type ReactElement, type ReactNode } from "react";
import { type Currency } from "@aureus/shared";
import { CoinMark, Money } from "./money";
import { cn } from "./cn";

/** Token-driven surface with a faint lit top edge (docs/08 §4.1). */
export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}): ReactElement {
  return (
    <Tag
      className={cn(
        "rounded-md border border-hairline bg-surface-1 shadow-[inset_0_1px_0_0_rgba(58,77,120,0.35)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <Card className={cn("p-5", className)}>{children}</Card>;
}

export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <h2 className={cn("text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-text-mid", className)}>
      {children}
    </h2>
  );
}

export type Intent = "neutral" | "success" | "warning" | "danger" | "info" | "gold" | "ember";

const INTENT_CLASS: Record<Intent, string> = {
  neutral: "bg-surface-3 text-text-mid border-hairline",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  info: "bg-lumen/15 text-lumen border-lumen/30",
  gold: "bg-gold/15 text-gold-light border-gold/30",
  ember: "bg-ember/15 text-ember border-ember/30",
};

export function Badge({
  children,
  intent = "neutral",
  className,
}: {
  children: ReactNode;
  intent?: Intent;
  className?: string;
}): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[0.6875rem] font-medium",
        INTENT_CLASS[intent],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps a domain status string to a semantic colour (docs/08 §7). */
const STATUS_INTENT: Record<string, Intent> = {
  ACTIVE: "success",
  VERIFIED: "success",
  PAID: "success",
  ISSUED: "success",
  APPROVED: "info",
  PENDING: "warning",
  REQUESTED: "warning",
  AWAITING_PAYMENT: "warning",
  REVIEWING: "warning",
  OPEN: "warning",
  ESCALATED: "danger",
  SUSPENDED: "danger",
  REJECTED: "danger",
  CANCELLED: "neutral",
  CLOSED: "neutral",
  SELF_EXCLUDED: "danger",
  BLOCK: "danger",
  ALLOW: "success",
  CLEARED: "success",
  NONE: "neutral",
};

export function StatusPill({ status, className }: { status: string; className?: string }): ReactElement {
  const intent = STATUS_INTENT[status] ?? "neutral";
  return (
    <Badge intent={intent} className={cn("uppercase tracking-wide", className)}>
      {status.replaceAll("_", " ").toLowerCase()}
    </Badge>
  );
}

export interface KpiStatProps {
  label: string;
  /** Either a money value or a plain string/number. */
  valueMinor?: bigint | string;
  currency?: Currency;
  value?: ReactNode;
  hint?: string;
  className?: string;
}

export function KpiStat({ label, valueMinor, currency, value, hint, className }: KpiStatProps): ReactElement {
  return (
    <Card className={cn("p-4", className)}>
      <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-text-mid">{label}</div>
      <div className="mt-2">
        {valueMinor !== undefined ? (
          <Money valueMinor={valueMinor} currency={currency} size="lg" />
        ) : (
          <span className="font-mono text-2xl tabular-nums text-text-hi">{value}</span>
        )}
      </div>
      {hint ? <div className="mt-1 text-xs text-text-lo">{hint}</div> : null}
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }): ReactElement {
  return <div className={cn("animate-pulse rounded-sm bg-surface-3", className)} aria-hidden="true" />;
}

/** The coin spinner (docs/08 §6) — loading state across both apps. */
export function CoinSpinner({ size = "md", label }: { size?: "sm" | "md" | "lg"; label?: string }): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8" role="status" aria-live="polite">
      <CoinMark size={size === "sm" ? "md" : size === "lg" ? "xl" : "lg"} spin glow />
      {label ? <span className="text-sm text-text-mid">{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      <CoinMark size="xl" glow />
      <div className="text-lg font-medium text-text-hi">{title}</div>
      {description ? <div className="max-w-sm text-sm text-text-mid">{description}</div> : null}
      {action}
    </div>
  );
}

export function ForbiddenState({ message }: { message?: string }): ReactElement {
  return (
    <EmptyState
      title="Not in your area"
      description={message ?? "This record is outside the part of the tree you can access."}
    />
  );
}

export function RegionBlockedState({ message }: { message?: string }): ReactElement {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <CoinMark size="xl" variant="ember" glow />
      <div className="text-xl font-medium text-text-hi">Not available in your area</div>
      <div className="max-w-sm text-sm text-text-mid">
        {message ?? "Access from your current region is restricted. Contact support if you believe this is an error."}
      </div>
    </div>
  );
}

export function ModeBadge({ mode }: { mode: "OPERATOR" | "COMPLIANCE" }): ReactElement {
  return (
    <Badge intent={mode === "COMPLIANCE" ? "ember" : "gold"} className="uppercase tracking-wide">
      {mode}
    </Badge>
  );
}

export function ScopeIndicator({
  displayName,
  tier,
  className,
}: {
  displayName: string;
  tier: string;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("flex flex-col leading-tight", className)}>
      <span className="text-sm font-medium text-text-hi">{displayName}</span>
      <span className="text-[0.6875rem] uppercase tracking-wide text-text-lo">{tier.replaceAll("_", " ")}</span>
    </div>
  );
}
