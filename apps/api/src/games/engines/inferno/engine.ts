import {
  type InfernoFire,
  type InfernoHoldSpin,
  type InfernoLineWin,
  type InfernoOutcome,
  INFERNO_RESPINS,
  INFERNO_TRIGGER,
} from "@aureus/shared";
import {
  BASE_REEL_WEIGHTS,
  FIRE_VALUE_WEIGHTS,
  GRAND_BPS,
  MAX_WIN_BPS,
  PAYLINES,
  PAYOUT_SCALAR_BPS,
  PAYTABLE,
  REELS,
  RESPIN_FIREBALL_PROB,
  ROWS,
} from "./math";
import { FIREBALL, isPaying, WILD, type SymbolId } from "./symbols";

/** A uniform draw in [0, 1). The provider feeds the provable-fairness stream. */
export type Rng = () => number;

/** Grid is column-major: grid[reel][row]. */
export type Grid = SymbolId[][];

/** The shared public contract plus the index signature RoundResult.outcome requires. */
export interface EngineOutcome extends InfernoOutcome, Record<string, unknown> {}

export interface EngineResult {
  totalWinBps: number;
  outcome: EngineOutcome;
}

function weightedSymbol(rng: Rng, weights: Record<SymbolId, number>): SymbolId {
  let total = 0;
  for (const sym of Object.keys(weights) as SymbolId[]) total += weights[sym];
  let r = rng() * total;
  for (const sym of Object.keys(weights) as SymbolId[]) {
    r -= weights[sym];
    if (r < 0) return sym;
  }
  return "GREEN"; // unreachable given positive total; satisfies the type
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

/** Left-aligned payline wins with wild substitution. Reel 1 fixes the paying symbol. */
function lineWins(grid: Grid): InfernoLineWin[] {
  const wins: InfernoLineWin[] = [];
  for (let line = 0; line < PAYLINES.length; line++) {
    const rows = PAYLINES[line]!;
    const target = grid[0]![rows[0]]!;
    if (!isPaying(target)) continue;

    let run = 0;
    for (let reel = 0; reel < REELS; reel++) {
      const cell = grid[reel]![rows[reel]!]!;
      if (cell === target || cell === WILD) run += 1;
      else break;
    }
    if (run >= 3) {
      const k = Math.min(run, 5) as 3 | 4 | 5;
      const pay = PAYTABLE[target][k];
      if (pay > 0) wins.push({ line, symbol: target, count: run, payBps: pay });
    }
  }
  return wins;
}

function drawFireValue(rng: Rng): { valueBps: number; tier: InfernoFire["tier"] } {
  let total = 0;
  for (const v of FIRE_VALUE_WEIGHTS) total += v.weight;
  let r = rng() * total;
  for (const v of FIRE_VALUE_WEIGHTS) {
    r -= v.weight;
    if (r < 0) return { valueBps: v.valueBps, tier: v.tier };
  }
  const last = FIRE_VALUE_WEIGHTS[FIRE_VALUE_WEIGHTS.length - 1]!;
  return { valueBps: last.valueBps, tier: last.tier };
}

/**
 * Run the lock-and-respin feature. The trigger fireballs lock first (each drawing a value),
 * then empty cells respin: each empty cell lands a fireball with RESPIN_FIREBALL_PROB and,
 * if it does, locks with a drawn value and re-grants the respins. Ends at 0 respins or a
 * full 20-cell board (GRAND). Deterministic in `rng`: draws happen in a fixed order
 * (initial values reel-major, then per round reel-major) so the same seed replays exactly.
 */
function runHoldSpin(rng: Rng, grid: Grid): InfernoHoldSpin {
  const locked = new Set<number>(); // cell index = reel * ROWS + row
  const fires = new Map<number, InfernoFire>();
  const initial: InfernoFire[] = [];

  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[reel]![row] !== FIREBALL) continue;
      const idx = reel * ROWS + row;
      const v = drawFireValue(rng);
      const fire: InfernoFire = { reel, row, valueBps: v.valueBps, tier: v.tier };
      locked.add(idx);
      fires.set(idx, fire);
      initial.push(fire);
    }
  }

  const rounds: { newLocks: InfernoFire[] }[] = [];
  let respins = INFERNO_RESPINS;
  const totalCells = REELS * ROWS;

  while (respins > 0 && locked.size < totalCells) {
    respins -= 1;
    const newLocks: InfernoFire[] = [];
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        const idx = reel * ROWS + row;
        if (locked.has(idx)) continue;
        if (rng() < RESPIN_FIREBALL_PROB) {
          const v = drawFireValue(rng);
          const fire: InfernoFire = { reel, row, valueBps: v.valueBps, tier: v.tier };
          locked.add(idx);
          fires.set(idx, fire);
          newLocks.push(fire);
        }
      }
    }
    rounds.push({ newLocks });
    if (newLocks.length > 0) respins = INFERNO_RESPINS; // a new lock re-grants respins
  }

  const lockedList = [...fires.values()];
  const filledAll = locked.size === totalCells;
  let bonusBps = lockedList.reduce((sum, f) => sum + f.valueBps, 0);
  if (filledAll) bonusBps += GRAND_BPS;

  return { triggered: true, initial, rounds, locked: lockedList, filledAll, bonusBps };
}

function countFireballs(grid: Grid): number {
  let n = 0;
  for (const column of grid) for (const cell of column) if (cell === FIREBALL) n++;
  return n;
}

/**
 * Run one full Inferno Link round on a provable-fairness RNG. Pure: identical RNG ⇒
 * identical outcome. Base line wins are RTP-scaled; the hold-and-spin feature (fireball
 * values + GRAND) is added VERBATIM so every reveal is exact. The 5000× cap binds last.
 */
export function spin(rng: Rng): EngineResult {
  const grid = drawGrid(rng, BASE_REEL_WEIGHTS);
  const lineWinsList = lineWins(grid);
  const linesBps = lineWinsList.reduce((sum, w) => sum + w.payBps, 0);
  const baseFireballCount = countFireballs(grid);

  let holdSpin: InfernoHoldSpin | null = null;
  if (baseFireballCount >= INFERNO_TRIGGER) {
    holdSpin = runHoldSpin(rng, grid);
  }

  const scaledLines = Math.floor((linesBps * PAYOUT_SCALAR_BPS) / 10_000);
  const totalWinBps = Math.min(MAX_WIN_BPS, scaledLines + (holdSpin?.bonusBps ?? 0));

  return {
    totalWinBps,
    outcome: {
      kind: "inferno-link",
      win: totalWinBps > 0,
      grid,
      lineWins: lineWinsList,
      baseFireballCount,
      holdSpin,
      totalWinBps,
    },
  };
}
