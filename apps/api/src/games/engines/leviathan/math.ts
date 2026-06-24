import { type PayingSymbol, type SymbolId } from "./symbols";

/**
 * Leviathan's Deep math model. A 6×5 WAYS-TO-WIN (up to 6^5 = 7,776 ways) tumbling slot. Payouts
 * are in basis points of the TOTAL bet (10000 bps = 1× bet) so money stays integer end-to-end.
 * Cells are drawn i.i.d. from per-reel weight vectors. The vectors are identical across reels
 * EXCEPT the WILD, which only lands on the four interior reels (1..4): a ways-win therefore always
 * starts on a real symbol on reel 0, and a full 6-reel run ends on a real symbol on reel 5.
 *
 * WAYS: for each paying symbol, ways = product over consecutive reels from reel 0 of
 * (count of that symbol + wilds on that reel), as long as every reel in the run carries at least
 * one match. A symbol pays once per spin at PAYTABLE[symbol][reelsMatched] × ways.
 *
 * TUMBLING: after a winning step the contributing cells clear, symbols above fall, and the gaps
 * refill from the top; the grid is re-evaluated until a step has no win. A rising cascade ladder
 * (BASE_CASCADE_MULTIPLIERS) multiplies each successive base step.
 *
 * Three slices ride on the base ways game:
 *   • SCATTER (conch) → free spins under a PERSISTENT "rising tide" multiplier. Each MULT_ORB that
 *     lands adds its value to the tide; the tide multiplies every free cascade step and only ever
 *     increases. Lines + free spins are scaled by PAYOUT_SCALAR_BPS, so base RTP is a single knob.
 *   • BONUS (kraken amulet) → "Kraken Awakens", an INSTANT fixed bet-multiple prize on 3+ anywhere
 *     (20× / 75× / 300× / 1000×). Added to the round total VERBATIM — never RTP-scaled — so the
 *     reveal is always exact. Its RTP slice is set by the BONUS reel weight, not the scalar.
 *
 * RTP is an emergent property of these tables, MEASURED by simulate.ts. Do not infer RTP from a
 * single constant — change a weight, a pay or the bonus weight and re-measure.
 */

export const REELS = 6;
export const ROWS = 5;

/** Minimum consecutive reels (from reel 0) for a ways-win to pay. */
export const MIN_WAYS_REELS = 3;

/**
 * Build a 6-reel weight table from a common per-cell vector, placing the WILD only on the interior
 * reels (1..4); reels 0 and 5 get WILD weight 0 so a ways-win always anchors on a real symbol.
 */
function perReel(common: Record<SymbolId, number>, wildInterior: number): Record<SymbolId, number>[] {
  return Array.from({ length: REELS }, (_unused, reel) => ({
    ...common,
    WILD: reel === 0 || reel === REELS - 1 ? 0 : wildInterior,
  }));
}

/**
 * BONUS reel weight (base game only). Kept low: the Kraken award is a fixed, unscaled headline
 * prize, so its RTP slice is set HERE, not by the payout scalar. Low enough that 3+ is a rare
 * jackpot-style trigger on the 30-cell grid, high enough that "two landed, one to go" tease shows
 * regularly. Re-measure with simulate.ts after a change.
 */
const BONUS_WEIGHT = 1.2;

/** Base-game per-cell weights (WILD filled per-reel by perReel; no MULT_ORB in base). Gem lows are
 *  heavy filler so wins are frequent but skew toward the picture premiums and the features. */
const BASE_COMMON: Record<SymbolId, number> = {
  LEVIATHAN: 4,
  KRAKEN: 6,
  SIREN: 8,
  TRIDENT: 10,
  CHEST: 13,
  EMERALD: 16,
  AMETHYST: 18,
  SAPPHIRE: 20,
  AQUA: 22,
  PEARL: 24,
  WILD: 0,
  SCATTER: 3.6,
  BONUS: BONUS_WEIGHT,
  MULT_ORB: 0,
};

/** Free-spins per-cell weights: richer premiums + more wilds than base (so free hits more often AND
 *  pays more per spin — the owner invariant), a rarer SCATTER for retriggers, NO bonus, plus the
 *  MULT_ORB that feeds the tide. Kept only MODESTLY above base — the tide ramp does the amplifying. */
const FREE_COMMON: Record<SymbolId, number> = {
  LEVIATHAN: 5,
  KRAKEN: 7,
  SIREN: 9,
  TRIDENT: 11,
  CHEST: 14,
  EMERALD: 16,
  AMETHYST: 17,
  SAPPHIRE: 18,
  AQUA: 19,
  PEARL: 20,
  WILD: 0,
  SCATTER: 1.6,
  BONUS: 0,
  MULT_ORB: 3.2,
};

// Free reels carry one extra WILD vs base (interior only) so free spins clear MORE ways and pay
// MORE per drop than base even before the tide ramp — the owner invariant, with margin.

export const BASE_REEL_WEIGHTS = perReel(BASE_COMMON, 4);
export const FREE_REEL_WEIGHTS = perReel(FREE_COMMON, 7);

/**
 * Pay per ways-win by reels matched (3..6), in bps of total bet, BEFORE the ways multiplicity and
 * the cascade/tide multiplier. Premiums pay well above the gems; a full 6-reel premium run with
 * multiple ways is the headline win. The PAYOUT_SCALAR_BPS knob calibrates the whole slice.
 */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5 | 6, number>> = {
  LEVIATHAN: { 3: 2000, 4: 6000, 5: 20000, 6: 60000 },
  KRAKEN: { 3: 1200, 4: 4000, 5: 12000, 6: 36000 },
  SIREN: { 3: 800, 4: 2500, 5: 8000, 6: 24000 },
  TRIDENT: { 3: 500, 4: 1600, 5: 5000, 6: 15000 },
  CHEST: { 3: 350, 4: 1000, 5: 3000, 6: 9000 },
  EMERALD: { 3: 200, 4: 600, 5: 1800, 6: 5000 },
  AMETHYST: { 3: 160, 4: 480, 5: 1400, 6: 4000 },
  SAPPHIRE: { 3: 120, 4: 360, 5: 1000, 6: 3000 },
  // The two commonest gems pay only from 4 of a kind: this trims the sub-1× win flood so the
  // game reads as high-volatility (fewer, bigger wins) rather than a constant dribble.
  AQUA: { 3: 0, 4: 320, 5: 900, 6: 2400 },
  PEARL: { 3: 0, 4: 260, 5: 700, 6: 1800 },
};

/**
 * Base-game cascade ladder: the multiplier applied to each successive tumble step within ONE base
 * spin (step 0 = ×1, step 1 = ×2, …), clamped at the last entry. Concentrates volatility into long
 * cascades without an unbounded ramp.
 */
export const BASE_CASCADE_MULTIPLIERS: readonly number[] = [1, 2, 3, 5];

/** Hard cap on tumble steps per spin so a round always terminates (defensive; effectively never
 *  hit — each step clears ≥3 cells and refills are independent). */
export const MAX_CASCADES = 100;

/** Minimum scatters on the INITIAL grid to award free spins, and the spins granted per count. */
export const SCATTER_TRIGGER = 4;
export const FREE_SPINS_AWARD: Record<number, number> = {
  4: 10,
  5: 12,
  6: 15,
};
/** A retrigger (4+ scatters on a free-spin's initial drop) adds this many spins. */
export const RETRIGGER_SPINS = 5;
/** Hard cap on total free spins in one feature, so the round always terminates. */
export const MAX_FREE_SPINS = 50;

/** The tide multiplier at the start of every free-spins feature. */
export const FREE_START_TIDE = 1;

/**
 * MULT_ORB values and their relative weights (free spins only). Each orb that lands ADDS its value
 * to the persistent tide. The tide therefore ramps as the feature runs and multiplies every
 * subsequent cascade — the ramp IS the feature, concentrating volatility into the tail. Re-measure
 * with simulate.ts after a change: the free-spins RTP slice is highly sensitive to these.
 */
export const ORB_VALUE_WEIGHTS: Record<number, number> = {
  2: 50,
  3: 30,
  5: 15,
  10: 5,
};

/** Minimum BONUS symbols on the initial grid to awaken the Kraken. */
export const BONUS_TRIGGER = 3;
/**
 * Kraken Awakens instant prize by BONUS count, in bps of total bet (20× / 75× / 300× / 1000×).
 * Server-decided and deterministic from the count on the base grid. NOT RTP-scaled — the reveal is
 * always an exact headline multiple. 6 BONUS (reachable on a 30-cell grid) clamps to the 6 prize.
 */
export const BONUS_AWARD: Record<number, number> = {
  3: 200_000,
  4: 750_000,
  5: 3_000_000,
  6: 10_000_000,
};

/** Hard per-round win cap = 20000× total bet (in bps). Bounds liability and sets the headline
 *  max-win; binds very rarely (a long high-tide free-spins run) so it stays a real event. */
export const MAX_WIN_BPS = 200_000_000;

/**
 * Global linear RTP calibration (bps) for the SCALED slice (base ways + free spins). The fixed
 * Kraken prize is added on top unscaled, so realized RTP = `scaledRtp(scalar) + bonusRtp`.
 * CALIBRATED by simulate.ts — run it after any table change and paste the suggested value here.
 */
export const PAYOUT_SCALAR_BPS = 2337;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
