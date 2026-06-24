import { type PayingSymbol, type SymbolId } from "./symbols";

/**
 * Royal Ascendant math model. Payouts are in basis points of the total bet
 * (10000 bps = 1× bet) so money stays integer end-to-end. Cells are drawn i.i.d.
 * from per-reel weight vectors. The vectors are identical across reels EXCEPT the
 * JOKER wild, which only lands on the three interior reels (anchored wins: a run
 * must start on reel 1 and, for a 5-of-a-kind, end on reel 5 with a real symbol).
 *
 * Tuned to a MEDIUM-volatility profile (≈27.9% hit, ≈14.7% sub-1x, 5000× cap)
 * comparable to real sweeps slots — the low royals (TEN/J/Q) are heavy filler that
 * pay nothing at 3-of-a-kind, the top end is rich, and the free-spins multiplier
 * ramps ×2/spin to push variance into the tail rather than a flood of tiny wins.
 *
 * RTP is an emergent property of these tables, MEASURED by simulate.ts and pinned
 * via PAYOUT_SCALAR_BPS (every payout scales linearly, so total RTP does too). Do
 * not infer RTP from a single constant — change a weight or pay and re-measure.
 */

export const REELS = 5;
export const ROWS = 3;

/**
 * Build a 5-reel weight table from a common per-cell vector, placing the JOKER
 * only on the interior reels (indices 1..3); reels 0 and 4 get JOKER weight 0.
 */
function perReel(
  common: Record<SymbolId, number>,
  jokerInterior: number,
): Record<SymbolId, number>[] {
  return Array.from({ length: REELS }, (_unused, reel) => ({
    ...common,
    JOKER: reel === 0 || reel === REELS - 1 ? 0 : jokerInterior,
  }));
}

/** Base-game per-cell weights (JOKER filled per-reel by perReel). Low royals are
 *  heavy filler so wins skew toward the premiums and the feature. */
const BASE_COMMON: Record<SymbolId, number> = {
  QUEEN: 5,
  CASTLE: 6,
  SHIELD: 8,
  A: 11,
  K: 14,
  Q: 17,
  J: 20,
  TEN: 23,
  JOKER: 0,
  CHEST: 3.6,
};

/** Free-spins per-cell weights: richer highs, more wilds, rarer scatter. */
const FREE_COMMON: Record<SymbolId, number> = {
  QUEEN: 7,
  CASTLE: 8,
  SHIELD: 10,
  A: 12,
  K: 13,
  Q: 15,
  J: 17,
  TEN: 19,
  JOKER: 0,
  CHEST: 3,
};

export const BASE_REEL_WEIGHTS = perReel(BASE_COMMON, 4);
export const FREE_REEL_WEIGHTS = perReel(FREE_COMMON, 7);

/** Pay per single way for k-of-a-kind from reel 1, in bps of total bet. The three
 *  cheapest royals pay nothing at 3 (kills the sub-1x loss-disguised-as-win flood). */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5, number>> = {
  QUEEN: { 3: 12000, 4: 50000, 5: 250000 },
  CASTLE: { 3: 7000, 4: 28000, 5: 140000 },
  SHIELD: { 3: 4500, 4: 18000, 5: 90000 },
  A: { 3: 2500, 4: 9000, 5: 40000 },
  K: { 3: 1800, 4: 6500, 5: 28000 },
  Q: { 3: 0, 4: 4000, 5: 16000 },
  J: { 3: 0, 4: 2800, 5: 11000 },
  TEN: { 3: 0, 4: 2200, 5: 9000 },
};

/** Scatter (CHEST) pays anywhere on the grid by count, in bps of total bet. */
export const SCATTER_PAY: Record<number, number> = {
  3: 3000,
  4: 15000,
  5: 80000,
};

/** Minimum scatters to award free spins, and the spins granted per count. */
export const SCATTER_TRIGGER = 3;
export const FREE_SPINS_AWARD: Record<number, number> = {
  3: 8,
  4: 12,
  5: 18,
};
/** A retrigger (3+ scatters during free spins) adds this many spins. */
export const RETRIGGER_SPINS = 4;
/** Hard cap on total free spins in one feature, so the round always terminates. */
export const MAX_FREE_SPINS = 60;

/**
 * Free-spins multiplier rises deterministically ×2 per spin (spin 1 = ×1, spin 2 =
 * ×3, spin 3 = ×5, …) and is capped. No RNG, no collectible — the ramp IS the
 * feature, and the steeper slope concentrates volatility into the feature tail.
 */
export const MAX_FS_MULTIPLIER = 15;

/** Hard per-round win cap = 5000× total bet (in bps). Bounds liability and gives
 *  the game a headline max-win; binds ~1-in-2.5M spins so it's a real jackpot event. */
export const MAX_WIN_BPS = 50_000_000;

/**
 * Global linear RTP calibration (bps). The raw tables produce some intrinsic RTP;
 * this scales every payout onto the certified target. CALIBRATED by simulate.ts —
 * run it after any table change and paste the suggested value here.
 */
export const PAYOUT_SCALAR_BPS = 7296;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
