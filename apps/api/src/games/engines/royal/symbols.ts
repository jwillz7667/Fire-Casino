/**
 * Royal Ascendant symbol set. Ids match the art pipeline contract exactly
 * (games/royal-ascendant/art/symbols/<SymbolId>.png): three illustrated "high"
 * symbols (QUEEN/CASTLE/SHIELD), five royal "low" card symbols (A/K/Q/J/TEN), plus
 * the JOKER (wild — substitutes any paying symbol) and the CHEST (scatter — pays
 * anywhere and triggers free spins on 3+).
 */
export const SYMBOLS = [
  "QUEEN",
  "CASTLE",
  "SHIELD",
  "A",
  "K",
  "Q",
  "J",
  "TEN",
  "JOKER",
  "CHEST",
] as const;

export type SymbolId = (typeof SYMBOLS)[number];

/** Symbols that pay on ways (left-aligned k-of-a-kind). Excludes JOKER/CHEST. */
export const PAYING_SYMBOLS = [
  "QUEEN",
  "CASTLE",
  "SHIELD",
  "A",
  "K",
  "Q",
  "J",
  "TEN",
] as const satisfies readonly SymbolId[];

export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

/** Wild — substitutes every paying symbol (never the scatter). */
export const WILD: SymbolId = "JOKER";
/** Scatter — pays anywhere and triggers free spins on 3+. */
export const SCATTER: SymbolId = "CHEST";

export function isPaying(sym: SymbolId): sym is PayingSymbol {
  return sym !== "JOKER" && sym !== "CHEST";
}

export function isWild(sym: SymbolId): boolean {
  return sym === "JOKER";
}
