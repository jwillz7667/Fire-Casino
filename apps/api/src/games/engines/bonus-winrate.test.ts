import { describe, expect, it } from "vitest";
import { evaluateSpin as cosmicEval } from "./cosmic/engine";
import * as cosmicMath from "./cosmic/math";
import { evaluateSpin as dragonEval } from "./dragon/engine";
import * as dragonMath from "./dragon/math";
import { evaluateSpin as kirinEval } from "./kirin/engine";
import * as kirinMath from "./kirin/math";
import { evaluateSpin as phoenixEval } from "./phoenix/engine";
import * as phoenixMath from "./phoenix/math";
import { evaluateSpin as royalEval } from "./royal/engine";
import * as royalMath from "./royal/math";

/**
 * Product invariant: every slot's BONUS feature must reward the player more than regular
 * play — both more OFTEN (hit frequency) and MORE per spin (mean win). We measure the
 * free-spin reel weights against the base reel weights at multiplier 1, which isolates the
 * symbol distribution: the bonus multiplier ramp (and, for Cosmic, the instant BONUS prize)
 * only stack additional value on top, so proving the invariant pre-multiplier proves it
 * unconditionally. Deterministic seed ⇒ no flake. Re-tune a free-weight table that breaks
 * this (see each engine's math.ts and the _winrate probe history).
 */

type Rng = () => number;
type Weights = Record<string, number>;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng: Rng, w: Weights): string {
  let total = 0;
  for (const k of Object.keys(w)) total += w[k]!;
  let r = rng() * total;
  for (const k of Object.keys(w)) {
    r -= w[k]!;
    if (r < 0) return k;
  }
  return Object.keys(w)[0]!;
}

interface EngineCfg {
  name: string;
  reels: number;
  rows: number;
  base: Weights | Weights[];
  free: Weights | Weights[];
  evaluate: (grid: string[][], multiplier: number) => { spinWinBps: number };
}

const ENGINES: EngineCfg[] = [
  {
    name: "phoenix-ascendant",
    reels: phoenixMath.REELS,
    rows: phoenixMath.ROWS,
    base: phoenixMath.BASE_WEIGHTS,
    free: phoenixMath.FREE_SPIN_WEIGHTS,
    evaluate: (g, m) => phoenixEval(g as never, m),
  },
  {
    name: "royal-ascendant",
    reels: royalMath.REELS,
    rows: royalMath.ROWS,
    base: royalMath.BASE_REEL_WEIGHTS,
    free: royalMath.FREE_REEL_WEIGHTS,
    evaluate: (g, m) => royalEval(g as never, m),
  },
  {
    name: "dragon-hoard",
    reels: dragonMath.REELS,
    rows: dragonMath.ROWS,
    base: dragonMath.BASE_REEL_WEIGHTS,
    free: dragonMath.FREE_REEL_WEIGHTS,
    evaluate: (g, m) => dragonEval(g as never, m),
  },
  {
    name: "cosmic-slots",
    reels: cosmicMath.REELS,
    rows: cosmicMath.ROWS,
    base: cosmicMath.BASE_REEL_WEIGHTS,
    free: cosmicMath.FREE_REEL_WEIGHTS,
    evaluate: (g, m) => cosmicEval(g as never, m),
  },
  {
    name: "flaming-kirin",
    reels: kirinMath.REELS,
    rows: kirinMath.ROWS,
    base: kirinMath.BASE_REEL_WEIGHTS,
    free: kirinMath.FREE_REEL_WEIGHTS,
    evaluate: (g, m) => kirinEval(g as never, m),
  },
];

const SPINS = 80_000;

function measure(cfg: EngineCfg, weights: Weights | Weights[], seed: number) {
  const rng = mulberry32(seed);
  let wins = 0;
  let sum = 0;
  for (let i = 0; i < SPINS; i++) {
    const grid: string[][] = [];
    for (let reel = 0; reel < cfg.reels; reel++) {
      const w = Array.isArray(weights) ? weights[reel]! : weights;
      const col: string[] = [];
      for (let row = 0; row < cfg.rows; row++) col.push(pick(rng, w));
      grid.push(col);
    }
    const r = cfg.evaluate(grid, 1);
    if (r.spinWinBps > 0) wins++;
    sum += r.spinWinBps;
  }
  return { hitRate: wins / SPINS, mean: sum / SPINS };
}

describe("bonus features reward more than regular spins", () => {
  for (const cfg of ENGINES) {
    it(`${cfg.name}: free spins win more often AND pay more per spin than base spins`, () => {
      const base = measure(cfg, cfg.base, 0x1111_1111);
      const free = measure(cfg, cfg.free, 0x2222_2222);

      expect(free.hitRate).toBeGreaterThan(base.hitRate);
      expect(free.mean).toBeGreaterThanOrEqual(base.mean);
    });
  }
});
