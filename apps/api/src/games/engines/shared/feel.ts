import {
  SLOT_WIN_TIER_MIN_BPS,
  type SlotAnticipation,
  type SlotFeel,
  type SlotNearMiss,
  type SlotWinTier,
} from "@aureus/shared";

/**
 * Shared, engine-agnostic "feel" helpers. Every slot engine calls these on its decided outcome
 * to attach the presentation-only suspense + celebration hints (see @aureus/shared slot-feel).
 * Pure functions: identical inputs ⇒ identical hints, no RNG, no money mutation.
 */

/**
 * Classify the win-celebration tier from the round's total win (bps of total bet, 10000 = 1×).
 * Pass `jackpot: true` to force the JACKPOT tier regardless of the numeric size.
 */
export function classifyWinTier(totalWinBps: number, jackpot = false): SlotWinTier {
  if (jackpot) return "JACKPOT";
  if (totalWinBps < SLOT_WIN_TIER_MIN_BPS.NICE) return "NONE";
  if (totalWinBps >= SLOT_WIN_TIER_MIN_BPS.EPIC) return "EPIC";
  if (totalWinBps >= SLOT_WIN_TIER_MIN_BPS.MEGA) return "MEGA";
  if (totalWinBps >= SLOT_WIN_TIER_MIN_BPS.BIG) return "BIG";
  return "NICE";
}

/**
 * Derive a single trigger symbol's anticipation from a column-major grid (grid[reel][row]).
 * Walking reels left→right, `fromReel` is the first reel at which the symbol is exactly one
 * short of `needed` (so a single remaining reel can still trigger) — the moment the client
 * should slow the rest of the reels into a drumroll. Null when the spin never reached the
 * one-to-go state (it either triggered outright or was never close).
 */
export function computeAnticipation(
  grid: readonly (readonly string[])[],
  symbol: string,
  needed: number,
): SlotAnticipation {
  const reels: number[] = [];
  let cumulativeBefore = 0;
  let total = 0;
  let fromReel: number | null = null;
  for (let r = 0; r < grid.length; r++) {
    if (fromReel === null && cumulativeBefore === needed - 1) fromReel = r;
    let inReel = 0;
    for (const cell of grid[r]!) if (cell === symbol) inReel++;
    if (inReel > 0) reels.push(r);
    cumulativeBefore += inReel;
    total += inReel;
  }
  return { symbol, reels, count: total, needed, fromReel };
}

/**
 * Assemble the outcome's feel payload. Anticipations that teased (`fromReel !== null`) but fell
 * short (`count < needed`) become near-miss beats. Only teasing anticipations are surfaced —
 * a symbol that never threatened to trigger carries no suspense signal.
 */
export function buildFeel(params: {
  totalWinBps: number;
  jackpot?: boolean;
  anticipation: SlotAnticipation[];
}): SlotFeel {
  const teasing = params.anticipation.filter((a) => a.fromReel !== null);
  const nearMiss: SlotNearMiss[] = teasing
    .filter((a) => a.count < a.needed)
    .map((a) => ({ symbol: a.symbol, count: a.count, needed: a.needed }));
  return {
    winTier: classifyWinTier(params.totalWinBps, params.jackpot ?? false),
    anticipation: teasing,
    nearMiss,
  };
}
