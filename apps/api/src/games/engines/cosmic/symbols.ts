/**
 * Cosmic Spins symbol set. Ids match the public contract (@aureus/shared cosmic.ts) and
 * the art pipeline exactly: three "high" premiums (CORE/CRYSTAL/ORB — strongest), three
 * "mid" premiums (SATELLITE/ENERGY/TABLET), six "low" royals (A/K/Q/J/TEN/NINE), plus the
 * WILD (substitutes any paying symbol), the SCATTER (pays anywhere and triggers free
 * spins on 3+) and the BONUS (the headline instant-prize feature — pays anywhere on 3+).
 */
export const SYMBOLS = [
  "CORE",
  "CRYSTAL",
  "ORB",
  "SATELLITE",
  "ENERGY",
  "TABLET",
  "A",
  "K",
  "Q",
  "J",
  "TEN",
  "NINE",
  "WILD",
  "SCATTER",
  "BONUS",
] as const;

export type SymbolId = (typeof SYMBOLS)[number];

/** Symbols that pay on a payline (left-aligned k-of-a-kind). Excludes WILD/SCATTER/BONUS. */
export const PAYING_SYMBOLS = [
  "CORE",
  "CRYSTAL",
  "ORB",
  "SATELLITE",
  "ENERGY",
  "TABLET",
  "A",
  "K",
  "Q",
  "J",
  "TEN",
  "NINE",
] as const satisfies readonly SymbolId[];

export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

/** Wild — substitutes every paying symbol (never the scatter or the bonus). */
export const WILD: SymbolId = "WILD";
/** Scatter — pays anywhere and triggers free spins on 3+. */
export const SCATTER: SymbolId = "SCATTER";
/** Bonus — pays an instant credit prize anywhere on 3+. */
export const BONUS: SymbolId = "BONUS";

export function isPaying(sym: SymbolId): sym is PayingSymbol {
  return sym !== "WILD" && sym !== "SCATTER" && sym !== "BONUS";
}

export function isWild(sym: SymbolId): boolean {
  return sym === "WILD";
}
