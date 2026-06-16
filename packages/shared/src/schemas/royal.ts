/**
 * Royal Ascendant — the PUBLIC game contract shared by the server engine and the
 * arcade renderer. Only the outcome shape and symbol ids live here; the reel
 * weights, paytable and RTP calibration are server-only (apps/api/.../engines/
 * royal/math.ts) and must never reach the client. The server decides every outcome
 * over the provable-fairness stream; the client renders this payload.
 *
 * The api-side engine types (engines/royal/engine.ts) mirror these and are asserted
 * assignable to them in the engine tests, so the contract can't drift.
 */

/** Catalog code + engine key for the game (server dispatch + client renderer). */
export const ROYAL_GAME_CODE = "royal-ascendant";

export const ROYAL_SYMBOLS = [
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

export type RoyalSymbol = (typeof ROYAL_SYMBOLS)[number];

/** High symbols render with a stronger frame/glow in the lobby and on win. */
export const ROYAL_HIGH_SYMBOLS = ["QUEEN", "CASTLE", "SHIELD"] as const;

/** Wild substitutes any paying symbol; scatter pays anywhere and triggers free spins. */
export const ROYAL_WILD = "JOKER" as const;
export const ROYAL_SCATTER = "CHEST" as const;

/** Grid is column-major: grid[reel][row]. 5 reels × 3 rows. */
export type RoyalGrid = RoyalSymbol[][];

export interface RoyalWaysWin {
  symbol: RoyalSymbol;
  count: number; // matched reels from the left, 3..5
  ways: number; // product of per-reel symbol counts (incl. wilds) across matched reels
  payBps: number; // contribution to the spin in bps of total bet (pre multiplier)
}

export interface RoyalSpinResult {
  grid: RoyalGrid;
  waysWins: RoyalWaysWin[];
  scatterCount: number;
  scatterPayBps: number;
  multiplier: number; // sticky free-spins multiplier applied to this spin (1 in base)
  spinWinBps: number; // total for this spin incl. multiplier, pre global calibration
}

export interface RoyalFreeSpins {
  triggered: true;
  spins: RoyalSpinResult[];
  totalSpins: number;
  endMultiplier: number;
  totalBps: number;
}

export interface RoyalOutcome {
  kind: "royal-ascendant";
  win: boolean;
  base: RoyalSpinResult;
  freeSpins: RoyalFreeSpins | null;
  totalWinBps: number; // final win in bps of total bet, AFTER calibration
}

/** Narrow an opaque round outcome JSON to the Royal payload. */
export function isRoyalOutcome(outcome: unknown): outcome is RoyalOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "royal-ascendant"
  );
}
