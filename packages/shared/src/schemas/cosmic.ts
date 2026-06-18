/**
 * Cosmic Spins — the PUBLIC game contract shared by the server engine and the arcade
 * renderer. Only the outcome shape and symbol ids live here; the reel weights, paytable,
 * bonus economics and RTP calibration are server-only (apps/api/.../engines/cosmic/
 * math.ts) and must never reach the client. The server decides every outcome over the
 * provable-fairness stream; the client only renders this payload.
 *
 * The api-side engine types (engines/cosmic/engine.ts) mirror these and are asserted
 * assignable to them in the engine tests, so the contract can't drift.
 *
 * Like Dragon's Hoard (and unlike the 243-ways Royal/Phoenix engines), Cosmic Spins is a
 * classic 5×3 / 25 fixed-paylines model. Each line win carries the EXACT winning cell
 * coordinates (`cells`) so the renderer can light them without re-deriving the payline
 * geometry — the engine is the single source of truth for the line table.
 *
 * Cosmic Spins adds a headline BONUS feature on top of the scatter free-spins: the BONUS
 * symbol lands on ANY reel, and 3+ anywhere pays an INSTANT credit prize (20× / 100× /
 * 500× total bet) surfaced separately in `bonus` so the client can play the siren and
 * reveal. It is a fixed awarded prize, NOT a pick mini-game.
 */

/** Catalog code + engine key for the game (server dispatch + client renderer). */
export const COSMIC_GAME_CODE = "cosmic-slots";

export const COSMIC_SYMBOLS = [
  "CORE",
  "CRYSTAL",
  "ORB",
  "SATELLITE",
  "ENERGY",
  "TABLET",
  "A",
  "K",
  "Q",
  "J",
  "TEN",
  "NINE",
  "WILD",
  "SCATTER",
  "BONUS",
] as const;

export type CosmicSymbol = (typeof COSMIC_SYMBOLS)[number];

/** High (premium) symbols render with a stronger frame/glow in the lobby and on win. */
export const COSMIC_HIGH_SYMBOLS = ["CORE", "CRYSTAL", "ORB"] as const;

/** Wild substitutes any paying symbol (never the scatter or bonus). */
export const COSMIC_WILD = "WILD" as const;
/** Scatter pays anywhere and triggers free spins on 3+. */
export const COSMIC_SCATTER = "SCATTER" as const;
/** Bonus pays an instant credit prize on 3+ anywhere (the headline feature). */
export const COSMIC_BONUS = "BONUS" as const;

/** Number of fixed paylines evaluated each spin (the "25 LINES" headline). */
export const COSMIC_LINE_COUNT = 25;

/** Grid is column-major: grid[reel][row]. 5 reels × 3 rows. */
export type CosmicGrid = CosmicSymbol[][];

/** A [reel, row] coordinate on the 5×3 grid. */
export type CosmicCell = [number, number];

export interface CosmicLineWin {
  line: number; // payline index, 0..24
  symbol: CosmicSymbol;
  count: number; // matched reels from the left, 3..5
  payBps: number; // line pay in bps of total bet (pre multiplier)
  cells: CosmicCell[]; // the exact winning cells, left to right (length === count)
}

export interface CosmicSpinResult {
  grid: CosmicGrid;
  lineWins: CosmicLineWin[];
  scatterCount: number;
  scatterPayBps: number;
  bonusCount: number; // BONUS symbols on the grid this spin
  bonusPayBps: number; // instant bonus prize for this spin's count (bps of bet; 0 if < 3)
  multiplier: number; // sticky free-spins multiplier applied to this spin (1 in base)
  spinWinBps: number; // line + scatter total for this spin incl. multiplier, pre calibration
}

export interface CosmicFreeSpins {
  triggered: true;
  spins: CosmicSpinResult[];
  totalSpins: number;
  endMultiplier: number;
  totalBps: number;
}

/**
 * The instant BONUS award. Decided server-side and deterministic from the count of BONUS
 * symbols on the base grid: 3 → 20× (200000 bps), 4 → 100× (1000000 bps), 5 → 500×
 * (5000000 bps). The award is added to the spin total verbatim (never RTP-scaled) so the
 * headline prize the client reveals is exact.
 */
export interface CosmicBonus {
  triggered: true;
  bonusCount: number; // BONUS symbols that triggered the award, 3..15
  awardBps: number; // instant prize in bps of total bet (200000 / 1000000 / 5000000)
}

export interface CosmicOutcome {
  kind: "cosmic-slots";
  win: boolean;
  base: CosmicSpinResult;
  freeSpins: CosmicFreeSpins | null;
  bonus: CosmicBonus | null;
  totalWinBps: number; // final win in bps of total bet, AFTER calibration (+ exact bonus)
}

/** Narrow an opaque round outcome JSON to the Cosmic payload. */
export function isCosmicOutcome(outcome: unknown): outcome is CosmicOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "cosmic-slots"
  );
}
