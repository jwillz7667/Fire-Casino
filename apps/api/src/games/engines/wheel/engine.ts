import { WHEEL_LAYOUTS, WHEEL_SEGMENT_COUNT, type WheelRisk } from "@aureus/shared";

/** A uniform draw in [0, 1). The provider feeds the provable-fairness stream. */
export type Rng = () => number;

export interface WheelOutcome extends Record<string, unknown> {
  kind: "fortune-wheel";
  win: boolean;
  risk: WheelRisk;
  index: number; // landing segment, 0..29
  multiplier: number; // the segment's payout multiplier
  totalWinBps: number; // multiplier × 10000 (win in bps of total bet)
}

export interface EngineResult {
  totalWinBps: number;
  outcome: WheelOutcome;
}

/**
 * Spin the Fortune Wheel on a provable-fairness RNG. The landing segment is a single
 * uniform draw over the 30 equal segments; the win is exactly that segment's multiplier
 * × bet. Pure: identical RNG ⇒ identical outcome. RTP is the mean segment multiplier of
 * the chosen risk layout (0.96 by design) — no hidden payout scalar.
 */
export function spin(rng: Rng, risk: WheelRisk): EngineResult {
  const layout = WHEEL_LAYOUTS[risk];
  // Clamp guards the rng()===1 edge (createRoundRng never returns it, but be exact).
  const index = Math.min(WHEEL_SEGMENT_COUNT - 1, Math.floor(rng() * WHEEL_SEGMENT_COUNT));
  const multiplier = layout[index]!;
  const totalWinBps = Math.round(multiplier * 10_000);
  return {
    totalWinBps,
    outcome: {
      kind: "fortune-wheel",
      win: totalWinBps > 0,
      risk,
      index,
      multiplier,
      totalWinBps,
    },
  };
}
