import { describe, expect, it } from "vitest";
import { buildFeel, classifyWinTier, computeAnticipation } from "./feel";

describe("shared feel — win-tier classifier", () => {
  it("maps total win (bps of bet) to the right celebration tier", () => {
    expect(classifyWinTier(0)).toBe("NONE");
    expect(classifyWinTier(5_000)).toBe("NICE"); // 0.5×
    expect(classifyWinTier(99_999)).toBe("NICE"); // just under 10×
    expect(classifyWinTier(100_000)).toBe("BIG"); // 10×
    expect(classifyWinTier(249_999)).toBe("BIG");
    expect(classifyWinTier(250_000)).toBe("MEGA"); // 25×
    expect(classifyWinTier(499_999)).toBe("MEGA");
    expect(classifyWinTier(500_000)).toBe("EPIC"); // 50×+
    expect(classifyWinTier(50_000_000)).toBe("EPIC");
  });

  it("forces JACKPOT when a jackpot struck, regardless of size", () => {
    expect(classifyWinTier(0, true)).toBe("JACKPOT");
    expect(classifyWinTier(50_000_000, true)).toBe("JACKPOT");
  });
});

describe("shared feel — anticipation", () => {
  // Column-major grid: grid[reel][row]. 5 reels × 4 rows.
  const filler = (sym = "J"): string[] => [sym, sym, sym, sym];

  it("teases on the one-to-go reel when needed-1 have landed in earlier reels", () => {
    const grid = [
      ["S", "J", "J", "J"], // reel 0: 1 scatter
      ["J", "S", "J", "J"], // reel 1: 1 scatter (cumulative 2 = needed-1 before reel 2)
      filler(),
      filler(),
      filler(),
    ];
    const a = computeAnticipation(grid, "S", 3);
    expect(a.count).toBe(2);
    expect(a.reels).toEqual([0, 1]);
    expect(a.fromReel).toBe(2);
  });

  it("returns no tease when the symbol is never one-to-go", () => {
    const grid = [["S", "J", "J", "J"], filler(), filler(), filler(), filler()];
    const a = computeAnticipation(grid, "S", 3);
    expect(a.count).toBe(1);
    expect(a.fromReel).toBeNull();
  });

  it("still teases on the reel that ultimately triggers the feature", () => {
    const grid = [
      ["S", "J", "J", "J"],
      ["S", "J", "J", "J"],
      ["S", "J", "J", "J"], // triggers, but reel 2 was the live/tease reel
      filler(),
      filler(),
    ];
    const a = computeAnticipation(grid, "S", 3);
    expect(a.count).toBe(3);
    expect(a.fromReel).toBe(2);
  });
});

describe("shared feel — buildFeel aggregation", () => {
  it("keeps only teasing anticipations and flags shortfalls as near misses", () => {
    const tease = computeAnticipation(
      [["S", "J", "J", "J"], ["J", "S", "J", "J"], [..."JJJJ"], [..."JJJJ"], [..."JJJJ"]],
      "S",
      3,
    );
    const quiet = computeAnticipation(
      [["B", "J", "J", "J"], [..."JJJJ"], [..."JJJJ"], [..."JJJJ"], [..."JJJJ"]],
      "B",
      3,
    );
    const feel = buildFeel({ totalWinBps: 0, anticipation: [tease, quiet] });

    expect(feel.winTier).toBe("NONE");
    expect(feel.anticipation).toHaveLength(1); // quiet "B" dropped (never teased)
    expect(feel.anticipation[0]!.symbol).toBe("S");
    expect(feel.nearMiss).toHaveLength(1);
    expect(feel.nearMiss[0]).toEqual({ symbol: "S", count: 2, needed: 3 });
  });

  it("does not flag a near miss when the teased feature actually triggered", () => {
    const triggered = computeAnticipation(
      [["S", "J", "J", "J"], ["S", "J", "J", "J"], ["S", "J", "J", "J"], [..."JJJJ"], [..."JJJJ"]],
      "S",
      3,
    );
    const feel = buildFeel({ totalWinBps: 120_000, anticipation: [triggered] });

    expect(feel.winTier).toBe("BIG");
    expect(feel.anticipation).toHaveLength(1);
    expect(feel.nearMiss).toHaveLength(0);
  });
});
