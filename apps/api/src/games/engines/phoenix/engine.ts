import { type SlotFeel } from "@aureus/shared";
import { buildFeel, computeAnticipation } from "../shared/feel";
import {
  BASE_WEIGHTS,
  FREE_SPINS_AWARD,
  FREE_SPIN_WEIGHTS,
  MAX_FREE_SPINS,
  MAX_ORB_MULTIPLIER,
  MAX_WIN_BPS,
  ORB_VALUE_WEIGHTS,
  PAYOUT_SCALAR_BPS,
  PAYTABLE,
  REELS,
  RETRIGGER_SPINS,
  ROWS,
  SCATTER_PAY,
  SCATTER_TRIGGER,
} from "./math";
import { PAYING_SYMBOLS, SCATTER, type SymbolId } from "./symbols";

/** A uniform draw in [0, 1). The provider feeds the provable-fairness stream. */
export type Rng = () => number;

/** Grid is column-major: grid[reel][row]. */
export type Grid = SymbolId[][];

export interface WaysWin {
  symbol: SymbolId;
  count: number; // matched reels (left-aligned), 3..5
  ways: number; // product of per-reel symbol counts across matched reels
  payBps: number; // contribution to this spin in bps of total bet (pre multiplier)
}

export interface SpinResult {
  grid: Grid;
  waysWins: WaysWin[];
  scatterCount: number;
  scatterPayBps: number;
  orbValues: number[]; // orb multiplier values landed this spin (free spins only)
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

export interface PhoenixOutcome extends Record<string, unknown> {
  kind: "phoenix-ascendant";
  demo: true;
  win: boolean;
  base: SpinResult;
  freeSpins: FreeSpinsResult | null;
  totalWinBps: number; // final win in bps of total bet, AFTER global calibration
  feel: SlotFeel;
}

export interface EngineResult {
  totalWinBps: number;
  outcome: PhoenixOutcome;
}

function weightedSymbol(rng: Rng, weights: Record<SymbolId, number>): SymbolId {
  let total = 0;
  for (const sym of Object.keys(weights) as SymbolId[]) total += weights[sym];
  let r = rng() * total;
  for (const sym of Object.keys(weights) as SymbolId[]) {
    r -= weights[sym];
    if (r < 0) return sym;
  }
  return "VIOLET"; // unreachable given positive total; satisfies the type
}

function drawGrid(rng: Rng, weights: Record<SymbolId, number>): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REELS; reel++) {
    const column: SymbolId[] = [];
    for (let row = 0; row < ROWS; row++) column.push(weightedSymbol(rng, weights));
    grid.push(column);
  }
  return grid;
}

function countOnReel(column: SymbolId[], sym: SymbolId): number {
  let n = 0;
  for (const cell of column) if (cell === sym) n++;
  return n;
}

function countSymbol(grid: Grid, sym: SymbolId): number {
  let n = 0;
  for (const column of grid) n += countOnReel(column, sym);
  return n;
}

/** Left-aligned 243-ways wins: each symbol pays its longest run from reel 1, once. */
function waysWins(grid: Grid): WaysWin[] {
  const wins: WaysWin[] = [];
  for (const sym of PAYING_SYMBOLS) {
    let run = 0;
    let ways = 1;
    for (let reel = 0; reel < REELS; reel++) {
      const c = countOnReel(grid[reel]!, sym);
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

function pickOrbValue(rng: Rng): number {
  let total = 0;
  for (const o of ORB_VALUE_WEIGHTS) total += o.weight;
  let r = rng() * total;
  for (const o of ORB_VALUE_WEIGHTS) {
    r -= o.weight;
    if (r < 0) return o.value;
  }
  return ORB_VALUE_WEIGHTS[0]!.value;
}

/** Evaluate one spin's raw wins (pre sticky multiplier) and collect orbs. */
export function evaluateSpin(grid: Grid, multiplier: number): SpinResult {
  const wins = waysWins(grid);
  const waysBps = wins.reduce((sum, w) => sum + w.payBps, 0);
  const scatterCount = countSymbol(grid, "SCATTER");
  const scatterPayBps = SCATTER_PAY[scatterCount] ?? 0;
  const rawBps = waysBps + scatterPayBps;
  const orbCount = countSymbol(grid, "ORB");
  return {
    grid,
    waysWins: wins,
    scatterCount,
    scatterPayBps,
    orbValues: new Array<number>(orbCount).fill(0), // values filled by caller's rng order
    multiplier,
    spinWinBps: rawBps * multiplier,
  };
}

function runFreeSpins(rng: Rng, triggerScatters: number): FreeSpinsResult {
  let remaining = FREE_SPINS_AWARD[triggerScatters] ?? FREE_SPINS_AWARD[SCATTER_TRIGGER]!;
  let totalSpins = remaining;
  let multiplier = 1; // applied = 1 + collected orb values, capped
  let collected = 0;
  let totalBps = 0;
  const spins: SpinResult[] = [];

  while (remaining > 0) {
    remaining -= 1;
    const grid = drawGrid(rng, FREE_SPIN_WEIGHTS);

    // Collect orbs first so this spin's win already rides the boosted multiplier.
    const orbCount = countSymbol(grid, "ORB");
    const orbValues: number[] = [];
    for (let i = 0; i < orbCount; i++) {
      const v = pickOrbValue(rng);
      orbValues.push(v);
      collected += v;
    }
    multiplier = Math.min(1 + collected, MAX_ORB_MULTIPLIER);

    const result = evaluateSpin(grid, multiplier);
    result.orbValues = orbValues;
    spins.push(result);
    totalBps += result.spinWinBps;

    if (result.scatterCount >= SCATTER_TRIGGER && totalSpins < MAX_FREE_SPINS) {
      const added = Math.min(RETRIGGER_SPINS, MAX_FREE_SPINS - totalSpins);
      remaining += added;
      totalSpins += added;
    }
  }

  return { triggered: true, spins, totalSpins, endMultiplier: multiplier, totalBps };
}

/**
 * Run one full Phoenix Ascendant round on a provable-fairness RNG. Pure: identical
 * RNG ⇒ identical outcome. Returns the win in bps of total bet (the provider turns
 * it into integer minor units) plus the full render payload.
 */
export function spin(rng: Rng): EngineResult {
  const baseGrid = drawGrid(rng, BASE_WEIGHTS);
  const base = evaluateSpin(baseGrid, 1);

  let freeSpins: FreeSpinsResult | null = null;
  if (base.scatterCount >= SCATTER_TRIGGER) {
    freeSpins = runFreeSpins(rng, base.scatterCount);
  }

  const rawBps = base.spinWinBps + (freeSpins?.totalBps ?? 0);
  const scaledBps = Math.floor((rawBps * PAYOUT_SCALAR_BPS) / 10_000);
  // Safety clamp on the extreme sticky-ORB tail: a round can never pay past the certified max win.
  const totalWinBps = Math.min(scaledBps, MAX_WIN_BPS);

  // Presentation-only suspense/celebration hints, derived from the BASE grid the player watches
  // reel-by-reel (free spins auto-play). The SCATTER triggers free spins on 3+ and teases on the
  // "one-to-go" reel; the ORB is a free-spins collectible, not a base trigger. Never affects
  // totalWinBps.
  const feel = buildFeel({
    totalWinBps,
    anticipation: [computeAnticipation(baseGrid, SCATTER, SCATTER_TRIGGER)],
  });

  return {
    totalWinBps,
    outcome: {
      kind: "phoenix-ascendant",
      demo: true,
      win: totalWinBps > 0,
      base,
      freeSpins,
      totalWinBps,
      feel,
    },
  };
}
