import { type PayingSymbol, type SymbolId } from "./symbols";

/**
 * Cosmic Spins math model. A classic 5×3, 25-fixed-payline slot (the art ships a "25
 * LINES" badge). Payouts are in basis points of the TOTAL bet (10000 bps = 1× bet) so
 * money stays integer end-to-end. Cells are drawn i.i.d. from per-reel weight vectors.
 * The vectors are identical across reels EXCEPT the WILD, which only lands on the three
 * interior reels (so a payline always starts on a real symbol on reel 1 and, for a
 * 5-of-a-kind, ends on a real symbol on reel 5).
 *
 * Two features ride on top of the base lines:
 *   • SCATTER → free spins with a deterministic +1-per-spin rising multiplier (capped),
 *     identical in spirit to Dragon's Hoard. Scatter/line/free-spin pays are all scaled
 *     by PAYOUT_SCALAR_BPS, so the base RTP is a single linear knob.
 *   • BONUS → an INSTANT credit prize on 3+ anywhere (20× / 100× / 500×). The award is a
 *     FIXED headline prize and is added to the spin total VERBATIM — never RTP-scaled —
 *     so the player always sees an exact 20×/100×/500× reveal. Its RTP contribution is
 *     therefore governed purely by the BONUS reel weight (BONUS_WEIGHT below), not the
 *     scalar; calibration tunes the scalar around that fixed slice (see simulate.ts).
 *
 * RTP is an emergent property of these tables, MEASURED by simulate.ts. Do not infer RTP
 * from a single constant — change a weight, a pay, or the bonus weight and re-measure.
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

/**
 * BONUS reel weight (every reel, base game only). Kept deliberately low: the award is a
 * fixed, unscaled headline prize (20×/100×/500×), so its RTP slice is set HERE, not by the
 * payout scalar. Low enough that 3+ is a rare jackpot-style trigger, but high enough that
 * "two landed, one to go" anticipation shows up regularly. Re-measure with simulate.ts
 * after any change — the bonus RTP moves super-linearly in this weight.
 */
const BONUS_WEIGHT = 2.5;

/** Base-game per-cell weights (WILD filled per-reel by perReel). Low royals are heavy
 *  filler so the grid lands frequent cheap line wins (high hit frequency) while the RTP
 *  cost stays low — the cheap pays are small, so a fuller paytable still calibrates to the
 *  same certified RTP via the scalar. Premiums and features carry the volatility. */
const BASE_COMMON: Record<SymbolId, number> = {
  CORE: 3,
  CRYSTAL: 4,
  ORB: 5,
  SATELLITE: 6,
  ENERGY: 8,
  TABLET: 10,
  A: 13,
  K: 15,
  Q: 17,
  J: 19,
  TEN: 21,
  NINE: 23,
  WILD: 0,
  SCATTER: 5.5,
  BONUS: BONUS_WEIGHT,
};

/** Free-spins per-cell weights: richer premiums, more wilds, NO bonus — the instant bonus
 *  is a base-game-only feature, so free spins never re-award it. Royals match base while
 *  premiums + wild edge it, so free spins win MORE OFTEN and pay MORE per spin than base
 *  (the bonus-winrate invariant); the rising multiplier then amplifies on top, so the free
 *  weights only need to EDGE base — over-inflating them crashes the calibration scalar. */
const FREE_COMMON: Record<SymbolId, number> = {
  CORE: 5,
  CRYSTAL: 6,
  ORB: 7,
  SATELLITE: 8,
  ENERGY: 10,
  TABLET: 12,
  A: 13,
  K: 15,
  Q: 17,
  J: 19,
  TEN: 21,
  NINE: 23,
  WILD: 0,
  SCATTER: 3,
  BONUS: 0,
};

export const BASE_REEL_WEIGHTS = perReel(BASE_COMMON, 3.5);
export const FREE_REEL_WEIGHTS = perReel(FREE_COMMON, 6);

/** Pay per line for k-of-a-kind from reel 1, in bps of total bet. The cheapest royals
 *  pay little at 3 (keeps the sub-1× loss-disguised-as-win flood in check). */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5, number>> = {
  CORE: { 3: 40000, 4: 200000, 5: 1000000 },
  CRYSTAL: { 3: 25000, 4: 120000, 5: 600000 },
  ORB: { 3: 18000, 4: 90000, 5: 450000 },
  SATELLITE: { 3: 12000, 4: 50000, 5: 180000 },
  ENERGY: { 3: 9000, 4: 36000, 5: 140000 },
  TABLET: { 3: 7000, 4: 28000, 5: 100000 },
  A: { 3: 4000, 4: 15000, 5: 60000 },
  K: { 3: 3000, 4: 12000, 5: 48000 },
  Q: { 3: 2500, 4: 10000, 5: 40000 },
  J: { 3: 2000, 4: 8000, 5: 30000 },
  TEN: { 3: 1500, 4: 6000, 5: 24000 },
  NINE: { 3: 1200, 4: 5000, 5: 20000 },
};

/** Scatter (SCATTER) pays anywhere on the grid by count, in bps of total bet. Kept MODEST:
 *  the scatter's value is the FREE-SPINS trigger, not the anywhere-pay — a small direct pay
 *  frees RTP budget for frequent line wins (a higher PAYOUT_SCALAR_BPS, fewer hollow sub-1×
 *  wins) and lets the SCATTER weight rise for more frequent triggers + 2-symbol teases. */
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
 * accumulate the multiplier climbs, concentrating volatility into the tail.
 */
export const MAX_FS_MULTIPLIER = 10;

/** Minimum BONUS symbols to trigger the instant prize. */
export const BONUS_TRIGGER = 3;
/**
 * Instant BONUS prize by count, in bps of total bet (20× / 100× / 500×). Server-decided
 * and deterministic from the count of BONUS symbols on the base grid. NOT RTP-scaled —
 * the reveal is always an exact headline multiple. 6+ BONUS (reachable on a 15-cell grid)
 * clamps to the 5-count prize.
 */
export const BONUS_AWARD: Record<number, number> = {
  3: 200000,
  4: 1000000,
  5: 5000000,
};

/** Hard per-round win cap = 5000× total bet (in bps). Bounds liability and gives the
 *  game a headline max-win; binds very rarely so it stays a real jackpot event. */
export const MAX_WIN_BPS = 50_000_000;

/**
 * Global linear RTP calibration (bps) for the SCALED slice (lines + scatter + free
 * spins). The fixed BONUS prize is added on top unscaled, so the realized RTP is
 * `scaledRtp(scalar) + bonusRtp`. CALIBRATED by simulate.ts — run it after any table
 * change and paste the suggested value here.
 */
export const PAYOUT_SCALAR_BPS = 27360;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
