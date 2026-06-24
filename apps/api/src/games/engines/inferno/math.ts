import { type InfernoFireTier } from "@aureus/shared";
import { type PayingSymbol, type SymbolId } from "./symbols";

/**
 * Inferno Link math model — a 5×4, 25-line HOLD-AND-SPIN slot. Payouts are in basis points
 * of total bet (10000 bps = 1× bet) so money stays integer end-to-end. Cells are drawn
 * i.i.d. from a per-cell weight vector (same across reels except the WILD, interior reels
 * only, so a line starts/ends on a real symbol).
 *
 * Two payout slices:
 *   • base LINE wins (gems/coin/bell/seven, wild-substituted) — RTP-scaled by
 *     PAYOUT_SCALAR_BPS so the base RTP is one linear knob.
 *   • the HOLD-AND-SPIN feature: 6+ FIREBALLs lock and trigger a lock-&-respin; each
 *     fireball carries a value (credit multiple or a MINI/MINOR/MAJOR jackpot) drawn from
 *     FIRE_VALUE_WEIGHTS, paid VERBATIM (never scaled); filling all 20 cells adds GRAND.
 *
 * RTP is emergent and MEASURED by simulate.ts (which separates the scaled line slice from
 * the fixed feature slice and suggests the scalar that lands the combined RTP on target).
 */

export const REELS = 5;
export const ROWS = 4;

/**
 * 25 fixed paylines over the 5×4 grid. Each entry is the row index (0=top..3=bottom) the
 * line occupies on each of the 5 reels, left to right. Lines pay left-aligned only. All 25
 * are distinct and within rows 0..3 (asserted in the engine tests).
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

/** Base "credit ball" weight. Lifted so the hold-and-spin triggers (4+ on the 20-cell grid)
 *  and its "one-to-go" 3-ball tease fire more often — the feature IS the game in this genre.
 *  The feature pays VERBATIM, so a higher weight shifts RTP into the feature and the line
 *  scalar funds a smaller (but still substantial) line slice. Re-measure with simulate.ts. */
const FIREBALL_WEIGHT = 3.7;

/** Base-game per-cell weights (WILD filled per-reel by perReel). */
const BASE_COMMON: Record<SymbolId, number> = {
  SEVEN: 5,
  BELL: 7,
  COIN: 9,
  RED: 11,
  PURPLE: 13,
  BLUE: 15,
  GREEN: 16,
  WILD: 0,
  FIREBALL: FIREBALL_WEIGHT,
};

function perReel(common: Record<SymbolId, number>, wildInterior: number): Record<SymbolId, number>[] {
  return Array.from({ length: REELS }, (_unused, reel) => ({
    ...common,
    WILD: reel === 0 || reel === REELS - 1 ? 0 : wildInterior,
  }));
}

export const BASE_REEL_WEIGHTS = perReel(BASE_COMMON, 3);

/** Pay per line for k-of-a-kind from reel 1, in bps of total bet (pre scalar). */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5, number>> = {
  SEVEN: { 3: 5000, 4: 20000, 5: 100000 },
  BELL: { 3: 3000, 4: 12000, 5: 50000 },
  COIN: { 3: 2500, 4: 10000, 5: 40000 },
  RED: { 3: 2000, 4: 8000, 5: 30000 },
  PURPLE: { 3: 1500, 4: 6000, 5: 24000 },
  BLUE: { 3: 1200, 4: 5000, 5: 20000 },
  GREEN: { 3: 1000, 4: 4000, 5: 16000 },
};

/**
 * During a respin, each EMPTY cell independently lands a FIREBALL with this probability
 * (else blank). Tuned so the feature adds a few fireballs and full-screen fills stay rare.
 */
export const RESPIN_FIREBALL_PROB = 0.019;

/**
 * The value a landed FIREBALL carries, in bps of total bet, by weight. Most are small
 * credit values; the MINI/MINOR/MAJOR jackpots are progressively rarer. Paid VERBATIM.
 * GRAND is not in this table — it is only awarded by filling all 20 cells.
 */
export interface FireValue {
  valueBps: number;
  tier: InfernoFireTier;
  weight: number;
}
export const FIRE_VALUE_WEIGHTS: FireValue[] = [
  { valueBps: 10_000, tier: "CREDIT", weight: 300 }, // 1×
  { valueBps: 20_000, tier: "CREDIT", weight: 220 }, // 2×
  { valueBps: 30_000, tier: "CREDIT", weight: 160 }, // 3×
  { valueBps: 50_000, tier: "CREDIT", weight: 120 }, // 5×
  { valueBps: 80_000, tier: "CREDIT", weight: 80 }, // 8×
  { valueBps: 100_000, tier: "CREDIT", weight: 55 }, // 10×
  { valueBps: 150_000, tier: "CREDIT", weight: 28 }, // 15×
  { valueBps: 200_000, tier: "MINI", weight: 18 }, // 20× (MINI)
  { valueBps: 500_000, tier: "MINOR", weight: 8 }, // 50× (MINOR)
  { valueBps: 2_000_000, tier: "MAJOR", weight: 2 }, // 200× (MAJOR)
];

/** GRAND, in bps — awarded only on a full 20-cell fill. Mirrors INFERNO_JACKPOTS.GRAND. */
export const GRAND_BPS = 10_000_000;

/** Hard per-round win cap = 5000× total bet (bps). Bounds liability; binds very rarely. */
export const MAX_WIN_BPS = 50_000_000;

/**
 * Global linear RTP calibration (bps) for the SCALED slice (base line wins only). The
 * feature (fireball values + GRAND) is added verbatim, so realized RTP =
 * `lineRtp(scalar) + featureRtp`. CALIBRATED by simulate.ts — run it after any table
 * change and paste the suggested value here.
 */
export const PAYOUT_SCALAR_BPS = 16_798;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
