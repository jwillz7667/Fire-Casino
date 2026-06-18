import {
  BASE_REEL_WEIGHTS,
  BONUS_AWARD,
  BONUS_TRIGGER,
  FREE_REEL_WEIGHTS,
  FREE_SPINS_AWARD,
  MAX_FREE_SPINS,
  MAX_FS_MULTIPLIER,
  MAX_WIN_BPS,
  PAYLINES,
  PAYOUT_SCALAR_BPS,
  PAYTABLE,
  REELS,
  RETRIGGER_SPINS,
  ROWS,
  SCATTER_PAY,
  SCATTER_TRIGGER,
} from "./math";
import { BONUS, isPaying, SCATTER, WILD, type SymbolId } from "./symbols";

/** A uniform draw in [0, 1). The provider feeds the provable-fairness stream. */
export type Rng = () => number;

/** Grid is column-major: grid[reel][row]. */
export type Grid = SymbolId[][];

/** A [reel, row] coordinate on the 5×3 grid. */
export type Cell = [number, number];

export interface LineWin {
  line: number; // payline index, 0..24
  symbol: SymbolId;
  count: number; // matched reels (left-aligned), 3..5
  payBps: number; // line pay in bps of total bet (pre multiplier)
  cells: Cell[]; // the exact winning cells, left to right (length === count)
}

export interface SpinResult {
  grid: Grid;
  lineWins: LineWin[];
  scatterCount: number;
  scatterPayBps: number;
  bonusCount: number; // BONUS symbols on the grid this spin
  bonusPayBps: number; // instant bonus prize for this spin's count (bps of bet; 0 if < 3)
  multiplier: number; // sticky free-spins multiplier applied to this spin (1 in base)
  spinWinBps: number; // line + scatter total for this spin incl. multiplier, pre scalar
}

export interface FreeSpinsResult {
  triggered: true;
  spins: SpinResult[];
  totalSpins: number;
  endMultiplier: number;
  totalBps: number; // sum of free-spin line+scatter wins, pre global scalar
}

export interface BonusResult {
  triggered: true;
  bonusCount: number; // BONUS symbols that triggered the award, 3..15
  awardBps: number; // instant prize in bps of total bet (unscaled headline prize)
}

export interface CosmicOutcome extends Record<string, unknown> {
  kind: "cosmic-slots";
  win: boolean;
  base: SpinResult;
  freeSpins: FreeSpinsResult | null;
  bonus: BonusResult | null;
  totalWinBps: number; // final win in bps of total bet, AFTER calibration (+ exact bonus)
}

export interface EngineResult {
  totalWinBps: number;
  outcome: CosmicOutcome;
}

function weightedSymbol(rng: Rng, weights: Record<SymbolId, number>): SymbolId {
  let total = 0;
  for (const sym of Object.keys(weights) as SymbolId[]) total += weights[sym];
  let r = rng() * total;
  for (const sym of Object.keys(weights) as SymbolId[]) {
    r -= weights[sym];
    if (r < 0) return sym;
  }
  return "NINE"; // unreachable given positive total; satisfies the type
}

function drawGrid(rng: Rng, reelWeights: Record<SymbolId, number>[]): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REELS; reel++) {
    const column: SymbolId[] = [];
    for (let row = 0; row < ROWS; row++) column.push(weightedSymbol(rng, reelWeights[reel]!));
    grid.push(column);
  }
  return grid;
}

function countSymbol(grid: Grid, sym: SymbolId): number {
  let n = 0;
  for (const column of grid) for (const cell of column) if (cell === sym) n++;
  return n;
}

/**
 * Left-aligned payline wins with wild substitution. The WILD only lands on interior
 * reels, so reel 1 is always a real symbol and fixes the line's paying symbol; a WILD
 * on any later reel substitutes to extend the run. Each line pays its single
 * left-aligned k-of-a-kind once, and only if the paytable entry is non-zero.
 */
function lineWins(grid: Grid): LineWin[] {
  const wins: LineWin[] = [];
  for (let line = 0; line < PAYLINES.length; line++) {
    const rows = PAYLINES[line]!;
    const target = grid[0]![rows[0]]!;
    if (!isPaying(target)) continue; // scatter/bonus-led (or otherwise non-paying) line

    let run = 0;
    const cells: Cell[] = [];
    for (let reel = 0; reel < REELS; reel++) {
      const cell = grid[reel]![rows[reel]!]!;
      if (cell === target || cell === WILD) {
        run += 1;
        cells.push([reel, rows[reel]!]);
      } else {
        break;
      }
    }
    if (run >= 3) {
      const k = Math.min(run, 5) as 3 | 4 | 5;
      const pay = PAYTABLE[target][k];
      // Filler royals could be configured to pay 0 at 3 — don't push a phantom win line.
      if (pay > 0) wins.push({ line, symbol: target, count: run, payBps: pay, cells });
    }
  }
  return wins;
}

/**
 * Evaluate one spin: payline wins (wild-substituted) + scatter pay (× multiplier), plus
 * the BONUS count and its FIXED instant prize. The bonus prize is reported but NOT folded
 * into `spinWinBps` (which carries only the RTP-scaled line+scatter slice); the round
 * adds the unscaled bonus on top.
 */
export function evaluateSpin(grid: Grid, multiplier: number): SpinResult {
  const wins = lineWins(grid);
  const linesBps = wins.reduce((sum, w) => sum + w.payBps, 0);

  const scatterCount = countSymbol(grid, SCATTER);
  // Clamp to the top defined tier: 6+ scatters (rare, but reachable on a 15-cell grid)
  // must pay at least the 5-scatter prize, never fall through to 0.
  const scatterPayBps = SCATTER_PAY[Math.min(scatterCount, 5)] ?? 0;

  const bonusCount = countSymbol(grid, BONUS);
  const bonusPayBps =
    bonusCount >= BONUS_TRIGGER ? (BONUS_AWARD[Math.min(bonusCount, 5)] ?? 0) : 0;

  const rawBps = linesBps + scatterPayBps;
  return {
    grid,
    lineWins: wins,
    scatterCount,
    scatterPayBps,
    bonusCount,
    bonusPayBps,
    multiplier,
    spinWinBps: rawBps * multiplier,
  };
}

function runFreeSpins(rng: Rng, triggerScatters: number): FreeSpinsResult {
  // Clamp to the top defined tier so 6+ scatters award at least the 5-scatter spins.
  let remaining =
    FREE_SPINS_AWARD[Math.min(triggerScatters, 5)] ?? FREE_SPINS_AWARD[SCATTER_TRIGGER]!;
  let totalSpins = remaining;
  let totalBps = 0;
  let spinIndex = 0;
  const spins: SpinResult[] = [];

  while (remaining > 0) {
    remaining -= 1;
    spinIndex += 1;
    const grid = drawGrid(rng, FREE_REEL_WEIGHTS);
    // Deterministic +1-per-spin multiplier (1,2,3,…) capped. Consumes no RNG, so the
    // draw order stays a pure function of (reel, row).
    const multiplier = Math.min(spinIndex, MAX_FS_MULTIPLIER);
    const result = evaluateSpin(grid, multiplier);
    spins.push(result);
    totalBps += result.spinWinBps;

    if (result.scatterCount >= SCATTER_TRIGGER && totalSpins < MAX_FREE_SPINS) {
      const added = Math.min(RETRIGGER_SPINS, MAX_FREE_SPINS - totalSpins);
      remaining += added;
      totalSpins += added;
    }
  }

  return {
    triggered: true,
    spins,
    totalSpins,
    endMultiplier: Math.min(totalSpins, MAX_FS_MULTIPLIER),
    totalBps,
  };
}

/**
 * Run one full Cosmic Spins round on a provable-fairness RNG. Pure: identical RNG ⇒
 * identical outcome. Returns the win in bps of total bet (the provider turns it into
 * integer minor units) plus the full render payload.
 *
 * Calibration model: the line + scatter + free-spin slice is scaled by PAYOUT_SCALAR_BPS;
 * the BONUS prize is added VERBATIM (never scaled) so the headline 20×/100×/500× reveal is
 * always exact. The 5000× cap binds last.
 */
export function spin(rng: Rng): EngineResult {
  const baseGrid = drawGrid(rng, BASE_REEL_WEIGHTS);
  const base = evaluateSpin(baseGrid, 1);

  let freeSpins: FreeSpinsResult | null = null;
  if (base.scatterCount >= SCATTER_TRIGGER) {
    freeSpins = runFreeSpins(rng, base.scatterCount);
  }

  const bonus: BonusResult | null =
    base.bonusCount >= BONUS_TRIGGER
      ? { triggered: true, bonusCount: base.bonusCount, awardBps: base.bonusPayBps }
      : null;

  const rawScaledBps = base.spinWinBps + (freeSpins?.totalBps ?? 0);
  const scaled = Math.floor((rawScaledBps * PAYOUT_SCALAR_BPS) / 10_000);
  // The instant bonus prize rides on top of the scaled slice, unscaled.
  const totalWinBps = Math.min(MAX_WIN_BPS, scaled + (bonus?.awardBps ?? 0));

  return {
    totalWinBps,
    outcome: {
      kind: "cosmic-slots",
      win: totalWinBps > 0,
      base,
      freeSpins,
      bonus,
      totalWinBps,
    },
  };
}
