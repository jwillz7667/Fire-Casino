import { type ReactElement } from "react";
import { type Currency, fromMinor } from "@aureus/shared";
import { cn } from "./cn";

/**
 * Currency colour language (docs/08 §1.5): credits/PLAY render gold, redeemable
 * PRIZE renders ember, the house/system reads teal. The single source of money
 * rendering — money is never formatted anywhere else in either app.
 */
export type MoneyTone = "gold" | "ember" | "lumen" | "neutral";

export function toneForCurrency(currency?: Currency): MoneyTone {
  if (currency === "PRIZE") return "ember";
  return "gold";
}

const TONE_TEXT: Record<MoneyTone, string> = {
  gold: "text-gold-light",
  ember: "text-ember",
  lumen: "text-lumen",
  neutral: "text-text-hi",
};

export interface MoneyProps {
  valueMinor: bigint | string;
  currency?: Currency;
  /** Override the colour derived from currency. */
  tone?: MoneyTone;
  /** Render a +/- arrow + semantic colour for deltas. */
  signed?: boolean;
  /** Append the currency code as a small suffix. */
  showCurrency?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<MoneyProps["size"]>, string> = {
  sm: "text-[0.8125rem] leading-[1.4]",
  md: "text-base leading-[1.4]",
  lg: "text-2xl leading-[1.2]",
  xl: "text-[3.5rem] leading-[1.05]",
};

/**
 * Coerce a minor-unit value to BigInt without ever throwing at render. Money is
 * the single rendering point for balances, so malformed/absent API data (a missing
 * field, a contract drift) must degrade to 0 — never crash the page (docs/06 §4).
 */
function parseMinor(value: bigint | string | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (value === null || value === undefined) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * Render a BigInt minor-unit value via fromMinor, mono + tabular figures,
 * currency-coloured. `signed` shows a delta with success/danger colour.
 */
export function Money({
  valueMinor,
  currency,
  tone,
  signed = false,
  showCurrency = false,
  size = "md",
  className,
}: MoneyProps): ReactElement {
  const minor = parseMinor(valueMinor);
  const negative = minor < 0n;
  const text = fromMinor(negative ? -minor : minor);
  const resolvedTone = tone ?? toneForCurrency(currency);

  const colour = signed
    ? negative
      ? "text-danger"
      : "text-success"
    : TONE_TEXT[resolvedTone];

  const prefix = signed ? (negative ? "−" : "+") : negative ? "−" : "";

  return (
    <span
      className={cn("font-mono tabular-nums whitespace-nowrap", SIZE_CLASS[size], colour, className)}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {prefix}
      {text}
      {showCurrency && currency ? <span className="ml-1 text-text-lo text-[0.7em]">{currency}</span> : null}
    </span>
  );
}

export interface CoinMarkProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  variant?: "gold" | "ember";
  glow?: boolean;
  spin?: boolean;
  className?: string;
}

const COIN_PX: Record<NonNullable<CoinMarkProps["size"]>, number> = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 40,
  xl: 64,
};

/**
 * The Aureus mark (docs/08 §5): a minted coin that glows. Gold for credits/PLAY,
 * ember for PRIZE/redeemable. Pure SVG so it scales crisply and tints by variant.
 */
export function CoinMark({
  size = "md",
  variant = "gold",
  glow = false,
  spin = false,
  className,
}: CoinMarkProps): ReactElement {
  const px = COIN_PX[size];
  const top = variant === "gold" ? "#f5d27a" : "#ff9d83";
  const mid = variant === "gold" ? "#e8b84b" : "#ff7a59";
  const deep = variant === "gold" ? "#c99a2e" : "#d9522f";
  const id = `${variant}-${size}`;
  const glowVar = variant === "gold" ? "var(--glow-gold)" : "var(--glow-ember)";

  return (
    <span
      className={cn("inline-flex shrink-0 rounded-full", spin && "motion-safe:animate-spin", className)}
      style={{ width: px, height: px, boxShadow: glow ? glowVar : undefined }}
      aria-hidden="true"
    >
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={id} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor={top} />
            <stop offset="0.55" stopColor={mid} />
            <stop offset="1" stopColor={deep} />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill={`url(#${id})`} stroke={deep} strokeWidth="1" />
        <circle cx="12" cy="12" r="8" fill="none" stroke={deep} strokeWidth="0.75" opacity="0.6" />
        <path d="M9 8.5h4.2a2.4 2.4 0 0 1 0 4.8H10.5V16" stroke={deep} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      </svg>
    </span>
  );
}

export interface BalanceChipProps {
  /** One or more balances; PLAY/credit shows gold, PRIZE shows ember. */
  balances: { currency: Currency; valueMinor: bigint | string; label?: string }[];
  size?: "sm" | "md";
  className?: string;
}

/**
 * Coin + Money pill, dual-balance aware (docs/07 §1): in compliance mode it shows
 * PLAY (gold) and PRIZE (ember) clearly differentiated — never blurred.
 */
export function BalanceChip({ balances, size = "md", className }: BalanceChipProps): ReactElement {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 rounded-full border border-hairline bg-surface-2 px-3 py-1.5",
        className,
      )}
    >
      {balances.map((b, i) => {
        const variant = b.currency === "PRIZE" ? "ember" : "gold";
        return (
          <div key={b.currency} className="flex items-center gap-1.5">
            {i > 0 ? <span className="h-4 w-px bg-hairline" aria-hidden="true" /> : null}
            <CoinMark size={size === "sm" ? "xs" : "sm"} variant={variant} />
            <span className="flex flex-col leading-none">
              {b.label ? (
                <span className="text-[0.625rem] uppercase tracking-wide text-text-lo">{b.label}</span>
              ) : null}
              <Money valueMinor={b.valueMinor} currency={b.currency} size="sm" />
            </span>
          </div>
        );
      })}
    </div>
  );
}
