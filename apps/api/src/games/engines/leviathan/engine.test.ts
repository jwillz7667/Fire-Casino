import { describe, expect, it } from "vitest";
import {
  isLeviathanOutcome,
  LEVIATHAN_BONUS_TRIGGER,
  LEVIATHAN_REELS,
  LEVIATHAN_ROWS,
  LEVIATHAN_SCATTER_TRIGGER,
  type LeviathanOutcome as SharedLeviathanOutcome,
} from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { evaluateWays, spin, type Grid, type Rng } from "./engine";
import {
  BASE_REEL_WEIGHTS,
  BONUS_AWARD,
  CERTIFIED_RTP_BPS,
  FREE_REEL_WEIGHTS,
  MAX_WIN_BPS,
  REELS,
  ROWS,
} from "./math";
import { WILD, type SymbolId } from "./symbols";

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

/** Draw a full 6×5 grid for the free-vs-base invariant probe (matches the engine's draw). */
function drawGrid(rng: Rng, weights: Record<SymbolId, number>[]): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REELS; reel++) {
    let total = 0;
    for (const k of Object.keys(weights[reel]!) as SymbolId[]) total += weights[reel]![k];
    const col: SymbolId[] = [];
    for (let row = 0; row < ROWS; row++) {
      let r = rng() * total;
      let pick: SymbolId = "PEARL";
      for (const k of Object.keys(weights[reel]!) as SymbolId[]) {
        r -= weights[reel]![k];
        if (r < 0) {
          pick = k;
          break;
        }
      }
      col.push(pick);
    }
    grid.push(col);
  }
  return grid;
}

describe("Leviathan's Deep engine — grid & contract", () => {
  it("uses the contract's 6×5 dimensions", () => {
    expect(REELS).toBe(LEVIATHAN_REELS);
    expect(ROWS).toBe(LEVIATHAN_ROWS);
  });

  it("emits the public Leviathan's Deep outcome contract", () => {
    const { outcome } = spin(createRoundRng("s", "c", 3));
    const asShared: SharedLeviathanOutcome = outcome; // compile-time contract assertion
    expect(asShared.kind).toBe("leviathan-deep");
    expect(isLeviathanOutcome(asShared)).toBe(true);
    expect(asShared.base.cascades[0]!.grid).toHaveLength(6);
    expect(asShared.base.cascades[0]!.grid[0]).toHaveLength(5);
    expect(asShared.base.cascades[0]!.multiplier).toBe(1); // fresh base spin = ×1
  });
});

describe("Leviathan's Deep engine — RTP", () => {
  it("converges to the certified RTP over many spins", () => {
    const rng = mulberry32(0x1234abcd);
    let totalWinBps = 0n;
    const spins = 400_000;
    for (let i = 0; i < spins; i++) totalWinBps += BigInt(spin(rng).totalWinBps);
    const rtp = Number(totalWinBps) / (spins * 10_000);
    // 5% band absorbs the free-spin tide tail + the fixed Kraken slice at this sample size.
    expect(Math.abs(rtp - CERTIFIED_RTP_BPS / 10_000)).toBeLessThan(0.05);
  });

  it("never pays negative, reports a consistent total, and respects the cap", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 5_000; i++) {
      const { totalWinBps, outcome } = spin(rng);
      expect(totalWinBps).toBeGreaterThanOrEqual(0);
      expect(totalWinBps).toBeLessThanOrEqual(MAX_WIN_BPS);
      expect(outcome.totalWinBps).toBe(totalWinBps);
      expect(outcome.win).toBe(totalWinBps > 0);
    }
  });
});

describe("Leviathan's Deep engine — ways & tumbling", () => {
  it("never lands the WILD on reel 0 or reel 5, in base or free grids", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 20_000; i++) {
      const { outcome } = spin(rng);
      const grids: Grid[] = [
        ...outcome.base.cascades.map((c) => c.grid),
        ...(outcome.freeSpins?.spins.flatMap((s) => s.cascades.map((c) => c.grid)) ?? []),
      ];
      for (const grid of grids) {
        expect(grid[0]!.includes(WILD)).toBe(false);
        expect(grid[REELS - 1]!.includes(WILD)).toBe(false);
      }
    }
  });

  it("counts ways as the product of per-reel matches, wild-substituted, with exact cells", () => {
    // LEVIATHAN: reel0 has 2, reel1 a WILD, reel2 has 1; reel3 breaks the run.
    const grid: Grid = [
      ["LEVIATHAN", "LEVIATHAN", "AQUA", "AQUA", "AQUA"],
      ["WILD", "SIREN", "SIREN", "SIREN", "SIREN"],
      ["LEVIATHAN", "EMERALD", "EMERALD", "EMERALD", "EMERALD"],
      ["PEARL", "PEARL", "PEARL", "PEARL", "PEARL"],
      ["AMETHYST", "AMETHYST", "AMETHYST", "AMETHYST", "AMETHYST"],
      ["CHEST", "CHEST", "CHEST", "CHEST", "CHEST"],
    ];
    const wins = evaluateWays(grid);
    const lev = wins.find((w) => w.symbol === "LEVIATHAN");
    expect(lev).toBeDefined();
    expect(lev!.reels).toBe(3);
    expect(lev!.ways).toBe(2); // 2 (reel0) × 1 (wild) × 1 (reel2)
    expect(lev!.payBps).toBe(800 * 2); // LEVIATHAN[3] × 2 ways (high-volatility paytable)
    expect(lev!.cells).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
    ]);
  });

  it("never anchors a win on a wild (reel 0 carries no wild) and stops at the first gap", () => {
    // No LEVIATHAN on reel 0 ⇒ no LEVIATHAN win even though reels 1..3 are all wild/lev.
    const grid: Grid = [
      ["PEARL", "AQUA", "EMERALD", "SAPPHIRE", "AMETHYST"],
      ["WILD", "WILD", "WILD", "WILD", "WILD"],
      ["LEVIATHAN", "LEVIATHAN", "LEVIATHAN", "LEVIATHAN", "LEVIATHAN"],
      ["LEVIATHAN", "LEVIATHAN", "LEVIATHAN", "LEVIATHAN", "LEVIATHAN"],
      ["TRIDENT", "TRIDENT", "TRIDENT", "TRIDENT", "TRIDENT"],
      ["CHEST", "CHEST", "CHEST", "CHEST", "CHEST"],
    ];
    expect(evaluateWays(grid).some((w) => w.symbol === "LEVIATHAN")).toBe(false);
  });

  it("does not count WILD / SCATTER / BONUS / MULT_ORB as paying symbols", () => {
    const grid: Grid = [
      ["SCATTER", "BONUS", "MULT_ORB", "SCATTER", "BONUS"],
      ["WILD", "WILD", "WILD", "WILD", "WILD"],
      ["WILD", "WILD", "WILD", "WILD", "WILD"],
      ["SCATTER", "BONUS", "MULT_ORB", "SCATTER", "BONUS"],
      ["WILD", "WILD", "WILD", "WILD", "WILD"],
      ["SCATTER", "BONUS", "MULT_ORB", "SCATTER", "BONUS"],
    ];
    expect(evaluateWays(grid)).toHaveLength(0);
  });

  it("starts with the initial grid, ends on a no-win settled grid, and sums step wins", () => {
    const rng = mulberry32(0xca5cade);
    for (let i = 0; i < 5_000; i++) {
      const { outcome } = spin(rng);
      const cascades = outcome.base.cascades;
      expect(cascades.length).toBeGreaterThanOrEqual(1);
      const last = cascades[cascades.length - 1]!;
      expect(last.wins).toHaveLength(0); // the terminal step always settles with no win
      expect(last.stepWinBps).toBe(0);
      const summed = cascades.reduce((s, c) => s + c.stepWinBps, 0);
      expect(outcome.base.spinWinBps).toBe(summed);
    }
  });
});

describe("Leviathan's Deep engine — free spins (rising tide)", () => {
  it("triggers on 4+ scatters only, with a non-decreasing tide that starts at 1", () => {
    const rng = mulberry32(0xfeed);
    let sawTrigger = false;
    for (let i = 0; i < 250_000; i++) {
      const { outcome } = spin(rng);
      if (outcome.freeSpins) {
        sawTrigger = true;
        expect(outcome.base.scatterCount).toBeGreaterThanOrEqual(LEVIATHAN_SCATTER_TRIGGER);
        expect(outcome.freeSpins.spins.length).toBe(outcome.freeSpins.totalSpins);
        expect(outcome.freeSpins.totalSpins).toBeGreaterThanOrEqual(10);
        expect(outcome.freeSpins.startTide).toBe(1);
        expect(outcome.freeSpins.endTide).toBeGreaterThanOrEqual(outcome.freeSpins.startTide);
        // the persistent tide only ever rises across the feature
        let prev = 0;
        for (const s of outcome.freeSpins.spins) {
          expect(s.endMultiplier).toBeGreaterThanOrEqual(prev);
          prev = s.endMultiplier;
        }
        expect(outcome.freeSpins.endTide).toBe(prev);
      } else {
        expect(outcome.base.scatterCount).toBeLessThan(LEVIATHAN_SCATTER_TRIGGER);
      }
    }
    expect(sawTrigger).toBe(true);
  });
});

describe("Leviathan's Deep engine — Kraken Awakens bonus", () => {
  it("awakens on 3+ BONUS only, paying an exact fixed bet-multiple added verbatim", () => {
    const rng = mulberry32(0xb04f5);
    let sawBonus = false;
    for (let i = 0; i < 400_000; i++) {
      const { totalWinBps, outcome } = spin(rng);
      if (outcome.bonus) {
        sawBonus = true;
        expect(outcome.bonus.triggered).toBe(true);
        expect(outcome.bonus.krakenCount).toBeGreaterThanOrEqual(LEVIATHAN_BONUS_TRIGGER);
        const expected = BONUS_AWARD[Math.min(outcome.bonus.krakenCount, 6)];
        expect(outcome.bonus.awardBps).toBe(expected);
        // the verbatim Kraken prize is always included in the (capped) round total
        expect(totalWinBps).toBeGreaterThanOrEqual(Math.min(outcome.bonus.awardBps, MAX_WIN_BPS));
      } else {
        expect(outcome.base.bonusCount).toBeLessThan(LEVIATHAN_BONUS_TRIGGER);
      }
    }
    expect(sawBonus).toBe(true);
  });
});

describe("Leviathan's Deep engine — provable fairness", () => {
  it("is deterministic for the same committed seeds", () => {
    const a = spin(createRoundRng("server-seed", "client-seed", 1));
    const b = spin(createRoundRng("server-seed", "client-seed", 1));
    expect(b).toEqual(a);
  });

  it("produces a different initial board for a different nonce", () => {
    const a = spin(createRoundRng("server-seed", "client-seed", 1));
    const b = spin(createRoundRng("server-seed", "client-seed", 2));
    expect(b.outcome.base.cascades[0]!.grid).not.toEqual(a.outcome.base.cascades[0]!.grid);
  });
});

describe("Leviathan's Deep engine — owner invariant (free wins more than base)", () => {
  it("free reels win more OFTEN and MORE per drop than base reels (pre-tide)", () => {
    // Isolate the symbol distribution: single drop, no tumble, no tide. The tide ramp only stacks
    // more on top, so proving the invariant on a fresh drop proves it unconditionally.
    const spins = 200_000;
    const measure = (weights: Record<SymbolId, number>[], seed: number) => {
      const rng = mulberry32(seed);
      let hits = 0;
      let sum = 0;
      for (let i = 0; i < spins; i++) {
        const pay = evaluateWays(drawGrid(rng, weights)).reduce((s, w) => s + w.payBps, 0);
        if (pay > 0) hits++;
        sum += pay;
      }
      return { hitRate: hits / spins, mean: sum / spins };
    };

    const base = measure(BASE_REEL_WEIGHTS, 0x1111_1111);
    const free = measure(FREE_REEL_WEIGHTS, 0x2222_2222);

    expect(free.hitRate).toBeGreaterThan(base.hitRate);
    expect(free.mean).toBeGreaterThan(base.mean);
  });
});
