import { describe, expect, it } from "vitest";
import {
  WHEEL_LAYOUTS,
  WHEEL_RISKS,
  WHEEL_SEGMENT_COUNT,
  type WheelOutcome as SharedWheelOutcome,
  type WheelRisk,
} from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { spin, type Rng } from "./engine";

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

describe("Fortune Wheel — layouts", () => {
  it("every risk has 30 segments with a mean multiplier of 0.96 (96% RTP, no hidden scalar)", () => {
    for (const risk of WHEEL_RISKS) {
      const layout = WHEEL_LAYOUTS[risk];
      expect(layout).toHaveLength(WHEEL_SEGMENT_COUNT);
      const mean = layout.reduce((a, b) => a + b, 0) / layout.length;
      expect(mean).toBeCloseTo(0.96, 6);
      for (const m of layout) expect(m).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Fortune Wheel — engine", () => {
  it("converges to ~96% RTP for every risk and pays exactly the landed segment", () => {
    for (const risk of WHEEL_RISKS as readonly WheelRisk[]) {
      const rng = mulberry32(0x1234abcd ^ risk.length);
      let total = 0n;
      const spins = 200_000;
      for (let i = 0; i < spins; i++) {
        const { totalWinBps, outcome } = spin(rng, risk);
        // The win is exactly the landed segment's multiplier — no scalar, no surprise.
        expect(outcome.index).toBeGreaterThanOrEqual(0);
        expect(outcome.index).toBeLessThan(WHEEL_SEGMENT_COUNT);
        expect(outcome.multiplier).toBe(WHEEL_LAYOUTS[risk][outcome.index]);
        expect(totalWinBps).toBe(Math.round(outcome.multiplier * 10_000));
        total += BigInt(totalWinBps);
      }
      const rtp = Number(total) / (spins * 10_000);
      expect(Math.abs(rtp - 0.96)).toBeLessThan(0.02);
    }
  });

  it("never returns a negative win and flags win correctly", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const { totalWinBps, outcome } = spin(rng, "HIGH");
      expect(totalWinBps).toBeGreaterThanOrEqual(0);
      expect(outcome.win).toBe(totalWinBps > 0);
    }
  });
});

describe("Fortune Wheel — provable fairness", () => {
  it("is deterministic for the same committed seeds", () => {
    const a = spin(createRoundRng("server-seed", "client-seed", 1), "MEDIUM");
    const b = spin(createRoundRng("server-seed", "client-seed", 1), "MEDIUM");
    expect(b).toEqual(a);
  });

  it("can land a different segment for a different nonce", () => {
    let differs = false;
    const base = spin(createRoundRng("s", "c", 1), "MEDIUM").outcome.index;
    for (let n = 2; n < 40 && !differs; n++) {
      if (spin(createRoundRng("s", "c", n), "MEDIUM").outcome.index !== base) differs = true;
    }
    expect(differs).toBe(true);
  });

  it("emits the public Fortune Wheel contract", () => {
    const { outcome } = spin(createRoundRng("s", "c", 3), "LOW");
    const asShared: SharedWheelOutcome = outcome;
    expect(asShared.kind).toBe("fortune-wheel");
    expect(asShared.risk).toBe("LOW");
  });
});
