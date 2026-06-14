/**
 * Phoenix Ascendant — the PUBLIC game contract shared by the server engine and the
 * arcade renderer. Only the outcome shape and symbol ids live here; the reel
 * weights, paytable and RTP calibration are server-only (apps/api/.../engines/
 * phoenix/math.ts) and must never reach the client. The server decides every
 * outcome over the provable-fairness stream; the client renders this payload.
 *
 * The api-side engine types (engines/phoenix/engine.ts) mirror these and are
 * asserted assignable to them in the engine tests, so the contract can't drift.
 */

/** Catalog code + engine key for the game (server dispatch + client renderer). */
export const PHOENIX_GAME_CODE = "phoenix-ascendant";

export const PHOENIX_SYMBOLS = [
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

export type PhoenixSymbol = (typeof PHOENIX_SYMBOLS)[number];

/** High symbols render with a stronger frame/glow in the lobby and on win. */
export const PHOENIX_HIGH_SYMBOLS = ["CREST", "TALON", "EGG", "FEATHER"] as const;

/** Grid is column-major: grid[reel][row]. 5 reels × 3 rows. */
export type PhoenixGrid = PhoenixSymbol[][];

export interface PhoenixWaysWin {
  symbol: PhoenixSymbol;
  count: number; // matched reels from the left, 3..5
  ways: number; // product of per-reel symbol counts across matched reels
  payBps: number; // contribution to the spin in bps of total bet (pre multiplier)
}

export interface PhoenixSpinResult {
  grid: PhoenixGrid;
  waysWins: PhoenixWaysWin[];
  scatterCount: number;
  scatterPayBps: number;
  orbValues: number[]; // orb multiplier values landed this spin (free spins only)
  multiplier: number; // sticky free-spins multiplier applied to this spin (1 in base)
  spinWinBps: number; // total for this spin incl. multiplier, pre global calibration
}

export interface PhoenixFreeSpins {
  triggered: true;
  spins: PhoenixSpinResult[];
  totalSpins: number;
  endMultiplier: number;
  totalBps: number;
}

export interface PhoenixOutcome {
  kind: "phoenix-ascendant";
  demo: true;
  win: boolean;
  base: PhoenixSpinResult;
  freeSpins: PhoenixFreeSpins | null;
  totalWinBps: number; // final win in bps of total bet, AFTER calibration
}

/** Narrow an opaque round outcome JSON to the Phoenix payload. */
export function isPhoenixOutcome(outcome: unknown): outcome is PhoenixOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "phoenix-ascendant"
  );
}
