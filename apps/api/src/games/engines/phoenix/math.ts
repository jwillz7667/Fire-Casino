import { type PayingSymbol, type SymbolId } from "./symbols";

/**
 * Phoenix Ascendant math model. All payouts are expressed in basis points of the
 * total bet (10000 bps = 1× bet) so money stays integer end-to-end. Cells are
 * drawn i.i.d. from per-reel weight vectors — identical across reels — which
 * keeps the long-run RTP analytically tractable and lets PAYOUT_SCALAR calibrate
 * it linearly (every payout scales by the same factor, so total RTP does too).
 *
 * RTP is an emergent property of these tables, MEASURED by Monte-Carlo
 * (engine.simulation.test.ts) and pinned into the catalog's rtpBps. Do not infer
 * RTP from a single constant — change a weight or pay and re-measure.
 */

export const REELS = 5;
export const ROWS = 3;

/** Relative draw weights per cell in the base game (no ORB lands in the base). */
export const BASE_WEIGHTS: Record<SymbolId, number> = {
  CREST: 5,
  TALON: 7,
  EGG: 9,
  FEATHER: 11,
  GOLD: 14,
  EMBER: 16,
  TEAL: 19,
  VIOLET: 22,
  SCATTER: 5,
  ORB: 0,
};

/** Free-spins draw weights: richer in high symbols, ORB present, rarer scatter. */
export const FREE_SPIN_WEIGHTS: Record<SymbolId, number> = {
  CREST: 6,
  TALON: 8,
  EGG: 10,
  FEATHER: 12,
  GOLD: 13,
  EMBER: 14,
  TEAL: 15,
  VIOLET: 16,
  SCATTER: 4,
  ORB: 10,
};

/** Pay per single way for k-of-a-kind from reel 1, in bps of total bet. */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5, number>> = {
  CREST: { 3: 4000, 4: 15000, 5: 60000 },
  TALON: { 3: 3000, 4: 12000, 5: 50000 },
  EGG: { 3: 2500, 4: 9000, 5: 40000 },
  FEATHER: { 3: 2000, 4: 7000, 5: 30000 },
  GOLD: { 3: 1200, 4: 4000, 5: 15000 },
  EMBER: { 3: 1000, 4: 3000, 5: 12000 },
  TEAL: { 3: 800, 4: 2500, 5: 10000 },
  VIOLET: { 3: 600, 4: 2000, 5: 8000 },
};

/** Scatter pays anywhere on the grid by count, in bps of total bet. */
export const SCATTER_PAY: Record<number, number> = {
  3: 2000,
  4: 10000,
  5: 100000,
};

/** Minimum scatters to award free spins, and the spins granted per count. */
export const SCATTER_TRIGGER = 3;
export const FREE_SPINS_AWARD: Record<number, number> = {
  3: 8,
  4: 12,
  5: 20,
};
/** A retrigger (3+ scatters during free spins) adds this many spins. */
export const RETRIGGER_SPINS = 5;
/** Hard cap on total free spins in one feature, so the round always terminates. */
export const MAX_FREE_SPINS = 60;

/**
 * ORB collectible (free spins only). Each ORB landed draws a value and adds it to
 * a sticky multiplier that starts at +0 (applied multiplier = 1 + collected).
 * The applied multiplier is capped so a long feature can't diverge.
 */
export const ORB_VALUE_WEIGHTS: { value: number; weight: number }[] = [
  { value: 2, weight: 50 },
  { value: 3, weight: 30 },
  { value: 5, weight: 15 },
  { value: 10, weight: 5 },
];
export const MAX_ORB_MULTIPLIER = 100;

/**
 * Global linear RTP calibration (bps). The raw tables above produce some intrinsic
 * RTP; this scales every payout to land on the certified target. CALIBRATED by
 * engine.simulation.test.ts — see that test for the measured RTP this yields.
 */
export const PAYOUT_SCALAR_BPS = 8143;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
