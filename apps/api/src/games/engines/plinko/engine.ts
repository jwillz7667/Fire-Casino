import {
  PLINKO_BUCKET_COUNT,
  PLINKO_LAYOUTS,
  PLINKO_ROWS,
  type PlinkoRisk,
} from "@aureus/shared";

/** A uniform draw in [0, 1). The provider feeds the provable-fairness stream. */
export type Rng = () => number;

export interface PlinkoOutcome extends Record<string, unknown> {
  kind: "plinko";
  win: boolean;
  risk: PlinkoRisk;
  path: number[]; // 12 decisions, 0 = left, 1 = right (top row first)
  bucket: number; // 0..12 (= count of rights)
  multiplier: number;
  totalWinBps: number; // multiplier × 10000
}

export interface EngineResult {
  totalWinBps: number;
  outcome: PlinkoOutcome;
}

/**
 * Drop one ball on a provable-fairness RNG. Each of the 12 rows is one independent
 * left/right decision (rng() < 0.5 ⇒ left), so the landing bucket follows the binomial
 * distribution over 13 buckets — center common, edges rare. The win is exactly the landed
 * bucket's multiplier × bet; RTP is the binomial-weighted mean of the risk curve (0.96 by
 * design, asserted in the tests) — no hidden payout scalar. Pure: identical RNG ⇒ identical
 * outcome, and it consumes exactly PLINKO_ROWS draws so the fairness stream stays aligned.
 */
export function drop(rng: Rng, risk: PlinkoRisk): EngineResult {
  const layout = PLINKO_LAYOUTS[risk];
  const path: number[] = [];
  let bucket = 0;
  for (let row = 0; row < PLINKO_ROWS; row++) {
    const right = rng() < 0.5 ? 0 : 1;
    path.push(right);
    bucket += right;
  }
  // bucket ∈ [0, PLINKO_ROWS]; guard the rng()===0 / boundary edge defensively.
  bucket = Math.min(PLINKO_BUCKET_COUNT - 1, bucket);
  const multiplier = layout[bucket]!;
  const totalWinBps = Math.round(multiplier * 10_000);
  return {
    totalWinBps,
    outcome: {
      kind: "plinko",
      win: totalWinBps > 0,
      risk,
      path,
      bucket,
      multiplier,
      totalWinBps,
    },
  };
}
