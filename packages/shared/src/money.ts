import { z } from "zod";

/**
 * Money is integer minor units as BigInt — never floats, never `number` for
 * balances (hard rule #1). All money math lives here. 1 credit = MINOR_PER_CREDIT
 * minor units (default 1000 → 3 decimal places). The scale is read from
 * CREDIT_MINOR_UNITS, must be a power of ten, and is fixed for the life of a
 * deployment (docs/01, docs/03 §8).
 */

export class MoneyError extends Error {
  constructor(
    readonly code: "INVALID_AMOUNT" | "EXCESS_PRECISION" | "NOT_INTEGER" | "INVALID_SCALE",
    message: string,
  ) {
    super(message);
    this.name = "MoneyError";
  }
}

function resolveScale(raw: string | undefined): { minor: bigint; decimals: number } {
  const minor = BigInt(raw ?? "1000");
  if (minor < 1n) throw new MoneyError("INVALID_SCALE", `CREDIT_MINOR_UNITS must be >= 1`);
  let v = minor;
  let decimals = 0;
  while (v > 1n) {
    if (v % 10n !== 0n) {
      throw new MoneyError("INVALID_SCALE", `CREDIT_MINOR_UNITS must be a power of ten`);
    }
    v /= 10n;
    decimals += 1;
  }
  return { minor, decimals };
}

const { minor: MINOR_PER_CREDIT, decimals: MINOR_DECIMALS } = resolveScale(
  process.env.CREDIT_MINOR_UNITS,
);

export { MINOR_PER_CREDIT, MINOR_DECIMALS };
/** Alias matching docs/03 §8 naming. */
export const MINOR = MINOR_PER_CREDIT;

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parse a human credit amount (decimal string, e.g. "12.345" or integer
 * `number` of credits) into BigInt minor units. Never uses float arithmetic.
 * Throws on malformed input or precision finer than the configured scale.
 * Used by the client MoneyInput before submit.
 */
export function toMinor(credits: string | number): bigint {
  let s: string;
  if (typeof credits === "number") {
    if (!Number.isInteger(credits)) {
      throw new MoneyError(
        "NOT_INTEGER",
        `numeric credit input must be an integer; pass a string for fractional amounts: ${String(credits)}`,
      );
    }
    s = String(credits);
  } else {
    s = credits.trim();
  }

  const match = DECIMAL_RE.exec(s);
  if (!match) throw new MoneyError("INVALID_AMOUNT", `not a decimal amount: ${s}`);

  const sign = match[1];
  const intPart = match[2] ?? "0";
  const fracRaw = match[3] ?? "";
  if (fracRaw.length > MINOR_DECIMALS) {
    throw new MoneyError(
      "EXCESS_PRECISION",
      `amount has more than ${String(MINOR_DECIMALS)} decimal places: ${s}`,
    );
  }
  const frac = fracRaw.padEnd(MINOR_DECIMALS, "0");
  const magnitude = BigInt(intPart + frac);
  return sign ? -magnitude : magnitude;
}

/**
 * Format BigInt minor units as a fixed-precision decimal credit string
 * (e.g. 12345n → "12.345" at scale 1000). Full precision, never rounded.
 */
export function fromMinor(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const abs = negative ? -minorUnits : minorUnits;
  if (MINOR_DECIMALS === 0) return negative ? `-${abs.toString()}` : abs.toString();

  const padded = abs.toString().padStart(MINOR_DECIMALS + 1, "0");
  const cut = padded.length - MINOR_DECIMALS;
  const out = `${padded.slice(0, cut)}.${padded.slice(cut)}`;
  return negative ? `-${out}` : out;
}

/**
 * Format BigInt minor units as a US-dollar string, "$1,234.56" (1 credit = $1.00). Minor
 * units carry 3 dp; this rounds half-up to 2 dp (cents) and groups thousands. This is the
 * player- and operator-facing money format across the platform (rendered by the shared
 * Money component). `fromMinor`/`toMinor` stay full-precision for input round-trips.
 */
export function usdFromMinor(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const abs = negative ? -minorUnits : minorUnits;
  // minor is 3 dp (10 minor = 1 cent); round half-up to whole cents.
  const cents = (abs + 5n) / 10n;
  const whole = (cents / 100n).toString();
  const frac = (cents % 100n).toString().padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `$${grouped}.${frac}`;
  return negative ? `-${body}` : body;
}

/** Apply a basis-point rate (e.g. RTP, fees). 9400 bps = 94.00%. Floor division. */
export function bps(amountMinor: bigint, basisPoints: number): bigint {
  if (!Number.isInteger(basisPoints)) {
    throw new MoneyError("NOT_INTEGER", `basisPoints must be an integer: ${String(basisPoints)}`);
  }
  return (amountMinor * BigInt(basisPoints)) / 10_000n;
}

export const addMinor = (a: bigint, b: bigint): bigint => a + b;
export const subMinor = (a: bigint, b: bigint): bigint => a - b;

export function assertNonNegative(minorUnits: bigint): void {
  if (minorUnits < 0n) {
    throw new MoneyError("INVALID_AMOUNT", `expected non-negative amount, got ${minorUnits.toString()}`);
  }
}

export function isNonNegative(minorUnits: bigint): boolean {
  return minorUnits >= 0n;
}

// ---- zod boundary schemas ----------------------------------------------------
// API money fields cross the wire as INTEGER strings of minor units (docs/05 §0,
// e.g. "1500000"). Requests parse string|bigint -> bigint; responses serialize
// bigint -> integer string. Display formatting happens client-side via fromMinor.

const integerString = z.string().regex(/^-?\d+$/, "INTEGER_STRING_REQUIRED");

/** Request-side: integer-string minor units or bigint → bigint. */
export const zMinor = z
  .union([z.bigint(), integerString])
  .transform((v) => (typeof v === "bigint" ? v : BigInt(v)));

/** Request-side, strictly positive minor units. */
export const zMinorPositive = zMinor.refine((v) => v > 0n, "MUST_BE_POSITIVE");

/** Request-side, non-negative minor units. */
export const zMinorNonNegative = zMinor.refine((v) => v >= 0n, "MUST_BE_NON_NEGATIVE");

/** Response-side: bigint → integer-string minor units. */
export const zMinorOut = z.bigint().transform((b) => b.toString());
