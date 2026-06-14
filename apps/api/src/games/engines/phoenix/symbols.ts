/**
 * Phoenix Ascendant symbol set. Ids match the art pipeline's Core contract
 * exactly (github.com/jwillz7667/game — art/symbols/*.png, symbol_database.tres):
 * four illustrated "high" symbols, four gem "low" symbols, plus the SCATTER
 * (free-spins trigger) and the ORB (free-spins multiplier collectible).
 */
export const SYMBOLS = [
  "CREST",
  "TALON",
  "EGG",
  "FEATHER",
  "GOLD",
  "EMBER",
  "TEAL",
  "VIOLET",
  "SCATTER",
  "ORB",
] as const;

export type SymbolId = (typeof SYMBOLS)[number];

/** Symbols that pay on ways (left-aligned k-of-a-kind). Excludes SCATTER/ORB. */
export const PAYING_SYMBOLS = [
  "CREST",
  "TALON",
  "EGG",
  "FEATHER",
  "GOLD",
  "EMBER",
  "TEAL",
  "VIOLET",
] as const satisfies readonly SymbolId[];

export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

export const SCATTER: SymbolId = "SCATTER";
export const ORB: SymbolId = "ORB";

export function isPaying(sym: SymbolId): sym is PayingSymbol {
  return sym !== "SCATTER" && sym !== "ORB";
}
