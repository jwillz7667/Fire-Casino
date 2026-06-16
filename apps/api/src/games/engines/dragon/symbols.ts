/**
 * Dragon's Hoard Bonanza symbol set. Ids match the art pipeline contract exactly
 * (games/dragon-hoard/art/symbols/<SymbolId>.png): three illustrated "high" dragons
 * (GOLD/RED/BLUE_DRAGON), three "mid" gems (RED/GREEN/BLUE_GEM), four "low" card
 * royals (A/K/Q/J), plus the WILD (the dragon crest — substitutes any paying symbol)
 * and the COINS scatter (the hoard — pays anywhere and triggers free spins on 3+).
 */
export const SYMBOLS = [
  "GOLD_DRAGON",
  "RED_DRAGON",
  "BLUE_DRAGON",
  "RED_GEM",
  "GREEN_GEM",
  "BLUE_GEM",
  "A",
  "K",
  "Q",
  "J",
  "WILD",
  "COINS",
] as const;

export type SymbolId = (typeof SYMBOLS)[number];

/** Symbols that pay on a payline (left-aligned k-of-a-kind). Excludes WILD/COINS. */
export const PAYING_SYMBOLS = [
  "GOLD_DRAGON",
  "RED_DRAGON",
  "BLUE_DRAGON",
  "RED_GEM",
  "GREEN_GEM",
  "BLUE_GEM",
  "A",
  "K",
  "Q",
  "J",
] as const satisfies readonly SymbolId[];

export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

/** Wild — substitutes every paying symbol (never the scatter). */
export const WILD: SymbolId = "WILD";
/** Scatter — pays anywhere and triggers free spins on 3+. */
export const SCATTER: SymbolId = "COINS";

export function isPaying(sym: SymbolId): sym is PayingSymbol {
  return sym !== "WILD" && sym !== "COINS";
}

export function isWild(sym: SymbolId): boolean {
  return sym === "WILD";
}
