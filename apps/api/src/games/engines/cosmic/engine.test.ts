import { describe, expect, it } from "vitest";
import { type CosmicOutcome as SharedCosmicOutcome } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { evaluateSpin, spin, type Grid, type Rng } from "./engine";
import { BONUS_AWARD, CERTIFIED_RTP_BPS, PAYLINES } from "./math";

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

describe("Cosmic Spins engine — payline table", () => {
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

describe("Cosmic Spins engine — RTP", () => {
  it("converges to the certified RTP over many spins", () => {
    const rng = mulberry32(0x1234abcd);
    let totalWinBps = 0n;
    const spins = 300_000;
    for (let i = 0; i < spins; i++) totalWinBps += BigInt(spin(rng).totalWinBps);
    const rtp = Number(totalWinBps) / (spins * 10_000);
    // 5% band absorbs the heavy bonus + free-spin tail (rising multiplier, 500× prize,
    // 15000× cap) at this sample size.
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
    for (let i = 0; i < 120_000; i++) {
      const { outcome } = spin(rng);
      if (outcome.freeSpins) {
        sawTrigger = true;
        expect(outcome.base.scatterCount).toBeGreaterThanOrEqual(3);
        expect(outcome.freeSpins.spins.length).toBe(outcome.freeSpins.totalSpins);
        expect(outcome.freeSpins.totalSpins).toBeGreaterThanOrEqual(8);
        // multiplier ramps +1/spin (1,2,3,…) capped at 15; the first spin is always ×1.
        expect(outcome.freeSpins.spins[0]!.multiplier).toBe(1);
        expect(outcome.freeSpins.endMultiplier).toBeGreaterThanOrEqual(1);
        expect(outcome.freeSpins.endMultiplier).toBeLessThanOrEqual(15);
      } else {
        expect(outcome.base.scatterCount).toBeLessThan(3);
      }
    }
    expect(sawTrigger).toBe(true);
  });
});

describe("Cosmic Spins engine — wild & scatter rules", () => {
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
    // Middle line (PAYLINE 0 = [1,1,1,1,1]): CORE, WILD, CORE → 3-of-a-kind.
    const grid: Grid = [
      ["ORB", "CORE", "K"],
      ["ENERGY", "WILD", "Q"],
      ["TABLET", "CORE", "J"],
      ["A", "ORB", "K"],
      ["K", "A", "Q"],
    ];
    const res = evaluateSpin(grid, 1);
    const core = res.lineWins.find((w) => w.symbol === "CORE" && w.line === 0);
    expect(core).toBeDefined();
    expect(core!.count).toBe(3);
    expect(core!.cells).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it("does not count the wild as a scatter or bonus", () => {
    const grid: Grid = [
      ["CORE", "K", "J"],
      ["WILD", "WILD", "WILD"],
      ["WILD", "WILD", "WILD"],
      ["WILD", "WILD", "WILD"],
      ["A", "K", "Q"],
    ];
    const res = evaluateSpin(grid, 1);
    expect(res.scatterCount).toBe(0);
    expect(res.bonusCount).toBe(0);
  });

  it("pays the scatter anywhere by count, and rides the spin multiplier", () => {
    const grid: Grid = [
      ["SCATTER", "J", "J"],
      ["J", "SCATTER", "J"],
      ["J", "J", "SCATTER"],
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

describe("Cosmic Spins engine — bonus feature", () => {
  function gridWithBonus(count: number): Grid {
    // Fill with a non-paying-line mix, then drop `count` BONUS symbols across the grid.
    const filler: Grid = [
      ["A", "K", "Q"],
      ["K", "Q", "J"],
      ["Q", "J", "TEN"],
      ["J", "TEN", "NINE"],
      ["TEN", "NINE", "A"],
    ];
    const coords: [number, number][] = [];
    for (let reel = 0; reel < 5 && coords.length < count; reel++) {
      coords.push([reel, 0]); // one per reel, top row, up to 5
    }
    for (const [reel, row] of coords) filler[reel]![row] = "BONUS";
    return filler;
  }

  it("awards the right bps for 3 / 4 / 5 BONUS and never below the trigger", () => {
    expect(evaluateSpin(gridWithBonus(2), 1).bonusPayBps).toBe(0);

    const three = evaluateSpin(gridWithBonus(3), 1);
    expect(three.bonusCount).toBe(3);
    expect(three.bonusPayBps).toBe(200000);
    expect(three.bonusPayBps).toBe(BONUS_AWARD[3]);

    const four = evaluateSpin(gridWithBonus(4), 1);
    expect(four.bonusCount).toBe(4);
    expect(four.bonusPayBps).toBe(1000000);
    expect(four.bonusPayBps).toBe(BONUS_AWARD[4]);

    const five = evaluateSpin(gridWithBonus(5), 1);
    expect(five.bonusCount).toBe(5);
    expect(five.bonusPayBps).toBe(5000000);
    expect(five.bonusPayBps).toBe(BONUS_AWARD[5]);
  });

  it("the spin multiplier never scales the fixed bonus prize", () => {
    const x1 = evaluateSpin(gridWithBonus(3), 1);
    const x7 = evaluateSpin(gridWithBonus(3), 7);
    expect(x1.bonusPayBps).toBe(x7.bonusPayBps);
  });

  it("surfaces a triggered bonus on the outcome and adds it verbatim to the total", () => {
    let sawBonus = false;
    const rng = mulberry32(0xb04f5);
    for (let i = 0; i < 200_000; i++) {
      const { totalWinBps, outcome } = spin(rng);
      if (outcome.bonus) {
        sawBonus = true;
        expect(outcome.bonus.triggered).toBe(true);
        expect(outcome.bonus.bonusCount).toBeGreaterThanOrEqual(3);
        expect([200000, 1000000, 5000000]).toContain(outcome.bonus.awardBps);
        expect(outcome.bonus.awardBps).toBe(outcome.base.bonusPayBps);
        // The unscaled bonus prize is included in the round total.
        expect(totalWinBps).toBeGreaterThanOrEqual(outcome.bonus.awardBps);
      } else {
        expect(outcome.base.bonusCount).toBeLessThan(3);
      }
    }
    expect(sawBonus).toBe(true);
  });
});

describe("Cosmic Spins engine — provable fairness", () => {
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

  it("emits the public Cosmic outcome contract", () => {
    const { outcome } = spin(createRoundRng("s", "c", 3));
    // Compile-time: the engine outcome must satisfy the shared client contract.
    const asShared: SharedCosmicOutcome = outcome;
    expect(asShared.kind).toBe("cosmic-slots");
    expect(asShared.base.grid).toHaveLength(5);
    expect(asShared.base.grid[0]).toHaveLength(3);
  });
});
