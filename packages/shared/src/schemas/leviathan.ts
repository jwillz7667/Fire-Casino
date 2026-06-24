/**
 * Leviathan's Deep — the PUBLIC game contract shared by the server engine and the arcade
 * renderer. A 6×5 WAYS-TO-WIN (up to 15,625 ways) deep-ocean treasure slot with TUMBLING
 * (cascade) reels and a rising win multiplier. Premiums (Leviathan / Kraken / Siren Queen /
 * golden Trident / treasure Chest) pay above the gem lows (pearl / aqua / sapphire / amethyst /
 * emerald); a WILD substitutes any paying symbol on the interior reels; the SCATTER (conch)
 * triggers free spins on 4+; the BONUS (kraken amulet) awakens the Kraken for an instant
 * headline prize on 3+; and during free spins MULT_ORB symbols feed a persistent "rising tide"
 * multiplier.
 *
 * Only the outcome SHAPE + symbol ids live here; reel weights, paytable and RTP calibration are
 * server-only (apps/api/.../engines/leviathan/math.ts) and never reach the client. The server
 * decides every outcome over the provable-fairness stream; the client only renders this payload.
 * The api-side engine types mirror these and are asserted assignable in the engine tests, so the
 * contract can't drift. Money is bps of total bet (10000 = 1× bet); the Kraken Awakens prize is
 * a FIXED bet-multiple paid VERBATIM (never RTP-scaled) so the reveal is exact.
 */

import { type SlotFeel } from "./slot-feel";

/** Catalog code + engine key (server dispatch + client renderer). */
export const LEVIATHAN_GAME_CODE = "leviathan-deep";

export const LEVIATHAN_REELS = 6;
export const LEVIATHAN_ROWS = 5;

export const LEVIATHAN_SYMBOLS = [
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
export type LeviathanSymbol = (typeof LEVIATHAN_SYMBOLS)[number];

/** Premium picture symbols — stronger frame/glow in the lobby and on win. */
export const LEVIATHAN_HIGH_SYMBOLS = ["LEVIATHAN", "KRAKEN", "SIREN", "TRIDENT", "CHEST"] as const;
/** Gem low symbols. */
export const LEVIATHAN_LOW_SYMBOLS = ["PEARL", "AQUA", "SAPPHIRE", "AMETHYST", "EMERALD"] as const;

/** Wild substitutes any paying symbol (never SCATTER / BONUS / MULT_ORB). */
export const LEVIATHAN_WILD = "WILD" as const;
/** Scatter (conch) — pays nothing on lines; 4+ anywhere triggers free spins. */
export const LEVIATHAN_SCATTER = "SCATTER" as const;
/** Bonus (kraken amulet) — 3+ anywhere awakens the Kraken for an instant headline prize. */
export const LEVIATHAN_BONUS = "BONUS" as const;
/** Free-spins-only multiplier orb — its value feeds the persistent rising-tide multiplier. */
export const LEVIATHAN_MULT_ORB = "MULT_ORB" as const;

/** Minimum scatters to trigger free spins (the "4+ SCATTERS" headline). */
export const LEVIATHAN_SCATTER_TRIGGER = 4;
/** Minimum BONUS symbols to awaken the Kraken. */
export const LEVIATHAN_BONUS_TRIGGER = 3;

/** Grid is column-major: grid[reel][row]. 6 reels × 5 rows. */
export type LeviathanGrid = LeviathanSymbol[][];

/** A [reel, row] coordinate on the 6×5 grid. */
export type LeviathanCell = [number, number];

/**
 * One ways-win on a cascade step. WAYS = product of the matching-symbol count on each consecutive
 * reel from reel 0 (wilds substitute). `payBps` already includes the ways multiplicity but NOT
 * the cascade/tide multiplier.
 */
export interface LeviathanWaysWin {
  symbol: LeviathanSymbol;
  reels: number; // consecutive reels matched from the left, 3..6
  ways: number; // product of per-reel match counts
  payBps: number; // total pay for this win in bps of bet (pre cascade/tide multiplier)
  cells: LeviathanCell[]; // every contributing cell (for the clear/explode animation)
}

/**
 * A single tumble step: the grid shown, the ways-wins on it, the multiplier applied to this
 * step, and the resulting win. After a winning step the `cells` are cleared and symbols tumble
 * down; the next CascadeStep is the refilled grid. A step with no wins ends the spin.
 */
export interface LeviathanCascadeStep {
  grid: LeviathanGrid;
  wins: LeviathanWaysWin[];
  multiplier: number; // cascade/tide multiplier applied to this step (1 on a fresh base spin)
  stepWinBps: number; // sum(wins.payBps) × multiplier
}

/**
 * A full spin = the initial drop plus every tumble until no win. `cascades[0]` is the initial
 * grid. `spinWinBps` is the summed, multiplier-applied win across all steps (pre game-level
 * calibration). `endMultiplier` is the highest cascade/tide multiplier reached this spin.
 */
export interface LeviathanSpinResult {
  cascades: LeviathanCascadeStep[];
  spinWinBps: number;
  endMultiplier: number;
  scatterCount: number; // SCATTERs on the INITIAL grid (the trigger count)
  bonusCount: number; // BONUS symbols on the INITIAL grid (the awaken count)
}

/**
 * Free spins: a sequence of tumbling spins under a PERSISTENT "rising tide" multiplier that only
 * ever increases — each MULT_ORB that lands adds its value to the tide, and the tide multiplies
 * every subsequent cascade. Retriggers add spins. The ramp IS the feature; volatility
 * concentrates in the tail.
 */
export interface LeviathanFreeSpins {
  triggered: true;
  spins: LeviathanSpinResult[];
  totalSpins: number;
  startTide: number; // tide multiplier at the start (typically 1)
  endTide: number; // tide multiplier when the feature ended
  totalBps: number; // total free-spins win in bps of bet (incl. tide), pre calibration
}

/**
 * Kraken Awakens — an INSTANT headline prize decided server-side from the count of BONUS symbols
 * on the base grid (3 / 4 / 5+). Added to the round total VERBATIM (never RTP-scaled) so the
 * reveal is always an exact bet-multiple. The client plays the full kraken takeover animation.
 */
export interface LeviathanBonus {
  triggered: true;
  krakenCount: number; // BONUS symbols that triggered the award, 3..6
  awardBps: number; // instant prize in bps of bet (fixed bet-multiple)
}

export interface LeviathanOutcome {
  kind: "leviathan-deep";
  win: boolean;
  base: LeviathanSpinResult;
  freeSpins: LeviathanFreeSpins | null;
  bonus: LeviathanBonus | null;
  totalWinBps: number; // final win in bps of bet, AFTER calibration (+ exact Kraken prize)
  feel: SlotFeel; // presentation-only suspense + win-tier hints (never affects the money figure)
}

/** Narrow an opaque round outcome JSON to the Leviathan's Deep payload. */
export function isLeviathanOutcome(outcome: unknown): outcome is LeviathanOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "leviathan-deep"
  );
}
