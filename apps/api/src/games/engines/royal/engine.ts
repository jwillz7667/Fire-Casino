import {
  BASE_REEL_WEIGHTS,
  FREE_REEL_WEIGHTS,
  FREE_SPINS_AWARD,
  MAX_FREE_SPINS,
  MAX_FS_MULTIPLIER,
  PAYOUT_SCALAR_BPS,
  PAYTABLE,
  REELS,
  RETRIGGER_SPINS,
  ROWS,
  SCATTER_PAY,
  SCATTER_TRIGGER,
} from "./math";
import { PAYING_SYMBOLS, SCATTER, WILD, type SymbolId } from "./symbols";

/** A uniform draw in [0, 1). The provider feeds the provable-fairness stream. */
export type Rng = () => number;

/** Grid is column-major: grid[reel][row]. */
export type Grid = SymbolId[][];

export interface WaysWin {
  symbol: SymbolId;
  count: number; // matched reels (left-aligned), 3..5
  ways: number; // product of per-reel symbol counts (incl. wilds) across matched reels
  payBps: number; // contribution to this spin in bps of total bet (pre multiplier)
}

export interface SpinResult {
  grid: Grid;
  waysWins: WaysWin[];
  scatterCount: number;
  scatterPayBps: number;
  multiplier: number; // sticky free-spins multiplier applied to this spin (1 in base)
  spinWinBps: number; // total for this spin incl. multiplier, pre global scalar
}

export interface FreeSpinsResult {
  triggered: true;
  spins: SpinResult[];
  totalSpins: number;
  endMultiplier: number;
  totalBps: number; // sum of free-spin wins, pre global scalar
}

export interface RoyalOutcome extends Record<string, unknown> {
  kind: "royal-ascendant";
  win: boolean;
  base: SpinResult;
  freeSpins: FreeSpinsResult | null;
  totalWinBps: number; // final win in bps of total bet, AFTER global calibration
}

export interface EngineResult {
  totalWinBps: number;
  outcome: RoyalOutcome;
}

function weightedSymbol(rng: Rng, weights: Record<SymbolId, number>): SymbolId {
  let total = 0;
  for (const sym of Object.keys(weights) as SymbolId[]) total += weights[sym];
  let r = rng() * total;
  for (const sym of Object.keys(weights) as SymbolId[]) {
    r -= weights[sym];
    if (r < 0) return sym;
  }
  return "TEN"; // unreachable given positive total; satisfies the type
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

function countOnReel(column: SymbolId[], sym: SymbolId): number {
  let n = 0;
  for (const cell of column) if (cell === sym) n++;
  return n;
}

/** Per-reel match count for a paying symbol, counting the WILD as a substitute. */
function countWithWild(column: SymbolId[], sym: SymbolId): number {
  let n = 0;
  for (const cell of column) if (cell === sym || cell === WILD) n++;
  return n;
}

function countSymbol(grid: Grid, sym: SymbolId): number {
  let n = 0;
  for (const column of grid) n += countOnReel(column, sym);
  return n;
}

/**
 * Left-aligned 243-ways wins with wild substitution: each paying symbol pays its
 * longest run from reel 1, once. A JOKER on any interior reel substitutes, so it
 * both completes and widens (more ways) a run; reels 1 and 5 hold no wilds, so a
 * run must start and (for 5-of-a-kind) end on a real symbol.
 */
function waysWins(grid: Grid): WaysWin[] {
  const wins: WaysWin[] = [];
  for (const sym of PAYING_SYMBOLS) {
    let run = 0;
    let ways = 1;
    for (let reel = 0; reel < REELS; reel++) {
      const c = countWithWild(grid[reel]!, sym);
      if (c === 0) break;
      run += 1;
      ways *= c;
    }
    if (run >= 3) {
      const k = Math.min(run, 5) as 3 | 4 | 5;
      const payBps = PAYTABLE[sym][k] * ways;
      wins.push({ symbol: sym, count: run, ways, payBps });
    }
  }
  return wins;
}

/** Evaluate one spin: ways wins (wild-substituted) + scatter pay, times multiplier. */
export function evaluateSpin(grid: Grid, multiplier: number): SpinResult {
  const wins = waysWins(grid);
  const waysBps = wins.reduce((sum, w) => sum + w.payBps, 0);
  const scatterCount = countSymbol(grid, SCATTER);
  const scatterPayBps = SCATTER_PAY[scatterCount] ?? 0;
  const rawBps = waysBps + scatterPayBps;
  return {
    grid,
    waysWins: wins,
    scatterCount,
    scatterPayBps,
    multiplier,
    spinWinBps: rawBps * multiplier,
  };
}

function runFreeSpins(rng: Rng, triggerScatters: number): FreeSpinsResult {
  let remaining = FREE_SPINS_AWARD[triggerScatters] ?? FREE_SPINS_AWARD[SCATTER_TRIGGER]!;
  let totalSpins = remaining;
  let totalBps = 0;
  let spinIndex = 0;
  const spins: SpinResult[] = [];

  while (remaining > 0) {
    remaining -= 1;
    spinIndex += 1;
    const grid = drawGrid(rng, FREE_REEL_WEIGHTS);
    // Deterministic rising multiplier — the feature's signature. Consumes no RNG,
    // so the draw order stays a pure function of (reel, row).
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
 * Run one full Royal Ascendant round on a provable-fairness RNG. Pure: identical
 * RNG ⇒ identical outcome. Returns the win in bps of total bet (the provider turns
 * it into integer minor units) plus the full render payload.
 */
export function spin(rng: Rng): EngineResult {
  const baseGrid = drawGrid(rng, BASE_REEL_WEIGHTS);
  const base = evaluateSpin(baseGrid, 1);

  let freeSpins: FreeSpinsResult | null = null;
  if (base.scatterCount >= SCATTER_TRIGGER) {
    freeSpins = runFreeSpins(rng, base.scatterCount);
  }

  const rawBps = base.spinWinBps + (freeSpins?.totalBps ?? 0);
  const totalWinBps = Math.floor((rawBps * PAYOUT_SCALAR_BPS) / 10_000);

  return {
    totalWinBps,
    outcome: {
      kind: "royal-ascendant",
      win: totalWinBps > 0,
      base,
      freeSpins,
      totalWinBps,
    },
  };
}
