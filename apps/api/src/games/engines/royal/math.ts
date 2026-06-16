import { type PayingSymbol, type SymbolId } from "./symbols";

/**
 * Royal Ascendant math model. Payouts are in basis points of the total bet
 * (10000 bps = 1× bet) so money stays integer end-to-end. Cells are drawn i.i.d.
 * from per-reel weight vectors. The vectors are identical across reels EXCEPT the
 * JOKER wild, which only lands on the three interior reels (anchored wins: a run
 * must start on reel 1 and, for a 5-of-a-kind, end on reel 5 with a real symbol).
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

/** Base-game per-cell weights (JOKER filled per-reel by perReel). */
const BASE_COMMON: Record<SymbolId, number> = {
  QUEEN: 6,
  CASTLE: 8,
  SHIELD: 10,
  A: 13,
  K: 15,
  Q: 17,
  J: 19,
  TEN: 22,
  JOKER: 0,
  CHEST: 5,
};

/** Free-spins per-cell weights: richer highs, more wilds, rarer scatter. */
const FREE_COMMON: Record<SymbolId, number> = {
  QUEEN: 8,
  CASTLE: 10,
  SHIELD: 12,
  A: 13,
  K: 14,
  Q: 15,
  J: 16,
  TEN: 18,
  JOKER: 0,
  CHEST: 4,
};

export const BASE_REEL_WEIGHTS = perReel(BASE_COMMON, 4);
export const FREE_REEL_WEIGHTS = perReel(FREE_COMMON, 8);

/** Pay per single way for k-of-a-kind from reel 1, in bps of total bet. */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5, number>> = {
  QUEEN: { 3: 5000, 4: 18000, 5: 75000 },
  CASTLE: { 3: 4000, 4: 15000, 5: 60000 },
  SHIELD: { 3: 3000, 4: 12000, 5: 50000 },
  A: { 3: 1500, 4: 5000, 5: 20000 },
  K: { 3: 1200, 4: 4000, 5: 16000 },
  Q: { 3: 1000, 4: 3000, 5: 12000 },
  J: { 3: 800, 4: 2500, 5: 10000 },
  TEN: { 3: 600, 4: 2000, 5: 8000 },
};

/** Scatter (CHEST) pays anywhere on the grid by count, in bps of total bet. */
export const SCATTER_PAY: Record<number, number> = {
  3: 2000,
  4: 10000,
  5: 50000,
};

/** Minimum scatters to award free spins, and the spins granted per count. */
export const SCATTER_TRIGGER = 3;
export const FREE_SPINS_AWARD: Record<number, number> = {
  3: 10,
  4: 15,
  5: 20,
};
/** A retrigger (3+ scatters during free spins) adds this many spins. */
export const RETRIGGER_SPINS = 5;
/** Hard cap on total free spins in one feature, so the round always terminates. */
export const MAX_FREE_SPINS = 50;

/**
 * Free-spins multiplier rises deterministically with the spin index (spin 1 = ×1,
 * spin 2 = ×2, …) and is capped. No RNG, no collectible — the ramp IS the feature.
 */
export const MAX_FS_MULTIPLIER = 10;

/**
 * Global linear RTP calibration (bps). The raw tables produce some intrinsic RTP
 * (wild substitution makes it high); this scales every payout onto the certified
 * target. CALIBRATED by simulate.ts — see that probe for the measured RTP.
 */
export const PAYOUT_SCALAR_BPS = 6894;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
