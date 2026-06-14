// Non-money formatting helpers. Money formatting lives ONLY in <Money> /
// <BalanceChip> (docs/08) — never format a balance here.

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_ONLY = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_TIME.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_ONLY.format(date);
}

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

export function timeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(deltaSeconds);
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === "second") {
      return RELATIVE.format(Math.round(deltaSeconds / secs), unit);
    }
  }
  return "just now";
}

/** Humanize an UPPER_SNAKE enum/tier for display. */
export function humanize(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format integer cents as a USD-ish string (off-platform cash, not credits). */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}
