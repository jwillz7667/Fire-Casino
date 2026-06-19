/**
 * Plinko — the PUBLIC game contract shared by the server engine and the arcade renderer.
 * A ball drops through 12 rows of pegs, taking a provably-fair left/right decision at each
 * row, and lands in one of 13 buckets. The bucket multipliers ARE shown to the player (they
 * label the slots), so the payout tables live here in the public contract; the only secret
 * is the 12-bit drop path, which the server draws from the provable-fairness stream — the
 * client renders the board and animates the ball to the server-decided bucket.
 *
 * RTP is honest-by-construction: the win is exactly `multiplier × bet`, and each risk curve
 * is calibrated so the BINOMIAL-weighted mean multiplier is 0.96 (96% RTP). There is no
 * hidden payout scalar — what a bucket shows is what it pays. The engine tests assert the
 * weighted means. Higher risk = a deeper sub-1× center but a far richer edge (LOW tops at
 * 9.9×, MEDIUM at 45×, HIGH at 200×).
 */

export const PLINKO_GAME_CODE = "plinko";

export const PLINKO_RISKS = ["LOW", "MEDIUM", "HIGH"] as const;
export type PlinkoRisk = (typeof PLINKO_RISKS)[number];

/** Rows of pegs = left/right decisions per drop. Buckets = rows + 1. */
export const PLINKO_ROWS = 12;
export const PLINKO_BUCKET_COUNT = PLINKO_ROWS + 1; // 13

/**
 * `PLINKO_LAYOUTS[risk][k]` is the payout multiplier of bucket `k` (0..12, left→right),
 * where `k` is the number of RIGHT moves over the 12 rows. The arrays are symmetric: edge
 * buckets are rare (binomial) and pay big, the center bucket is the most likely and pays
 * sub-1×. Each curve's binomial-weighted mean is ≈ 0.96 (see engine.test.ts / simulate.ts).
 */
export const PLINKO_LAYOUTS: Record<PlinkoRisk, number[]> = {
  LOW: [9.9, 3.3, 1.8, 1.3, 1.1, 0.9, 0.55, 0.9, 1.1, 1.3, 1.8, 3.3, 9.9],
  MEDIUM: [45, 11, 3.2, 1.7, 1.0, 0.7, 0.33, 0.7, 1.0, 1.7, 3.2, 11, 45],
  HIGH: [200, 28, 7, 1.8, 0.4, 0.3, 0.3, 0.3, 0.4, 1.8, 7, 28, 200],
};

export interface PlinkoOutcome {
  kind: "plinko";
  win: boolean;
  risk: PlinkoRisk;
  /** The 12 left/right decisions, 0 = left, 1 = right, top row first. */
  path: number[];
  /** Landing bucket index 0..12 (= count of 1s in `path`). */
  bucket: number;
  multiplier: number; // the landed bucket's payout multiplier (what the player sees)
  totalWinBps: number; // multiplier × 10000 (= win in bps of total bet)
}

/** Narrow an opaque round outcome JSON to the Plinko payload. */
export function isPlinkoOutcome(outcome: unknown): outcome is PlinkoOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "plinko"
  );
}

/** Narrow an arbitrary value to a valid risk, defaulting to MEDIUM. */
export function toPlinkoRisk(value: unknown): PlinkoRisk {
  return PLINKO_RISKS.includes(value as PlinkoRisk) ? (value as PlinkoRisk) : "MEDIUM";
}
