import { type SlotFeel } from "@aureus/shared";
import { buildFeel, computeAnticipation } from "../shared/feel";
import {
  BASE_CASCADE_MULTIPLIERS,
  BASE_REEL_WEIGHTS,
  BONUS_AWARD,
  BONUS_TRIGGER,
  FREE_REEL_WEIGHTS,
  FREE_SPINS_AWARD,
  FREE_START_TIDE,
  MAX_CASCADES,
  MAX_FREE_SPINS,
  MAX_WIN_BPS,
  MIN_WAYS_REELS,
  ORB_VALUE_WEIGHTS,
  PAYOUT_SCALAR_BPS,
  PAYTABLE,
  REELS,
  RETRIGGER_SPINS,
  ROWS,
  SCATTER_TRIGGER,
} from "./math";
import { BONUS, MULT_ORB, PAYING_SYMBOLS, SCATTER, WILD, type SymbolId } from "./symbols";

/** A uniform draw in [0, 1). The provider feeds the provable-fairness stream. */
export type Rng = () => number;

/** Grid is column-major: grid[reel][row]. */
export type Grid = SymbolId[][];

/** A [reel, row] coordinate on the 6×5 grid. */
export type Cell = [number, number];

export interface WaysWin {
  symbol: SymbolId;
  reels: number; // consecutive reels matched from the left, 3..6
  ways: number; // product of per-reel match counts
  payBps: number; // total pay for this win in bps of bet (pre cascade/tide multiplier)
  cells: Cell[]; // every contributing cell (for the clear/explode animation)
}

export interface CascadeStep {
  grid: Grid;
  wins: WaysWin[];
  multiplier: number; // cascade/tide multiplier applied to this step (1 on a fresh base spin)
  stepWinBps: number; // sum(wins.payBps) × multiplier
}

export interface SpinResult {
  cascades: CascadeStep[];
  spinWinBps: number; // summed, multiplier-applied win across all steps (pre calibration)
  endMultiplier: number; // highest cascade/tide multiplier reached this spin
  scatterCount: number; // SCATTERs on the INITIAL grid (the trigger count)
  bonusCount: number; // BONUS symbols on the INITIAL grid (the awaken count)
}

export interface FreeSpinsResult {
  triggered: true;
  spins: SpinResult[];
  totalSpins: number;
  startTide: number;
  endTide: number;
  totalBps: number;
}

export interface BonusResult {
  triggered: true;
  krakenCount: number; // BONUS symbols that triggered the award, 3..6
  awardBps: number;
}

export interface LeviathanOutcome extends Record<string, unknown> {
  kind: "leviathan-deep";
  win: boolean;
  base: SpinResult;
  freeSpins: FreeSpinsResult | null;
  bonus: BonusResult | null;
  totalWinBps: number;
  feel: SlotFeel;
}

export interface EngineResult {
  totalWinBps: number;
  outcome: LeviathanOutcome;
}

function weightedSymbol(rng: Rng, weights: Record<SymbolId, number>): SymbolId {
  let total = 0;
  for (const sym of Object.keys(weights) as SymbolId[]) total += weights[sym];
  let r = rng() * total;
  for (const sym of Object.keys(weights) as SymbolId[]) {
    r -= weights[sym];
    if (r < 0) return sym;
  }
  return "PEARL"; // unreachable given positive total; satisfies the type
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

/** Draw one MULT_ORB value from the weighted ladder. Consumes one RNG draw. */
function drawOrbValue(rng: Rng): number {
  let total = 0;
  for (const v of Object.keys(ORB_VALUE_WEIGHTS)) total += ORB_VALUE_WEIGHTS[Number(v)]!;
  let r = rng() * total;
  for (const v of Object.keys(ORB_VALUE_WEIGHTS)) {
    r -= ORB_VALUE_WEIGHTS[Number(v)]!;
    if (r < 0) return Number(v);
  }
  return 2;
}

/**
 * Ways-to-win evaluation for a single grid. For each paying symbol, walk reels left→right from
 * reel 0; a reel matches if it carries that symbol or a WILD. The run extends while every reel
 * matches; `ways` is the product of per-reel match counts, and the symbol pays once at
 * PAYTABLE[symbol][reels] × ways. WILD lands only on interior reels, so reel 0 always anchors the
 * run on a real symbol. Pure: no RNG, no mutation.
 */
export function evaluateWays(grid: Grid): WaysWin[] {
  const wins: WaysWin[] = [];
  for (const sym of PAYING_SYMBOLS) {
    const matchedCells: Cell[] = [];
    let runReels = 0;
    let ways = 1;
    for (let reel = 0; reel < REELS; reel++) {
      const reelCells: Cell[] = [];
      for (let row = 0; row < ROWS; row++) {
        const c = grid[reel]![row]!;
        if (c === sym || c === WILD) reelCells.push([reel, row]);
      }
      if (reelCells.length === 0) break;
      for (const cell of reelCells) matchedCells.push(cell);
      ways *= reelCells.length;
      runReels += 1;
    }
    if (runReels >= MIN_WAYS_REELS) {
      const k = Math.min(runReels, REELS) as 3 | 4 | 5 | 6;
      const per = PAYTABLE[sym][k];
      // matchedCells holds exactly the cells of the matched run (the loop breaks before pushing a
      // non-matching reel), so it is the full contributing-cell set for the clear/explode anim.
      if (per > 0) wins.push({ symbol: sym, reels: runReels, ways, payBps: per * ways, cells: matchedCells });
    }
  }
  return wins;
}

/**
 * Clear the given cells and tumble: in each reel the surviving symbols fall to the bottom and the
 * emptied top cells refill from the reel's weight vector. Column index 0 is the top, ROWS-1 the
 * bottom, so survivors keep their order and settle below the fresh symbols.
 */
function tumble(grid: Grid, cleared: Set<number>, rng: Rng, weights: Record<SymbolId, number>[]): Grid {
  const next: Grid = [];
  for (let reel = 0; reel < REELS; reel++) {
    const survivors: SymbolId[] = [];
    for (let row = 0; row < ROWS; row++) {
      if (!cleared.has(reel * ROWS + row)) survivors.push(grid[reel]![row]!);
    }
    const refill: SymbolId[] = [];
    for (let i = survivors.length; i < ROWS; i++) refill.push(weightedSymbol(rng, weights[reel]!));
    next.push([...refill, ...survivors]);
  }
  return next;
}

/**
 * Run one base spin: an initial drop plus every tumble until a step has no win. The cascade ladder
 * (BASE_CASCADE_MULTIPLIERS) multiplies each successive step. The final (no-win) settled grid is
 * recorded as the terminal step so the client can render it.
 */
function runBaseSpin(rng: Rng): SpinResult {
  const cascades: CascadeStep[] = [];
  let grid = drawGrid(rng, BASE_REEL_WEIGHTS);
  const scatterCount = countSymbol(grid, SCATTER);
  const bonusCount = countSymbol(grid, BONUS);
  let spinWinBps = 0;
  let endMultiplier = 1;
  let depth = 0;

  for (;;) {
    const wins = evaluateWays(grid);
    const multiplier =
      BASE_CASCADE_MULTIPLIERS[Math.min(depth, BASE_CASCADE_MULTIPLIERS.length - 1)]!;
    const stepPay = wins.reduce((sum, w) => sum + w.payBps, 0);
    const stepWinBps = stepPay * multiplier;
    cascades.push({ grid, wins, multiplier, stepWinBps });
    spinWinBps += stepWinBps;
    if (wins.length > 0) endMultiplier = multiplier;
    if (wins.length === 0 || depth >= MAX_CASCADES) break;

    const cleared = new Set<number>();
    for (const w of wins) for (const [reel, row] of w.cells) cleared.add(reel * ROWS + row);
    grid = tumble(grid, cleared, rng, BASE_REEL_WEIGHTS);
    depth += 1;
  }

  return { cascades, spinWinBps, endMultiplier, scatterCount, bonusCount };
}

/**
 * Run one free spin under the persistent tide. On every cascade step the MULT_ORBs on the grid are
 * collected first — each adds its value to `tide` — then the step is paid at × tide. Collected orbs
 * clear alongside the winning cells and tumble away; fresh orbs can drop on the refill. Returns the
 * spin and the tide it left behind (which the feature carries into the next spin).
 */
function runFreeSpin(rng: Rng, tideStart: number): { result: SpinResult; tideEnd: number } {
  const cascades: CascadeStep[] = [];
  let grid = drawGrid(rng, FREE_REEL_WEIGHTS);
  const scatterCount = countSymbol(grid, SCATTER);
  let tide = tideStart;
  let spinWinBps = 0;
  let depth = 0;

  for (;;) {
    const orbCells: Cell[] = [];
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        if (grid[reel]![row] === MULT_ORB) {
          orbCells.push([reel, row]);
          tide += drawOrbValue(rng);
        }
      }
    }
    const wins = evaluateWays(grid);
    const stepPay = wins.reduce((sum, w) => sum + w.payBps, 0);
    const stepWinBps = stepPay * tide;
    cascades.push({ grid, wins, multiplier: tide, stepWinBps });
    spinWinBps += stepWinBps;
    if (wins.length === 0 || depth >= MAX_CASCADES) break;

    const cleared = new Set<number>();
    for (const w of wins) for (const [reel, row] of w.cells) cleared.add(reel * ROWS + row);
    for (const [reel, row] of orbCells) cleared.add(reel * ROWS + row);
    grid = tumble(grid, cleared, rng, FREE_REEL_WEIGHTS);
    depth += 1;
  }

  return {
    result: { cascades, spinWinBps, endMultiplier: tide, scatterCount, bonusCount: 0 },
    tideEnd: tide,
  };
}

/**
 * Run the free-spins feature: a sequence of tumbling spins under a tide that only ever rises (fed
 * by MULT_ORB). A retrigger (4+ scatters on a spin's initial drop) adds spins up to the hard cap.
 */
function runFreeSpins(rng: Rng, triggerScatters: number): FreeSpinsResult {
  let remaining =
    FREE_SPINS_AWARD[Math.min(triggerScatters, 6)] ?? FREE_SPINS_AWARD[SCATTER_TRIGGER]!;
  let totalSpins = remaining;
  let tide = FREE_START_TIDE;
  const startTide = tide;
  let totalBps = 0;
  const spins: SpinResult[] = [];

  while (remaining > 0) {
    remaining -= 1;
    const { result, tideEnd } = runFreeSpin(rng, tide);
    tide = tideEnd;
    spins.push(result);
    totalBps += result.spinWinBps;

    if (result.scatterCount >= SCATTER_TRIGGER && totalSpins < MAX_FREE_SPINS) {
      const added = Math.min(RETRIGGER_SPINS, MAX_FREE_SPINS - totalSpins);
      remaining += added;
      totalSpins += added;
    }
  }

  return { triggered: true, spins, totalSpins, startTide, endTide: tide, totalBps };
}

/**
 * Run one full Leviathan's Deep round on a provable-fairness RNG. Pure: identical RNG ⇒ identical
 * outcome. Returns the win in bps of total bet (the provider turns it into integer minor units)
 * plus the full render payload.
 *
 * Calibration model: the base ways + free-spins slice is scaled by PAYOUT_SCALAR_BPS; the Kraken
 * Awakens prize is added VERBATIM (never scaled) so its reveal is exact. The MAX_WIN_BPS cap binds
 * last.
 */
export function spin(rng: Rng): EngineResult {
  const base = runBaseSpin(rng);
  const initialGrid = base.cascades[0]!.grid;

  const freeSpins: FreeSpinsResult | null =
    base.scatterCount >= SCATTER_TRIGGER ? runFreeSpins(rng, base.scatterCount) : null;

  const bonus: BonusResult | null =
    base.bonusCount >= BONUS_TRIGGER
      ? {
          triggered: true,
          krakenCount: base.bonusCount,
          awardBps: BONUS_AWARD[Math.min(base.bonusCount, 6)] ?? BONUS_AWARD[BONUS_TRIGGER]!,
        }
      : null;

  const rawScaledBps = base.spinWinBps + (freeSpins?.totalBps ?? 0);
  const scaled = Math.floor((rawScaledBps * PAYOUT_SCALAR_BPS) / 10_000);
  const totalWinBps = Math.min(MAX_WIN_BPS, scaled + (bonus?.awardBps ?? 0));

  // Presentation-only suspense/celebration hints, derived from the BASE grid the player watches
  // reel-by-reel (free spins auto-play). SCATTER → free spins, BONUS → Kraken; both tease on the
  // "one-to-go" reel. Never affects totalWinBps.
  const feel = buildFeel({
    totalWinBps,
    jackpot: false,
    anticipation: [
      computeAnticipation(initialGrid, SCATTER, SCATTER_TRIGGER),
      computeAnticipation(initialGrid, BONUS, BONUS_TRIGGER),
    ],
  });

  return {
    totalWinBps,
    outcome: {
      kind: "leviathan-deep",
      win: totalWinBps > 0,
      base,
      freeSpins,
      bonus,
      totalWinBps,
      feel,
    },
  };
}
