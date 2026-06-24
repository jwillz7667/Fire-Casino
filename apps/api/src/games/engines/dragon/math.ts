import { type PayingSymbol, type SymbolId } from "./symbols";

/**
 * Dragon's Hoard Bonanza math model. A classic 5×3, 25-fixed-payline slot (the art
 * ships a "25 LINES" badge). Payouts are in basis points of the TOTAL bet
 * (10000 bps = 1× bet) so money stays integer end-to-end. Cells are drawn i.i.d. from
 * per-reel weight vectors. The vectors are identical across reels EXCEPT the WILD,
 * which only lands on the three interior reels (so a payline always starts on a real
 * symbol on reel 1 and, for a 5-of-a-kind, ends on a real symbol on reel 5).
 *
 * Tuned to a MEDIUM-volatility profile: low royals are heavy filler that pay little at
 * 3-of-a-kind, the dragons are rich, the COINS hoard pays anywhere, and the free-spins
 * multiplier ramps +1 per spin to push variance into the feature tail.
 *
 * RTP is an emergent property of these tables, MEASURED by simulate.ts and pinned via
 * PAYOUT_SCALAR_BPS (every payout scales linearly, so total RTP does too). Do not
 * infer RTP from a single constant — change a weight or pay and re-measure.
 */

export const REELS = 5;
export const ROWS = 3;

/**
 * The 25 fixed paylines. Each entry is the row index (0=top, 1=middle, 2=bottom) the
 * line occupies on each of the 5 reels, left to right. Lines pay left-aligned only.
 * All 25 are distinct and stay within rows 0..2 (asserted in the engine tests).
 */
export const PAYLINES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [1, 0, 2, 0, 1],
  [1, 2, 0, 2, 1],
  [0, 1, 2, 2, 1],
  [2, 1, 0, 0, 1],
] as const;

/**
 * Build a 5-reel weight table from a common per-cell vector, placing the WILD only on
 * the interior reels (indices 1..3); reels 0 and 4 get WILD weight 0.
 */
function perReel(
  common: Record<SymbolId, number>,
  wildInterior: number,
): Record<SymbolId, number>[] {
  return Array.from({ length: REELS }, (_unused, reel) => ({
    ...common,
    WILD: reel === 0 || reel === REELS - 1 ? 0 : wildInterior,
  }));
}

/** Base-game per-cell weights (WILD filled per-reel by perReel). Low royals are heavy
 *  filler so the grid lands frequent cheap line wins (high hit frequency) at low RTP cost
 *  — the cheap pays are small, so a fuller paytable still calibrates to the certified RTP
 *  via the scalar. The dragons and the COINS feature carry the volatility. */
const BASE_COMMON: Record<SymbolId, number> = {
  GOLD_DRAGON: 3,
  RED_DRAGON: 4,
  BLUE_DRAGON: 5,
  RED_GEM: 7,
  GREEN_GEM: 9,
  BLUE_GEM: 11,
  A: 13,
  K: 15,
  Q: 17,
  J: 19,
  WILD: 0,
  COINS: 2.8,
};

/** Free-spins per-cell weights: richer dragons, more wilds. Royals match base while the
 *  dragons + gems + wild edge it, so free spins win MORE OFTEN and pay MORE per spin than
 *  base (the bonus-winrate invariant); the rising multiplier then amplifies on top, so the
 *  free weights only need to EDGE base — over-inflating them crashes the calibration scalar. */
const FREE_COMMON: Record<SymbolId, number> = {
  GOLD_DRAGON: 5,
  RED_DRAGON: 6,
  BLUE_DRAGON: 7,
  RED_GEM: 9,
  GREEN_GEM: 11,
  BLUE_GEM: 13,
  A: 13,
  K: 15,
  Q: 17,
  J: 19,
  WILD: 0,
  COINS: 3,
};

export const BASE_REEL_WEIGHTS = perReel(BASE_COMMON, 3);
export const FREE_REEL_WEIGHTS = perReel(FREE_COMMON, 6.5);

/** Pay per line for k-of-a-kind from reel 1, in bps of total bet. The cheapest royals
 *  pay little at 3 (keeps the sub-1x loss-disguised-as-win flood in check). */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5, number>> = {
  GOLD_DRAGON: { 3: 37500, 4: 240000, 5: 1700000 },
  RED_DRAGON: { 3: 19000, 4: 120000, 5: 820000 },
  BLUE_DRAGON: { 3: 14000, 4: 70000, 5: 375000 },
  RED_GEM: { 3: 9400, 4: 38000, 5: 140000 },
  GREEN_GEM: { 3: 7500, 4: 28000, 5: 112000 },
  BLUE_GEM: { 3: 5600, 4: 23000, 5: 94000 },
  A: { 3: 3800, 4: 14000, 5: 56000 },
  K: { 3: 2800, 4: 11000, 5: 47000 },
  Q: { 3: 2400, 4: 9400, 5: 38000 },
  J: { 3: 1900, 4: 7500, 5: 28000 },
};

/** Scatter (COINS) pays anywhere on the grid by count, in bps of total bet. Kept MODEST:
 *  the scatter's value is the FREE-SPINS trigger, not the anywhere-pay — a small direct pay
 *  frees RTP budget for frequent line wins (a higher PAYOUT_SCALAR_BPS, fewer hollow sub-1×
 *  wins) and lets the COINS weight rise for more frequent triggers + 2-symbol teases. */
export const SCATTER_PAY: Record<number, number> = {
  3: 15000,
  4: 60000,
  5: 300000,
};

/** Minimum scatters to award free spins, and the spins granted per count. */
export const SCATTER_TRIGGER = 3;
export const FREE_SPINS_AWARD: Record<number, number> = {
  3: 8,
  4: 12,
  5: 18,
};
/** A retrigger (3+ scatters during free spins) adds this many spins. */
export const RETRIGGER_SPINS = 5;
/** Hard cap on total free spins in one feature, so the round always terminates. */
export const MAX_FREE_SPINS = 60;

/**
 * Free-spins multiplier rises deterministically +1 per spin (spin 1 = ×1, spin 2 = ×2,
 * …) and is capped. No RNG, no collectible — the ramp IS the feature, and as the spins
 * accumulate the hoard multiplier climbs, concentrating volatility into the tail.
 */
export const MAX_FS_MULTIPLIER = 12;

/** Hard per-round win cap = 8000× total bet (in bps). Bounds liability and gives the
 *  game a headline max-win; binds very rarely so it stays a real jackpot event. */
export const MAX_WIN_BPS = 80_000_000;

/**
 * Global linear RTP calibration (bps). The raw tables produce some intrinsic RTP; this
 * scales every payout onto the certified target. CALIBRATED by simulate.ts — run it
 * after any table change and paste the suggested value here.
 */
export const PAYOUT_SCALAR_BPS = 19824;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
