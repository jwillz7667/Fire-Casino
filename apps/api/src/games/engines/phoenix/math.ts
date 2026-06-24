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

/** Relative draw weights per cell in the base game (no ORB lands in the base). HIGH-volatility
 *  tier: the cheap TEAL/VIOLET fillers are still heaviest (they form the board texture) but their
 *  3-of-a-kind no longer pays, so they stop registering as hollow sub-1× "wins" — hit frequency
 *  drops into the meaningful-hit band and the dead/sub-1× dribble shrinks. The SCATTER weight is
 *  cut hard (5.5 → 2.4) so the free-spins feature is a rare ~1-in-200 event rather than 1-in-28,
 *  while staying frequent enough that the 2-scatter "one-to-go" tease still shows. Re-measure
 *  after any change. */
export const BASE_WEIGHTS: Record<SymbolId, number> = {
  CREST: 5,
  TALON: 7,
  EGG: 9,
  FEATHER: 11,
  GOLD: 14,
  EMBER: 16,
  TEAL: 19,
  VIOLET: 22,
  SCATTER: 2.4,
  ORB: 0,
};

/**
 * Free-spins draw weights. Invariant (asserted in engine.test.ts): a free spin must
 * WIN MORE OFTEN and pay more per spin than a base spin — the bonus is unconditionally
 * better than regular play. In a 243-ways game the non-paying ORB collectible eats
 * ways-forming cells, so naively "richer in premiums" weights actually *lower* the hit
 * rate below base. Instead the distribution is deliberately filler-dominant (heavy
 * TEAL/VIOLET) so 3+-of-a-kind lands constantly; the ORB-driven sticky multiplier then
 * carries the win SIZE. Measured (post HIGH-tier retune): free hit ≈ 26.7% vs base ≈ 24.4%,
 * free mean (pre multiplier) ≈ +26% vs base. Re-measure with _winrate-probe.ts after any change.
 */
export const FREE_SPIN_WEIGHTS: Record<SymbolId, number> = {
  CREST: 4,
  TALON: 6,
  EGG: 8,
  FEATHER: 10,
  GOLD: 14,
  EMBER: 18,
  TEAL: 26,
  VIOLET: 32,
  SCATTER: 4,
  ORB: 5,
};

/**
 * Pay per single way for k-of-a-kind from reel 1, in bps of total bet. HIGH-volatility shape:
 * the two cheapest fillers (TEAL/VIOLET) no longer pay 3-of-a-kind and FEATHER's 3-pay is
 * sharply trimmed, which removes the hollow sub-1× dribble. The top premiums (CREST/TALON/EGG)
 * have steepened 5-of-a-kind pays so the rare full-line / multiplied-free-spin wins are large,
 * giving the distribution a real fat tail. NOTE: this table is shared by base AND free spins, so
 * trimming low 3-pays also moves the bonus-winrate invariant — re-verify it stays GREEN.
 */
export const PAYTABLE: Record<PayingSymbol, Record<3 | 4 | 5, number>> = {
  CREST: { 3: 14000, 4: 50000, 5: 250000 },
  TALON: { 3: 13000, 4: 38000, 5: 180000 },
  EGG: { 3: 12000, 4: 26000, 5: 110000 },
  FEATHER: { 3: 11000, 4: 18000, 5: 60000 },
  GOLD: { 3: 11000, 4: 11000, 5: 30000 },
  EMBER: { 3: 8000, 4: 9000, 5: 22000 },
  TEAL: { 3: 0, 4: 7000, 5: 16000 },
  VIOLET: { 3: 0, 4: 5000, 5: 12000 },
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
  { value: 1, weight: 50 },
  { value: 2, weight: 30 },
  { value: 3, weight: 12 },
  { value: 5, weight: 5 },
  { value: 25, weight: 3 },
  { value: 100, weight: 2 },
];
/** Lifted (100 → 750) to give the sticky-ORB free-spins tail real headroom: a lucky stacked
 *  feature can climb into the hundreds-× multiplier, which is what carries the HIGH-tier
 *  5,000×+ max win. The MAX_WIN_BPS clamp still bounds the absolute extreme. */
export const MAX_ORB_MULTIPLIER = 750;

/**
 * Absolute per-round win cap, in bps of total bet (150_000_000 = 15,000×). A safety clamp for the
 * extreme sticky-multiplier tail so a round can never diverge past the certified max-win headline;
 * the table-driven distribution lands far below this in the overwhelming majority of features.
 */
export const MAX_WIN_BPS = 150_000_000;

/**
 * Global linear RTP calibration (bps). The raw tables above produce some intrinsic
 * RTP; this scales every payout to land on the certified target. CALIBRATED by
 * engine.simulation.test.ts — see that test for the measured RTP this yields.
 */
export const PAYOUT_SCALAR_BPS = 9941;

/** The certified RTP this model targets, in bps — must match the catalog game. */
export const CERTIFIED_RTP_BPS = 9600;
