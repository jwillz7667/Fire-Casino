import { KIRIN_JACKPOTS, type KirinJackpotTier } from "@aureus/shared";
import { type PayingSymbol, type SymbolId } from "./symbols";

/**
 * Legend of the Flaming Kirin math model. A 5×4, 25-fixed-payline slot. Payouts are in basis
 * points of the TOTAL bet (10000 bps = 1× bet) so money stays integer end-to-end. Cells are
 * drawn i.i.d. from per-reel weight vectors. The vectors are identical across reels EXCEPT the
 * WILD, which only lands on the three interior reels (so a payline always starts on a real
 * symbol on reel 1 and, for a 5-of-a-kind, ends on a real symbol on reel 5).
 *
 * Three slices ride on the base lines:
 *   • SCATTER (pearl) → free spins with a deterministic +1-per-spin rising "Kirin Fire"
 *     multiplier (capped). Scatter/line/free-spin pays are all scaled by PAYOUT_SCALAR_BPS, so
 *     the base RTP is a single linear knob.
 *   • BONUS (compass) → an INSTANT credit prize on 3+ anywhere (20× / 100× / 500×). Added to
 *     the spin total VERBATIM — never RTP-scaled — so the reveal is always exact. Its RTP slice
 *     is governed by the BONUS reel weight (BONUS_WEIGHT), not the scalar.
 *   • JACKPOT → a four-tier (GRAND/MAJOR/MINOR/MINI) fixed bet-multiple that can strike on any
 *     spin with probability JACKPOT_CHANCE, tier picked by JACKPOT_TIER_WEIGHTS. Paid VERBATIM.
 *
 * RTP is an emergent property of these tables, MEASURED by simulate.ts. Do not infer RTP from a
 * single constant — change a weight, a pay, the bonus weight or the jackpot chance and re-measure.
 */

export const REELS = 5;
export const ROWS = 4;

/**
 * The 25 fixed paylines over the 5×4 grid. Each entry is the row index (0=top..3=bottom) the
 * line occupies on each of the 5 reels, left to right. Lines pay left-aligned only. All 25 are
 * distinct and within rows 0..3 (asserted in the engine tests).
 */
export const PAYLINES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [0, 0, 0, 0, 0],
  [3, 3, 3, 3, 3],
  [0, 1, 2, 1, 0],
  [3, 2, 1, 2, 3],
  [1, 2, 3, 2, 1],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [3, 3, 2, 3, 3],
  [1, 0, 0, 0, 1],
  [2, 3, 3, 3, 2],
  [0, 1, 1, 1, 0],
  [3, 2, 2, 2, 3],
  [1, 2, 2, 2, 1],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [3, 2, 3, 2, 3],
  [1, 0, 1, 0, 1],
  [2, 3, 2, 3, 2],
  [0, 2, 0, 2, 0],
  [3, 1, 3, 1, 3],
  [1, 3, 1, 3, 1],
  [2, 0, 2, 0, 2],
  [0, 3, 0, 3, 0],
] as const;

/**
 * Build a 5-reel weight table from a common per-cell vector, placing the WILD only on the
 * interior reels (indices 1..3); reels 0 and 4 get WILD weight 0.
 */
function perReel(common: Record<SymbolId, number>, wildInterior: number): Record<SymbolId, number>[] {
  return Array.from({ length: REELS }, (_unused, reel) => ({
    ...common,
    WILD: reel === 0 || reel === REELS - 1 ? 0 : wildInterior,
  }));
}

/**
 * BONUS reel weight (every reel, base game only). Kept low: the award is a fixed, unscaled
 * headline prize (20×/100×/500×), so its RTP slice is set HERE, not by the payout scalar. Low
 * enough that 3+ is a rare jackpot-style trigger on the 20-cell grid, high enough that "two
 * landed, one to go" anticipation shows regularly. Re-measure with simulate.ts after a change.
 */
const BONUS_WEIGHT = 2.2;

/** Base-game per-cell weights (WILD filled per-reel by perReel). Royals are heavy filler so
 *  wins skew toward the picture premiums and the features. */
const BASE_COMMON: Record<SymbolId, number> = {
  KIRIN: 4,
  QUEEN: 5,
  PHOENIX: 6,
  SHARK: 7,
  CHEST: 9,
  BELL: 11,
  RUBY: 13,
  LOTUS: 15,
  A: 18,
  K: 22,
  Q: 24,
  J: 28,
  WILD: 0,
  SCATTER: 4.6,
  BONUS: BONUS_WEIGHT,
};

/** Free-spins per-cell weights: richer premiums, more wilds, rarer scatter, NO bonus — the
 *  instant bonus is a base-game-only feature, so free spins never re-award it. */
const FREE_COMMON: Record<SymbolId, number> = {
  KIRIN: 6,
  QUEEN: 7,
  PHOENIX: 8,
  SHARK: 9,
  CHEST: 10,
  BELL: 11,
  RUBY: 12,
  LOTUS: 13,
  A: 18,
  K: 22,
  Q: 24,
  J: 28,
  WILD: 0,
  SCATTER: 2.6,
  BONUS: 0,
};

export const BASE_REEL_WEIGHTS = perReel(BASE_COMMON, 3.5);
export const FREE_REEL_WEIGHTS = perReel(FREE_COMMON, 6);

/** Pay per line for k-of-a-kind from reel 1, in bps of total bet. The cheapest royals pay
 *  little at 3 (keeps the sub-1× loss-disguised-as-win flood in check). */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5, number>> = {
  KIRIN: { 3: 40000, 4: 200000, 5: 1000000 },
  QUEEN: { 3: 25000, 4: 120000, 5: 600000 },
  PHOENIX: { 3: 18000, 4: 90000, 5: 450000 },
  SHARK: { 3: 12000, 4: 50000, 5: 180000 },
  CHEST: { 3: 9000, 4: 36000, 5: 140000 },
  BELL: { 3: 7000, 4: 28000, 5: 100000 },
  RUBY: { 3: 5000, 4: 20000, 5: 80000 },
  LOTUS: { 3: 4000, 4: 16000, 5: 64000 },
  A: { 3: 3000, 4: 12000, 5: 48000 },
  K: { 3: 2500, 4: 10000, 5: 40000 },
  Q: { 3: 2000, 4: 8000, 5: 32000 },
  J: { 3: 1500, 4: 6000, 5: 24000 },
};

/** Scatter (pearl) pays anywhere on the grid by count, in bps of total bet. Kept modest: the
 *  scatter's value is the FREE-SPINS trigger, not the anywhere-pay — a small direct pay frees
 *  RTP budget for frequent line wins (a higher PAYOUT_SCALAR_BPS, fewer hollow sub-1× wins). */
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
 * Free-spins "Kirin Fire" multiplier rises deterministically +1 per spin (spin 1 = ×1, spin
 * 2 = ×2, …) and is capped. No RNG, no collectible — the ramp IS the feature, concentrating
 * volatility into the tail.
 */
export const MAX_FS_MULTIPLIER = 10;

/** Minimum BONUS symbols to trigger the instant prize. */
export const BONUS_TRIGGER = 3;
/**
 * Instant BONUS prize by count, in bps of total bet (20× / 100× / 500×). Server-decided and
 * deterministic from the count of BONUS symbols on the base grid. NOT RTP-scaled — the reveal
 * is always an exact headline multiple. 6+ BONUS (reachable on a 20-cell grid) clamps to the
 * 5-count prize.
 */
export const BONUS_AWARD: Record<number, number> = {
  3: 200000,
  4: 1000000,
  5: 5000000,
};

/**
 * Per-spin probability that the four-tier jackpot strikes (a single RNG draw at the end of the
 * round, so it never perturbs the grid draw order). When it strikes, the tier is picked by
 * JACKPOT_TIER_WEIGHTS. Both the chance and the tier mix set the (unscaled) jackpot RTP slice;
 * re-measure with simulate.ts after a change.
 */
export const JACKPOT_CHANCE = 1 / 6000;

/** Relative weights for the struck tier. MINI most common → GRAND rarest. */
export const JACKPOT_TIER_WEIGHTS: Record<KirinJackpotTier, number> = {
  MINI: 100,
  MINOR: 45,
  MAJOR: 12,
  GRAND: 3,
};

/** Jackpot award per tier, in bps — the public fixed bet-multiples (paid verbatim). */
export const JACKPOT_AWARD = KIRIN_JACKPOTS;

/** Hard per-round win cap = 5000× total bet (in bps). Bounds liability and gives the game a
 *  headline max-win; binds very rarely so it stays a real jackpot event. */
export const MAX_WIN_BPS = 50_000_000;

/**
 * Global linear RTP calibration (bps) for the SCALED slice (lines + scatter + free spins). The
 * fixed BONUS and JACKPOT prizes are added on top unscaled, so realized RTP =
 * `scaledRtp(scalar) + bonusRtp + jackpotRtp`. CALIBRATED by simulate.ts — run it after any
 * table change and paste the suggested value here.
 */
export const PAYOUT_SCALAR_BPS = 22243;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
