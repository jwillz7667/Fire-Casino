/**
 * Inferno Link symbol set. Four gems (low), coin + bell (mid), seven (high) pay on lines;
 * the WILD substitutes for any paying symbol; the FIREBALL is the money symbol (no line
 * pay — it only matters by triggering and feeding the hold-and-spin).
 */
export const SYMBOLS = [
  "SEVEN",
  "BELL",
  "COIN",
  "RED",
  "PURPLE",
  "BLUE",
  "GREEN",
  "WILD",
  "FIREBALL",
] as const;

export type SymbolId = (typeof SYMBOLS)[number];

/** Symbols that pay on a payline (left-aligned k-of-a-kind). Excludes WILD + FIREBALL. */
export const PAYING_SYMBOLS = ["SEVEN", "BELL", "COIN", "RED", "PURPLE", "BLUE", "GREEN"] as const;
export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

export const WILD: SymbolId = "WILD";
export const FIREBALL: SymbolId = "FIREBALL";

export function isPaying(sym: SymbolId): sym is PayingSymbol {
  return sym !== "WILD" && sym !== "FIREBALL";
}
