import { describe, expect, it } from "vitest";
import {
  INFERNO_BONUS_CELLS,
  INFERNO_BONUS_ROWS,
  INFERNO_REELS,
  INFERNO_ROWS,
  INFERNO_TRIGGER,
  type InfernoOutcome as SharedInfernoOutcome,
} from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { spin, type Rng } from "./engine";
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

describe("Inferno Link — layouts", () => {
  it("has 25 distinct paylines, each 5 long and within rows 0..3", () => {
    expect(PAYLINES).toHaveLength(25);
    const seen = new Set<string>();
    for (const line of PAYLINES) {
      expect(line).toHaveLength(INFERNO_REELS);
      for (const r of line) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(INFERNO_ROWS);
      }
      seen.add(line.join(","));
    }
    expect(seen.size).toBe(25);
  });
});

describe("Inferno Link — engine", () => {
  it("converges to the certified RTP over many spins", () => {
    const rng = mulberry32(0x1234abcd);
    let total = 0n;
    const spins = 400_000;
    for (let i = 0; i < spins; i++) total += BigInt(spin(rng).totalWinBps);
    const rtp = Number(total) / (spins * 10_000);
    // Wide band absorbs the heavy hold-and-spin tail at this sample size.
    expect(Math.abs(rtp - CERTIFIED_RTP_BPS / 10_000)).toBeLessThan(0.04);
  });

  it("never pays a negative win and reports a consistent total", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 8_000; i++) {
      const { totalWinBps, outcome } = spin(rng);
      expect(totalWinBps).toBeGreaterThanOrEqual(0);
      expect(outcome.totalWinBps).toBe(totalWinBps);
      expect(outcome.win).toBe(totalWinBps > 0);
      expect(outcome.grid).toHaveLength(INFERNO_REELS);
      expect(outcome.grid[0]).toHaveLength(INFERNO_ROWS);
    }
  });

  it("triggers the hold-and-spin on 6+ fireballs and only then, locks consistently", () => {
    const rng = mulberry32(0xfeed);
    let sawTrigger = false;
    let sawFill = false;
    for (let i = 0; i < 300_000; i++) {
      const { outcome } = spin(rng);
      if (outcome.holdSpin) {
        sawTrigger = true;
        expect(outcome.baseFireballCount).toBeGreaterThanOrEqual(INFERNO_TRIGGER);
        // initial locks == base fireballs; every locked cell is unique and in-bounds.
        expect(outcome.holdSpin.initial.length).toBe(outcome.baseFireballCount);
        const cells = new Set<number>();
        // initial trigger fireballs sit in the base rows (0..3); respin balls fill the
        // taller 6-row bonus board.
        for (const f of outcome.holdSpin.initial) {
          expect(f.row).toBeLessThan(INFERNO_ROWS);
        }
        for (const f of outcome.holdSpin.locked) {
          expect(f.reel).toBeGreaterThanOrEqual(0);
          expect(f.reel).toBeLessThan(INFERNO_REELS);
          expect(f.row).toBeGreaterThanOrEqual(0);
          expect(f.row).toBeLessThan(INFERNO_BONUS_ROWS);
          cells.add(f.reel * INFERNO_BONUS_ROWS + f.row);
        }
        expect(cells.size).toBe(outcome.holdSpin.locked.length);
        expect(outcome.holdSpin.locked.length).toBeLessThanOrEqual(INFERNO_BONUS_CELLS);
        if (outcome.holdSpin.filledAll) {
          sawFill = true;
          expect(outcome.holdSpin.locked.length).toBe(INFERNO_BONUS_CELLS);
        }
      } else {
        expect(outcome.baseFireballCount).toBeLessThan(INFERNO_TRIGGER);
      }
    }
    expect(sawTrigger).toBe(true);
    expect(sawFill).toBe(true);
  });
});

describe("Inferno Link — provable fairness", () => {
  it("is deterministic for the same committed seeds", () => {
    const a = spin(createRoundRng("server-seed", "client-seed", 1));
    const b = spin(createRoundRng("server-seed", "client-seed", 1));
    expect(b).toEqual(a);
  });

  it("produces a different board for a different nonce", () => {
    const a = spin(createRoundRng("server-seed", "client-seed", 1));
    const b = spin(createRoundRng("server-seed", "client-seed", 2));
    expect(b.outcome.grid).not.toEqual(a.outcome.grid);
  });

  it("emits the public Inferno Link contract", () => {
    const { outcome } = spin(createRoundRng("s", "c", 3));
    const asShared: SharedInfernoOutcome = outcome;
    expect(asShared.kind).toBe("inferno-link");
    expect(asShared.grid).toHaveLength(5);
    expect(asShared.grid[0]).toHaveLength(4);
  });
});
