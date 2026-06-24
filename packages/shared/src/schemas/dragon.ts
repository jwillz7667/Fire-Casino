/**
 * Dragon's Hoard Bonanza — the PUBLIC game contract shared by the server engine and
 * the arcade renderer. Only the outcome shape and symbol ids live here; the reel
 * weights, paytable and RTP calibration are server-only (apps/api/.../engines/
 * dragon/math.ts) and must never reach the client. The server decides every outcome
 * over the provable-fairness stream; the client only renders this payload.
 *
 * The api-side engine types (engines/dragon/engine.ts) mirror these and are asserted
 * assignable to them in the engine tests, so the contract can't drift.
 *
 * Unlike the 243-ways Royal/Phoenix engines, Dragon's Hoard is a classic 25 fixed
 * paylines model (the art ships a "25 LINES" badge). Each line win therefore carries
 * the EXACT winning cell coordinates (`cells`) so the renderer can light them without
 * re-deriving the payline geometry — the engine is the single source of truth for the
 * line table.
 */

import { type SlotFeel } from "./slot-feel";

/** Catalog code + engine key for the game (server dispatch + client renderer). */
export const DRAGON_GAME_CODE = "dragon-hoard";

export const DRAGON_SYMBOLS = [
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

export type DragonSymbol = (typeof DRAGON_SYMBOLS)[number];

/** High symbols render with a stronger frame/glow in the lobby and on win. */
export const DRAGON_HIGH_SYMBOLS = ["GOLD_DRAGON", "RED_DRAGON", "BLUE_DRAGON"] as const;

/** Wild substitutes any paying symbol; scatter pays anywhere and triggers free spins. */
export const DRAGON_WILD = "WILD" as const;
export const DRAGON_SCATTER = "COINS" as const;

/** Number of fixed paylines evaluated each spin (the "25 LINES" headline). */
export const DRAGON_LINE_COUNT = 25;

/** Grid is column-major: grid[reel][row]. 5 reels × 3 rows. */
export type DragonGrid = DragonSymbol[][];

/** A [reel, row] coordinate on the 5×3 grid. */
export type DragonCell = [number, number];

export interface DragonLineWin {
  line: number; // payline index, 0..24
  symbol: DragonSymbol;
  count: number; // matched reels from the left, 3..5
  payBps: number; // line pay in bps of total bet (pre multiplier)
  cells: DragonCell[]; // the exact winning cells, left to right (length === count)
}

export interface DragonSpinResult {
  grid: DragonGrid;
  lineWins: DragonLineWin[];
  scatterCount: number;
  scatterPayBps: number;
  multiplier: number; // sticky free-spins multiplier applied to this spin (1 in base)
  spinWinBps: number; // total for this spin incl. multiplier, pre global calibration
}

export interface DragonFreeSpins {
  triggered: true;
  spins: DragonSpinResult[];
  totalSpins: number;
  endMultiplier: number;
  totalBps: number;
}

export interface DragonOutcome {
  kind: "dragon-hoard";
  win: boolean;
  base: DragonSpinResult;
  freeSpins: DragonFreeSpins | null;
  totalWinBps: number; // final win in bps of total bet, AFTER calibration
  feel: SlotFeel; // presentation-only suspense + win-tier hints (never affects the money figure)
}

/** Narrow an opaque round outcome JSON to the Dragon payload. */
export function isDragonOutcome(outcome: unknown): outcome is DragonOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "dragon-hoard"
  );
}
