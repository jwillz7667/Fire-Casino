import { describe, expect, it } from "vitest";
import { type GameType } from "@aureus/shared";
import { generateServerSeed, hashServerSeed, roundUniform } from "./fairness";
import { PlaceholderRgsProvider } from "./placeholder.provider";
import { type RoundRequest } from "./provider";

describe("provable fairness", () => {
  it("commit hash matches the revealed seed", () => {
    const seed = generateServerSeed();
    expect(hashServerSeed(seed)).toHaveLength(64);
    expect(hashServerSeed(seed)).toBe(hashServerSeed(seed));
  });

  it("roundUniform is deterministic and within [0,1)", () => {
    const a = roundUniform("seed", "client", 1);
    const b = roundUniform("seed", "client", 1);
    const c = roundUniform("seed", "client", 2);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
});

describe("PlaceholderRgsProvider — honors RTP over many rounds", () => {
  const provider = new PlaceholderRgsProvider();

  function simulate(gameType: GameType, rounds: number): number {
    const serverSeed = "fixed-server-seed-for-rtp-test";
    const bet = 1_000_000n;
    let totalWin = 0n;
    let totalBet = 0n;
    for (let nonce = 1; nonce <= rounds; nonce++) {
      const req: RoundRequest = {
        sessionId: "s",
        gameCode: "g",
        gameType,
        rtpBps: 9400,
        betMinor: bet,
        currency: "CREDIT",
        serverSeed,
        clientSeed: "c",
        nonce,
        config: {},
      };
      const result = provider.play(req);
      totalWin += result.winMinor;
      totalBet += bet;
    }
    return Number(totalWin) / Number(totalBet);
  }

  it("FISH (steady) converges near 94%", () => {
    const rtp = simulate("FISH", 40_000);
    expect(Math.abs(rtp - 0.94)).toBeLessThan(0.02);
  });

  it("SLOT (high variance) converges near 94%", () => {
    const rtp = simulate("SLOT", 120_000);
    expect(Math.abs(rtp - 0.94)).toBeLessThan(0.04);
  });

  it("marks every outcome demo:true and never returns negative wins", () => {
    const result = provider.play({
      sessionId: "s",
      gameCode: "g",
      gameType: "FISH",
      rtpBps: 9400,
      betMinor: 1000n,
      currency: "CREDIT",
      serverSeed: "x",
      clientSeed: "y",
      nonce: 7,
      config: {},
    });
    expect(result.outcome.demo).toBe(true);
    expect(result.winMinor >= 0n).toBe(true);
  });
});
