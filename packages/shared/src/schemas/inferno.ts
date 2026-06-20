/**
 * Inferno Link — the PUBLIC game contract shared by the server engine and the arcade
 * renderer. A fire-themed 5×4, 25-line HOLD-AND-SPIN slot (the "fire link" genre, original
 * Goldwave art — not the trademarked Ultimate Fire Link). Gems/bell/coin/seven pay on
 * lines; a WILD substitutes; the flaming FIREBALL is the money symbol. Land 6+ fireballs
 * and they lock to trigger a lock-and-respin bonus where each new fireball resets the
 * respins; fill all 20 cells for the GRAND.
 *
 * Like the wheel and cosmic's bonus, the FIREBALL values and the four jackpot tiers ARE
 * shown to the player and paid VERBATIM (never RTP-scaled), so a reveal is always exact.
 * The base line slice is the only thing the payout scalar tunes; total RTP ≈ 96% is
 * measured by the engine's simulate.ts.
 */

export const INFERNO_GAME_CODE = "inferno-link";

export const INFERNO_REELS = 5;
export const INFERNO_ROWS = 4;
export const INFERNO_CELLS = INFERNO_REELS * INFERNO_ROWS; // 20

/** Fireballs required on the base grid to trigger the hold-and-spin. */
export const INFERNO_TRIGGER = 6;
/** Respins granted, and re-granted whenever a new fireball locks. */
export const INFERNO_RESPINS = 3;

export const INFERNO_JACKPOT_TIERS = ["MINI", "MINOR", "MAJOR", "GRAND"] as const;
export type InfernoJackpotTier = (typeof INFERNO_JACKPOT_TIERS)[number];

/**
 * Jackpot values in bps of total bet (10000 = 1× bet). Fixed bet-multiples (not a shared
 * progressive pool — that needs cross-player accrual, out of scope), shown in the HUD and
 * paid exactly. GRAND is only awarded by filling all 20 cells.
 */
export const INFERNO_JACKPOTS: Record<InfernoJackpotTier, number> = {
  MINI: 200_000, // 20×
  MINOR: 500_000, // 50×
  MAJOR: 2_000_000, // 200×
  GRAND: 10_000_000, // 1000×
};

/** A locked fireball: a credit value, or one of the jackpot tiers. */
export type InfernoFireTier = "CREDIT" | InfernoJackpotTier;

export interface InfernoFire {
  reel: number; // 0..4
  row: number; // 0..3
  valueBps: number; // value in bps of total bet (exact, paid verbatim)
  tier: InfernoFireTier;
}

export interface InfernoLineWin {
  line: number; // payline index 0..24
  symbol: string; // paying symbol id
  count: number; // 3..5
  payBps: number; // line pay in bps of bet (post scalar)
}

export interface InfernoHoldSpin {
  triggered: true;
  /** Fireballs present on the base grid that started the feature. */
  initial: InfernoFire[];
  /** Each respin round, in order, with only the fireballs that newly locked that round. */
  rounds: { newLocks: InfernoFire[] }[];
  /** Every locked fireball at the end (initial + all rounds). */
  locked: InfernoFire[];
  filledAll: boolean; // all 20 cells locked → GRAND
  bonusBps: number; // sum of all fireball values + GRAND (verbatim, unscaled)
}

export interface InfernoOutcome {
  kind: "inferno-link";
  win: boolean;
  /** Base 5×4 grid, column-major: grid[reel][row] is a symbol id. */
  grid: string[][];
  lineWins: InfernoLineWin[];
  baseFireballCount: number;
  holdSpin: InfernoHoldSpin | null;
  totalWinBps: number; // final win in bps of total bet
}

/** Narrow an opaque round outcome JSON to the Inferno Link payload. */
export function isInfernoOutcome(outcome: unknown): outcome is InfernoOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "inferno-link"
  );
}
