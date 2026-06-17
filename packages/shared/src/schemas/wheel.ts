/**
 * Fortune Wheel — the PUBLIC game contract shared by the server engine and the arcade
 * renderer. Unlike a slot's reel weights, a wheel's segment multipliers ARE shown to the
 * player (they're the wheel face), so the layouts live here in the public contract. The
 * only secret is the landing position, which the server draws from the provable-fairness
 * stream — the client renders the wheel and spins to the server-decided index.
 *
 * RTP is honest-by-construction: the win is exactly `multiplier × bet`, and each risk
 * layout is designed so the mean segment multiplier is 0.96 (96% RTP). There is no hidden
 * payout scalar — what the wheel shows is what it pays. The engine tests assert the means.
 */

export const WHEEL_GAME_CODE = "fortune-wheel";

export const WHEEL_RISKS = ["LOW", "MEDIUM", "HIGH"] as const;
export type WheelRisk = (typeof WHEEL_RISKS)[number];

/** Every wheel has this many equal segments; landing is uniform over them. */
export const WHEEL_SEGMENT_COUNT = 30;

/**
 * The wheel face per risk: `WHEEL_LAYOUTS[risk][i]` is the payout multiplier of segment
 * `i` (0..29) going clockwise from the pointer. Order is fixed so the client and server
 * agree on what each landing index pays. Each array has 30 entries and a mean of 0.96.
 * Higher risk = more 0× segments but a richer top (LOW tops at 2×, HIGH at 9.8×).
 */
export const WHEEL_LAYOUTS: Record<WheelRisk, number[]> = {
  LOW: [
    1.2, 0.0, 1.5, 1.2, 1.7, 0.0,
    1.2, 1.5, 0.0, 1.2, 2.0, 1.2,
    0.0, 1.2, 1.5, 1.2, 0.0, 1.5,
    1.2, 0.0, 1.2, 1.7, 1.2, 0.0,
    1.5, 1.2, 0.0, 1.5, 1.2, 0.0,
  ],
  MEDIUM: [
    0.0, 1.5, 0.0, 2.0, 0.0, 1.5,
    3.0, 0.0, 1.5, 0.0, 2.0, 0.0,
    1.8, 0.0, 1.5, 0.0, 4.0, 0.0,
    2.0, 0.0, 1.5, 3.0, 0.0, 2.0,
    0.0, 1.5, 0.0, 0.0, 0.0, 0.0,
  ],
  HIGH: [
    0.0, 0.0, 1.5, 0.0, 0.0, 4.0,
    0.0, 0.0, 2.0, 0.0, 0.0, 0.0,
    9.8, 0.0, 0.0, 4.0, 0.0, 0.0,
    2.0, 0.0, 0.0, 1.5, 0.0, 0.0,
    4.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  ],
};

export interface WheelOutcome {
  kind: "fortune-wheel";
  win: boolean;
  risk: WheelRisk;
  index: number; // landing segment, 0..29
  multiplier: number; // the segment's payout multiplier (what the player sees land)
  totalWinBps: number; // multiplier × 10000 (= win in bps of total bet)
}

/** Narrow an opaque round outcome JSON to the Fortune Wheel payload. */
export function isWheelOutcome(outcome: unknown): outcome is WheelOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "fortune-wheel"
  );
}

/** Narrow an arbitrary string to a valid risk, defaulting to MEDIUM. */
export function toWheelRisk(value: unknown): WheelRisk {
  return WHEEL_RISKS.includes(value as WheelRisk) ? (value as WheelRisk) : "MEDIUM";
}
