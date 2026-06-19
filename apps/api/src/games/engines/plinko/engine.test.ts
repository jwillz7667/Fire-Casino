import { describe, expect, it } from "vitest";
import {
  PLINKO_BUCKET_COUNT,
  PLINKO_LAYOUTS,
  PLINKO_RISKS,
  PLINKO_ROWS,
  type PlinkoOutcome as SharedPlinkoOutcome,
  type PlinkoRisk,
} from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { drop, type Rng } from "./engine";

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

/** Binomial bucket probabilities for n=PLINKO_ROWS fair decisions (C(n,k) / 2^n). */
function binomialWeights(): number[] {
  const n = PLINKO_ROWS;
  const c: number[] = [1];
  for (let k = 1; k <= n; k++) c.push((c[k - 1]! * (n - k + 1)) / k);
  const total = 2 ** n;
  return c.map((x) => x / total);
}

describe("Plinko — layouts", () => {
  it("every risk has 13 buckets, is symmetric, and means 0.96 under the binomial drop", () => {
    const w = binomialWeights();
    for (const risk of PLINKO_RISKS) {
      const layout = PLINKO_LAYOUTS[risk];
      expect(layout).toHaveLength(PLINKO_BUCKET_COUNT);
      for (let k = 0; k < layout.length; k++) {
        expect(layout[k]).toBeGreaterThanOrEqual(0);
        expect(layout[k]).toBe(layout[layout.length - 1 - k]); // symmetric
      }
      const mean = layout.reduce((acc, m, k) => acc + m * w[k]!, 0);
      // Calibrated by hand to ~0.96; allow the 2-dp rounding slack on the curve.
      expect(Math.abs(mean - 0.96)).toBeLessThan(0.003);
    }
  });
});

describe("Plinko — engine", () => {
  it("converges to ~96% RTP for every risk and pays exactly the landed bucket", () => {
    for (const risk of PLINKO_RISKS as readonly PlinkoRisk[]) {
      const rng = mulberry32(0x1234abcd ^ risk.length);
      let total = 0n;
      const drops = 300_000;
      for (let i = 0; i < drops; i++) {
        const { totalWinBps, outcome } = drop(rng, risk);
        expect(outcome.path).toHaveLength(PLINKO_ROWS);
        expect(outcome.bucket).toBe(outcome.path.reduce((a, b) => a + b, 0));
        expect(outcome.multiplier).toBe(PLINKO_LAYOUTS[risk][outcome.bucket]);
        expect(totalWinBps).toBe(Math.round(outcome.multiplier * 10_000));
        total += BigInt(totalWinBps);
      }
      const rtp = Number(total) / (drops * 10_000);
      expect(Math.abs(rtp - 0.96)).toBeLessThan(0.02);
    }
  });

  it("never returns a negative win and flags win correctly", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const { totalWinBps, outcome } = drop(rng, "HIGH");
      expect(totalWinBps).toBeGreaterThanOrEqual(0);
      expect(outcome.win).toBe(totalWinBps > 0);
      expect(outcome.bucket).toBeGreaterThanOrEqual(0);
      expect(outcome.bucket).toBeLessThan(PLINKO_BUCKET_COUNT);
    }
  });
});

describe("Plinko — provable fairness", () => {
  it("is deterministic for the same committed seeds", () => {
    const a = drop(createRoundRng("server-seed", "client-seed", 1), "MEDIUM");
    const b = drop(createRoundRng("server-seed", "client-seed", 1), "MEDIUM");
    expect(b).toEqual(a);
  });

  it("can land a different bucket for a different nonce", () => {
    let differs = false;
    const base = drop(createRoundRng("s", "c", 1), "MEDIUM").outcome.bucket;
    for (let n = 2; n < 60 && !differs; n++) {
      if (drop(createRoundRng("s", "c", n), "MEDIUM").outcome.bucket !== base) differs = true;
    }
    expect(differs).toBe(true);
  });

  it("emits the public Plinko contract", () => {
    const { outcome } = drop(createRoundRng("s", "c", 3), "LOW");
    const asShared: SharedPlinkoOutcome = outcome;
    expect(asShared.kind).toBe("plinko");
    expect(asShared.risk).toBe("LOW");
    expect(asShared.path).toHaveLength(PLINKO_ROWS);
  });
});
