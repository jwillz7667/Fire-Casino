import { describe, expect, it } from "vitest";
import { type RoyalOutcome as SharedRoyalOutcome } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { evaluateSpin, spin, type Grid, type Rng } from "./engine";
import { CERTIFIED_RTP_BPS } from "./math";

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

describe("Royal Ascendant engine — RTP", () => {
  it("converges to the certified RTP over many spins", () => {
    const rng = mulberry32(0x1234abcd);
    let totalWinBps = 0n;
    const spins = 200_000;
    for (let i = 0; i < spins; i++) totalWinBps += BigInt(spin(rng).totalWinBps);
    const rtp = Number(totalWinBps) / (spins * 10_000);
    // 3% band absorbs the heavy free-spin tail at this sample size.
    expect(Math.abs(rtp - CERTIFIED_RTP_BPS / 10_000)).toBeLessThan(0.03);
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
        expect(outcome.freeSpins.totalSpins).toBeGreaterThanOrEqual(10);
        // multiplier ramps 1,2,3,… capped at 10; the first spin is always ×1.
        expect(outcome.freeSpins.spins[0]!.multiplier).toBe(1);
        expect(outcome.freeSpins.endMultiplier).toBeGreaterThanOrEqual(1);
        expect(outcome.freeSpins.endMultiplier).toBeLessThanOrEqual(10);
      } else {
        expect(outcome.base.scatterCount).toBeLessThan(3);
      }
    }
    expect(sawTrigger).toBe(true);
  });
});

describe("Royal Ascendant engine — wild & scatter rules", () => {
  it("never lands the JOKER wild on reels 1 or 5", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 20_000; i++) {
      const { outcome } = spin(rng);
      const grids: Grid[] = [
        outcome.base.grid,
        ...(outcome.freeSpins?.spins.map((s) => s.grid) ?? []),
      ];
      for (const grid of grids) {
        expect(grid[0]!.includes("JOKER")).toBe(false);
        expect(grid[4]!.includes("JOKER")).toBe(false);
      }
    }
  });

  it("substitutes the wild for a paying symbol to complete a way", () => {
    // QUEEN on reel 1, JOKER on reel 2 (interior), QUEEN on reel 3 → 3-of-a-kind.
    const grid: Grid = [
      ["QUEEN", "TEN", "TEN"],
      ["JOKER", "TEN", "TEN"],
      ["QUEEN", "TEN", "TEN"],
      ["K", "TEN", "TEN"],
      ["A", "A", "A"],
    ];
    const res = evaluateSpin(grid, 1);
    const queen = res.waysWins.find((w) => w.symbol === "QUEEN");
    expect(queen).toBeDefined();
    expect(queen!.count).toBe(3);
  });

  it("does not count the wild as a scatter", () => {
    const grid: Grid = [
      ["QUEEN", "K", "TEN"],
      ["JOKER", "JOKER", "JOKER"],
      ["JOKER", "JOKER", "JOKER"],
      ["JOKER", "JOKER", "JOKER"],
      ["A", "K", "Q"],
    ];
    expect(evaluateSpin(grid, 1).scatterCount).toBe(0);
  });

  it("pays the scatter anywhere by count, and rides the spin multiplier", () => {
    const grid: Grid = [
      ["CHEST", "J", "J"],
      ["J", "CHEST", "J"],
      ["J", "J", "CHEST"],
      ["TEN", "TEN", "TEN"],
      ["TEN", "TEN", "TEN"],
    ];
    const x1 = evaluateSpin(grid, 1);
    const x3 = evaluateSpin(grid, 3);
    expect(x1.scatterCount).toBe(3);
    expect(x1.scatterPayBps).toBe(2000);
    expect(x1.spinWinBps).toBeGreaterThan(0);
    expect(x3.spinWinBps).toBe(x1.spinWinBps * 3);
  });
});

describe("Royal Ascendant engine — provable fairness", () => {
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

  it("emits the public Royal outcome contract", () => {
    const { outcome } = spin(createRoundRng("s", "c", 3));
    // Compile-time: the engine outcome must satisfy the shared client contract.
    const asShared: SharedRoyalOutcome = outcome;
    expect(asShared.kind).toBe("royal-ascendant");
    expect(asShared.base.grid).toHaveLength(5);
    expect(asShared.base.grid[0]).toHaveLength(3);
  });
});
