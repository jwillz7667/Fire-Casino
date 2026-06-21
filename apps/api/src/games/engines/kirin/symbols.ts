/**
 * Legend of the Flaming Kirin symbol set. Ids match the public contract (@aureus/shared
 * kirin.ts) and the art pipeline (games/flaming-kirin/art/symbols/*): four "high" picture
 * premiums (KIRIN/QUEEN/PHOENIX/SHARK), four "mid" pictures (CHEST/BELL/RUBY/LOTUS), four
 * royals (A/K/Q/J), plus the WILD (substitutes any paying symbol), the SCATTER (pearl —
 * pays anywhere, triggers free spins on 3+) and the BONUS (compass — instant prize on 3+).
 */
export const SYMBOLS = [
  "KIRIN",
  "QUEEN",
  "PHOENIX",
  "SHARK",
  "CHEST",
  "BELL",
  "RUBY",
  "LOTUS",
  "A",
  "K",
  "Q",
  "J",
  "WILD",
  "SCATTER",
  "BONUS",
] as const;

export type SymbolId = (typeof SYMBOLS)[number];

/** Symbols that pay on a payline (left-aligned k-of-a-kind). Excludes WILD/SCATTER/BONUS. */
export const PAYING_SYMBOLS = [
  "KIRIN",
  "QUEEN",
  "PHOENIX",
  "SHARK",
  "CHEST",
  "BELL",
  "RUBY",
  "LOTUS",
  "A",
  "K",
  "Q",
  "J",
] as const satisfies readonly SymbolId[];

export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

/** Wild — substitutes every paying symbol (never the scatter or the bonus). */
export const WILD: SymbolId = "WILD";
/** Scatter (pearl) — pays anywhere and triggers free spins on 3+. */
export const SCATTER: SymbolId = "SCATTER";
/** Bonus (compass) — pays an instant credit prize anywhere on 3+. */
export const BONUS: SymbolId = "BONUS";

export function isPaying(sym: SymbolId): sym is PayingSymbol {
  return sym !== "WILD" && sym !== "SCATTER" && sym !== "BONUS";
}

export function isWild(sym: SymbolId): boolean {
  return sym === "WILD";
}
