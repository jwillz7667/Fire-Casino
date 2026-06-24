/**
 * Leviathan's Deep symbol set. Ids match the public contract (@aureus/shared leviathan.ts) and
 * the art pipeline: five premium pictures (LEVIATHAN / KRAKEN / SIREN / TRIDENT / CHEST) pay above
 * five gem lows (PEARL / AQUA / SAPPHIRE / AMETHYST / EMERALD); the WILD substitutes any paying
 * symbol on the interior reels; the SCATTER (conch) triggers free spins on 4+; the BONUS (kraken
 * amulet) awakens the Kraken for an instant prize on 3+; and the MULT_ORB (free-spins only) feeds
 * the persistent rising-tide multiplier.
 */
export const SYMBOLS = [
  "LEVIATHAN",
  "KRAKEN",
  "SIREN",
  "TRIDENT",
  "CHEST",
  "PEARL",
  "AQUA",
  "SAPPHIRE",
  "AMETHYST",
  "EMERALD",
  "WILD",
  "SCATTER",
  "BONUS",
  "MULT_ORB",
] as const;

export type SymbolId = (typeof SYMBOLS)[number];

/**
 * Symbols that pay ways-to-win (a left-aligned, reel-0-anchored run). Excludes the WILD (it only
 * substitutes) and the three non-paying specials (SCATTER / BONUS / MULT_ORB). Ordered premium →
 * gem so the engine evaluates and reports the richest symbol first.
 */
export const PAYING_SYMBOLS = [
  "LEVIATHAN",
  "KRAKEN",
  "SIREN",
  "TRIDENT",
  "CHEST",
  "EMERALD",
  "AMETHYST",
  "SAPPHIRE",
  "AQUA",
  "PEARL",
] as const satisfies readonly SymbolId[];

export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

/** Wild — substitutes every paying symbol (never SCATTER / BONUS / MULT_ORB). Interior reels only. */
export const WILD: SymbolId = "WILD";
/** Scatter (conch) — pays nothing on ways; 4+ anywhere triggers free spins. */
export const SCATTER: SymbolId = "SCATTER";
/** Bonus (kraken amulet) — 3+ anywhere awakens the Kraken for an instant fixed prize. */
export const BONUS: SymbolId = "BONUS";
/** Free-spins-only multiplier orb — its value feeds the persistent rising-tide multiplier. */
export const MULT_ORB: SymbolId = "MULT_ORB";

export function isPaying(sym: SymbolId): sym is PayingSymbol {
  return sym !== "WILD" && sym !== "SCATTER" && sym !== "BONUS" && sym !== "MULT_ORB";
}

export function isWild(sym: SymbolId): boolean {
  return sym === "WILD";
}
