/**
 * Legend of the Flaming Kirin — the PUBLIC game contract shared by the server engine and the
 * arcade renderer. A fire-meets-deep-ocean 5×4, 25-fixed-payline slot. Picture premiums
 * (flaming kirin / sea-dragon queen / phoenix king / golden shark) and mid pictures
 * (treasure chest / ancient bell / fire ruby / lotus) pay on lines above the royals
 * (A/K/Q/J); a WILD substitutes with a rising "Kirin Fire" multiplier in free spins; the
 * SCATTER (pearl) triggers free spins on 3+; the BONUS (compass) pays an instant headline
 * prize on 3+; and a four-tier jackpot (GRAND/MAJOR/MINOR/MINI) can strike on any spin.
 *
 * Only the outcome shape + symbol ids live here; the reel weights, paytable and RTP
 * calibration are server-only (apps/api/.../engines/kirin/math.ts) and never reach the
 * client. The server decides every outcome over the provable-fairness stream; the client
 * only renders this payload. The api-side engine types mirror these and are asserted
 * assignable in the engine tests, so the contract can't drift.
 *
 * Like Cosmic's BONUS and Inferno's jackpots, the BONUS prize and the four jackpot tiers are
 * FIXED bet-multiples paid VERBATIM (never RTP-scaled) so a reveal is always exact. The big
 * "progressive" figures in the HUD are display flavour (a seeded ticker); the actual award is
 * the fixed bet-multiple here — a genuine cross-player progressive pool is out of scope.
 */

/** Catalog code + engine key for the game (server dispatch + client renderer). */
export const KIRIN_GAME_CODE = "flaming-kirin";

export const KIRIN_REELS = 5;
export const KIRIN_ROWS = 4;

export const KIRIN_SYMBOLS = [
  "KIRIN",
  "QUEEN",
  "PHOENIX",
  "SHARK",
  "CHEST",
  "BELL",
  "RUBY",
  "LOTUS",
  "A",
  "K",
  "Q",
  "J",
  "WILD",
  "SCATTER",
  "BONUS",
] as const;

export type KirinSymbol = (typeof KIRIN_SYMBOLS)[number];

/** High (premium) symbols render with a stronger frame/glow in the lobby and on win. */
export const KIRIN_HIGH_SYMBOLS = ["KIRIN", "QUEEN", "PHOENIX", "SHARK"] as const;

/** Wild substitutes any paying symbol (never the scatter or bonus). */
export const KIRIN_WILD = "WILD" as const;
/** Scatter (pearl) pays anywhere and triggers free spins on 3+. */
export const KIRIN_SCATTER = "SCATTER" as const;
/** Bonus (compass) pays an instant credit prize on 3+ anywhere (the headline feature). */
export const KIRIN_BONUS = "BONUS" as const;

/** Number of fixed paylines evaluated each spin (the "25 LINES" headline). */
export const KIRIN_LINE_COUNT = 25;

/** The four jackpot tiers, top → bottom as shown in the HUD. */
export const KIRIN_JACKPOT_TIERS = ["GRAND", "MAJOR", "MINOR", "MINI"] as const;
export type KirinJackpotTier = (typeof KIRIN_JACKPOT_TIERS)[number];

/**
 * Jackpot values in bps of total bet (10000 = 1× bet). Fixed bet-multiples (not a shared
 * progressive pool — that needs cross-player accrual, out of scope), shown in the HUD and
 * paid exactly when the tier strikes.
 */
export const KIRIN_JACKPOTS: Record<KirinJackpotTier, number> = {
  GRAND: 10_000_000, // 1000×
  MAJOR: 2_000_000, // 200×
  MINOR: 500_000, // 50×
  MINI: 200_000, // 20×
};

/** Grid is column-major: grid[reel][row]. 5 reels × 4 rows. */
export type KirinGrid = KirinSymbol[][];

/** A [reel, row] coordinate on the 5×4 grid. */
export type KirinCell = [number, number];

export interface KirinLineWin {
  line: number; // payline index, 0..24
  symbol: KirinSymbol;
  count: number; // matched reels from the left, 3..5
  payBps: number; // line pay in bps of total bet (pre multiplier)
  cells: KirinCell[]; // the exact winning cells, left to right (length === count)
}

export interface KirinSpinResult {
  grid: KirinGrid;
  lineWins: KirinLineWin[];
  scatterCount: number;
  scatterPayBps: number;
  bonusCount: number; // BONUS symbols on the grid this spin
  bonusPayBps: number; // instant bonus prize for this spin's count (bps of bet; 0 if < 3)
  multiplier: number; // sticky free-spins "Kirin Fire" multiplier applied to this spin (1 in base)
  spinWinBps: number; // line + scatter total for this spin incl. multiplier, pre calibration
}

export interface KirinFreeSpins {
  triggered: true;
  spins: KirinSpinResult[];
  totalSpins: number;
  endMultiplier: number;
  totalBps: number;
}

/**
 * The instant BONUS award. Decided server-side and deterministic from the count of BONUS
 * symbols on the base grid: 3 → 20× (200000 bps), 4 → 100× (1000000 bps), 5 → 500×
 * (5000000 bps). Added verbatim (never RTP-scaled) so the headline prize is exact.
 */
export interface KirinBonus {
  triggered: true;
  bonusCount: number; // BONUS symbols that triggered the award, 3..20
  awardBps: number; // instant prize in bps of total bet (200000 / 1000000 / 5000000)
}

/** A struck jackpot tier and its fixed bet-multiple award (paid verbatim, unscaled). */
export interface KirinJackpotWin {
  tier: KirinJackpotTier;
  awardBps: number; // KIRIN_JACKPOTS[tier]
}

export interface KirinOutcome {
  kind: "flaming-kirin";
  win: boolean;
  base: KirinSpinResult;
  freeSpins: KirinFreeSpins | null;
  bonus: KirinBonus | null;
  jackpot: KirinJackpotWin | null;
  totalWinBps: number; // final win in bps of total bet, AFTER calibration (+ exact bonus + jackpot)
}

/** Narrow an opaque round outcome JSON to the Flaming Kirin payload. */
export function isKirinOutcome(outcome: unknown): outcome is KirinOutcome {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    (outcome as { kind?: unknown }).kind === "flaming-kirin"
  );
}
