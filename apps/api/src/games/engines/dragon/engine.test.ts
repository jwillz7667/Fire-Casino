import { describe, expect, it } from "vitest";
import { type DragonOutcome as SharedDragonOutcome } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { evaluateSpin, spin, type Grid, type Rng } from "./engine";
import { CERTIFIED_RTP_BPS, PAYLINES } from "./math";

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

describe("Dragon's Hoard engine — payline table", () => {
  it("has 25 distinct paylines, each a full 5-reel row vector within 0..2", () => {
    expect(PAYLINES).toHaveLength(25);
    const seen = new Set<string>();
    for (const line of PAYLINES) {
      expect(line).toHaveLength(5);
      for (const row of line) expect(row === 0 || row === 1 || row === 2).toBe(true);
      seen.add(line.join(""));
    }
    expect(seen.size).toBe(25);
  });
});

describe("Dragon's Hoard engine — RTP", () => {
  it("converges to the certified RTP over many spins", () => {
    const rng = mulberry32(0x1234abcd);
    let totalWinBps = 0n;
    const spins = 200_000;
    for (let i = 0; i < spins; i++) totalWinBps += BigInt(spin(rng).totalWinBps);
    const rtp = Number(totalWinBps) / (spins * 10_000);
    // 5% band absorbs the heavy free-spin tail (rising multiplier, 5000× cap) at this sample size.
    expect(Math.abs(rtp - CERTIFIED_RTP_BPS / 10_000)).toBeLessThan(0.05);
  });

  it("never pays a negative win and reports a consistent total", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 5_000; i++) {
      const { totalWinBps, outcome } = spin(rng);
      expect(totalWinBps).toBeGreaterThanOrEqual(0);
      expect(outcome.totalWinBps).toBe(totalWinBps);
      expect(outcome.win).toBe(totalWinBps > 0);
    }
  });

  it("triggers free spins on 3+ scatters and only then, with a rising multiplier", () => {
    const rng = mulberry32(0xfeed);
    let sawTrigger = false;
    for (let i = 0; i < 80_000; i++) {
      const { outcome } = spin(rng);
      if (outcome.freeSpins) {
        sawTrigger = true;
        expect(outcome.base.scatterCount).toBeGreaterThanOrEqual(3);
        expect(outcome.freeSpins.spins.length).toBe(outcome.freeSpins.totalSpins);
        expect(outcome.freeSpins.totalSpins).toBeGreaterThanOrEqual(8);
        // multiplier ramps +1/spin (1,2,3,…) capped at 12; the first spin is always ×1.
        expect(outcome.freeSpins.spins[0]!.multiplier).toBe(1);
        expect(outcome.freeSpins.endMultiplier).toBeGreaterThanOrEqual(1);
        expect(outcome.freeSpins.endMultiplier).toBeLessThanOrEqual(12);
      } else {
        expect(outcome.base.scatterCount).toBeLessThan(3);
      }
    }
    expect(sawTrigger).toBe(true);
  });
});

describe("Dragon's Hoard engine — wild & scatter rules", () => {
  it("never lands the WILD on reels 1 or 5", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 20_000; i++) {
      const { outcome } = spin(rng);
      const grids: Grid[] = [
        outcome.base.grid,
        ...(outcome.freeSpins?.spins.map((s) => s.grid) ?? []),
      ];
      for (const grid of grids) {
        expect(grid[0]!.includes("WILD")).toBe(false);
        expect(grid[4]!.includes("WILD")).toBe(false);
      }
    }
  });

  it("substitutes the wild for a paying symbol to complete a payline, with exact cells", () => {
    // Middle line (PAYLINE 0 = [1,1,1,1,1]): GOLD_DRAGON, WILD, GOLD_DRAGON → 3-of-a-kind.
    const grid: Grid = [
      ["RED_GEM", "GOLD_DRAGON", "K"],
      ["GREEN_GEM", "WILD", "Q"],
      ["BLUE_GEM", "GOLD_DRAGON", "J"],
      ["A", "RED_GEM", "K"],
      ["K", "A", "Q"],
    ];
    const res = evaluateSpin(grid, 1);
    const gold = res.lineWins.find((w) => w.symbol === "GOLD_DRAGON" && w.line === 0);
    expect(gold).toBeDefined();
    expect(gold!.count).toBe(3);
    expect(gold!.cells).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it("does not count the wild as a scatter", () => {
    const grid: Grid = [
      ["GOLD_DRAGON", "K", "J"],
      ["WILD", "WILD", "WILD"],
      ["WILD", "WILD", "WILD"],
      ["WILD", "WILD", "WILD"],
      ["A", "K", "Q"],
    ];
    expect(evaluateSpin(grid, 1).scatterCount).toBe(0);
  });

  it("pays the scatter anywhere by count, and rides the spin multiplier", () => {
    const grid: Grid = [
      ["COINS", "J", "J"],
      ["J", "COINS", "J"],
      ["J", "J", "COINS"],
      ["A", "A", "A"],
      ["K", "K", "K"],
    ];
    const x1 = evaluateSpin(grid, 1);
    const x3 = evaluateSpin(grid, 3);
    expect(x1.scatterCount).toBe(3);
    expect(x1.scatterPayBps).toBe(15000);
    expect(x1.spinWinBps).toBeGreaterThan(0);
    expect(x3.spinWinBps).toBe(x1.spinWinBps * 3);
  });
});

describe("Dragon's Hoard engine — provable fairness", () => {
  it("is deterministic for the same committed seeds", () => {
    const a = spin(createRoundRng("server-seed", "client-seed", 1));
    const b = spin(createRoundRng("server-seed", "client-seed", 1));
    expect(b).toEqual(a);
  });

  it("produces a different board for a different nonce", () => {
    const a = spin(createRoundRng("server-seed", "client-seed", 1));
    const b = spin(createRoundRng("server-seed", "client-seed", 2));
    expect(b.outcome.base.grid).not.toEqual(a.outcome.base.grid);
  });

  it("emits the public Dragon outcome contract", () => {
    const { outcome } = spin(createRoundRng("s", "c", 3));
    // Compile-time: the engine outcome must satisfy the shared client contract.
    const asShared: SharedDragonOutcome = outcome;
    expect(asShared.kind).toBe("dragon-hoard");
    expect(asShared.base.grid).toHaveLength(5);
    expect(asShared.base.grid[0]).toHaveLength(3);
  });
});
