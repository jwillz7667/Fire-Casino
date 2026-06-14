import { describe, expect, it } from "vitest";
import { type PhoenixOutcome as SharedPhoenixOutcome } from "@aureus/shared";
import { createRoundRng } from "../../rgs/fairness";
import { spin, type Rng } from "./engine";
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

describe("Phoenix Ascendant engine — RTP", () => {
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
      expect(outcome.demo).toBe(true);
    }
  });

  it("triggers free spins on 3+ scatters and only then", () => {
    const rng = mulberry32(0xfeed);
    let sawTrigger = false;
    for (let i = 0; i < 50_000; i++) {
      const { outcome } = spin(rng);
      if (outcome.freeSpins) {
        sawTrigger = true;
        expect(outcome.base.scatterCount).toBeGreaterThanOrEqual(3);
        expect(outcome.freeSpins.totalSpins).toBeGreaterThanOrEqual(8);
        expect(outcome.freeSpins.spins.length).toBe(outcome.freeSpins.totalSpins);
      } else {
        expect(outcome.base.scatterCount).toBeLessThan(3);
      }
    }
    expect(sawTrigger).toBe(true);
  });
});

describe("Phoenix Ascendant engine — provable fairness", () => {
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

  it("emits the public Phoenix outcome contract", () => {
    const { outcome } = spin(createRoundRng("s", "c", 3));
    // Compile-time: the engine outcome must satisfy the shared client contract.
    const asShared: SharedPhoenixOutcome = outcome;
    expect(asShared.kind).toBe("phoenix-ascendant");
    expect(asShared.base.grid).toHaveLength(5);
    expect(asShared.base.grid[0]).toHaveLength(3);
  });
});
