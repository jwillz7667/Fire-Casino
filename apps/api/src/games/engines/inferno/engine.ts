import {
  type InfernoFire,
  type InfernoHoldSpin,
  type InfernoLineWin,
  type InfernoOutcome,
  type SlotFeel,
  INFERNO_BONUS_ROWS,
  INFERNO_REELS,
  INFERNO_RESPINS,
  INFERNO_TRIGGER,
} from "@aureus/shared";
import { buildFeel, computeAnticipation } from "../shared/feel";
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
 * Run the lock-and-respin feature on the TALLER bonus board (5×6 = 30 spots). The trigger
 * fireballs lock first at their base (reel,row) in the top 4 rows; the board reveals two
 * extra rows below. Then empty spots respin: each lands a fireball with RESPIN_FIREBALL_PROB
 * and, if it does, locks with a drawn value and RE-GRANTS the 3 respins. Ends at 0 respins
 * (i.e. 3 consecutive spins with no new ball) or a full 30-spot board (GRAND). Deterministic
 * in `rng`: draws happen in a fixed order (initial values reel-major, then per round
 * reel-major over the 30 cells) so the same seed replays exactly.
 */
function runHoldSpin(rng: Rng, baseFires: InfernoFire[]): InfernoHoldSpin {
  const cols = INFERNO_REELS;
  const rows = INFERNO_BONUS_ROWS;
  const locked = new Set<number>(); // cell index = reel * BONUS_ROWS + row
  const fires = new Map<number, InfernoFire>();
  const initial: InfernoFire[] = [];

  // The base-grid credit balls (already drawn, with values) become the initial locks.
  for (const fire of baseFires) {
    const idx = fire.reel * rows + fire.row;
    locked.add(idx);
    fires.set(idx, fire);
    initial.push(fire);
  }

  const rounds: { newLocks: InfernoFire[] }[] = [];
  let respins = INFERNO_RESPINS;
  const totalCells = cols * rows;

  while (respins > 0 && locked.size < totalCells) {
    respins -= 1;
    const newLocks: InfernoFire[] = [];
    for (let reel = 0; reel < cols; reel++) {
      for (let row = 0; row < rows; row++) {
        const idx = reel * rows + row;
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


/**
 * Run one full Inferno Link round on a provable-fairness RNG. Pure: identical RNG ⇒
 * identical outcome. Base line wins are RTP-scaled; the hold-and-spin feature (fireball
 * values + GRAND) is added VERBATIM so every reveal is exact. The 5000× cap binds last.
 */
export function spin(rng: Rng): EngineResult {
  const grid = drawGrid(rng, BASE_REEL_WEIGHTS);
  const lineWinsList = lineWins(grid);
  const linesBps = lineWinsList.reduce((sum, w) => sum + w.payBps, 0);

  // Every FIREBALL on the base grid is a "credit ball" with a drawn value (reel-major order),
  // shown on the reels every spin. They pay nothing on their own — only if 4+ trigger the
  // hold-and-spin, where they become the initial locks.
  const baseFires: InfernoFire[] = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[reel]![row] !== FIREBALL) continue;
      const v = drawFireValue(rng);
      baseFires.push({ reel, row, valueBps: v.valueBps, tier: v.tier });
    }
  }
  const baseFireballCount = baseFires.length;

  let holdSpin: InfernoHoldSpin | null = null;
  if (baseFireballCount >= INFERNO_TRIGGER) {
    holdSpin = runHoldSpin(rng, baseFires);
  }

  const scaledLines = Math.floor((linesBps * PAYOUT_SCALAR_BPS) / 10_000);
  const totalWinBps = Math.min(MAX_WIN_BPS, scaledLines + (holdSpin?.bonusBps ?? 0));

  // Presentation-only suspense/celebration hints, derived from the BASE grid the player watches
  // reel-by-reel. The FIREBALL credit balls trigger the hold-and-spin on INFERNO_TRIGGER+ and
  // tease on the "one-to-go" reel; a full-board fill (GRAND) flags the JACKPOT tier. The
  // hold-and-spin auto-plays after the trigger. Never affects totalWinBps.
  const feel: SlotFeel = buildFeel({
    totalWinBps,
    jackpot: holdSpin?.filledAll ?? false,
    anticipation: [computeAnticipation(grid, FIREBALL, INFERNO_TRIGGER)],
  });

  return {
    totalWinBps,
    outcome: {
      kind: "inferno-link",
      win: totalWinBps > 0,
      grid,
      lineWins: lineWinsList,
      baseFires,
      baseFireballCount,
      holdSpin,
      totalWinBps,
      feel,
    },
  };
}
