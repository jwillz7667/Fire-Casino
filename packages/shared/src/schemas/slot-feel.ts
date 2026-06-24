/**
 * Shared "feel" signals every slot outcome carries so the arcade clients can render suspense and
 * an escalating win celebration consistently across games. These are PRESENTATION-ONLY hints
 * derived from the already-decided outcome — they never change the win amount or the RTP. The
 * server fills them in; each Godot client reads them to drive anticipation slow-downs, near-miss
 * beats and the small→epic win ladder.
 *
 * Like the per-game outcome payloads, this is a plain typed contract (no zod) because it is
 * server→client render JSON the client only reads; boundary INPUTS are still zod-validated.
 */

/**
 * Win celebration tier, ordered by intensity. The client maps each to its own banner, sound and
 * coin-shower length. NONE = no win. JACKPOT is flagged by the engine when a jackpot tier
 * actually strikes, regardless of the numeric size.
 */
export const SLOT_WIN_TIERS = ["NONE", "NICE", "BIG", "MEGA", "EPIC", "JACKPOT"] as const;
export type SlotWinTier = (typeof SLOT_WIN_TIERS)[number];

/**
 * Lower bound (inclusive) of each size-driven tier, in bps of total bet (10000 bps = 1× bet).
 * NICE covers any win below BIG; EPIC is open-ended above. JACKPOT is set explicitly by the
 * engine and is not size-driven. Tuned so "BIG WIN" feels earned (≥10×) rather than spammed.
 */
export const SLOT_WIN_TIER_MIN_BPS: Record<"NICE" | "BIG" | "MEGA" | "EPIC", number> = {
  NICE: 1, // any win up to 10×
  BIG: 100_000, // 10×
  MEGA: 250_000, // 25×
  EPIC: 500_000, // 50× and up
};

/**
 * Per-trigger-symbol anticipation hint. As a client reveals reels left→right, once `fromReel`
 * is reached the symbol is one short of triggering its feature, so the remaining reels should
 * slow into a drumroll/zoom. `fromReel` is null when the symbol never reached the "one-to-go"
 * state on this spin (either it triggered outright or it was never close).
 */
export interface SlotAnticipation {
  symbol: string; // trigger symbol id, e.g. "SCATTER" / "BONUS"
  reels: number[]; // reel indices (0-based) where the symbol landed this spin
  count: number; // total instances on the grid
  needed: number; // count required to trigger the feature
  fromReel: number | null; // first reel the client should start anticipating on, or null
}

/**
 * A "so close" beat: anticipation fired but the feature did NOT trigger. Clients use it to play
 * the deflating near-miss sting that, paradoxically, keeps players engaged.
 */
export interface SlotNearMiss {
  symbol: string;
  count: number; // how many landed
  needed: number; // how many were required
}

/**
 * The aggregate feel payload embedded on every slot outcome. Purely advisory render hints; the
 * authoritative money figure remains the outcome's integer `totalWinBps`.
 */
export interface SlotFeel {
  winTier: SlotWinTier;
  anticipation: SlotAnticipation[]; // only entries that actually teased (fromReel !== null)
  nearMiss: SlotNearMiss[];
}
