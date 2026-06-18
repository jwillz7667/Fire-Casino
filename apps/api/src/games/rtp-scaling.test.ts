import { describe, expect, it } from "vitest";
import { scaleWinForRtp } from "./games.service";

describe("scaleWinForRtp — win-rate override scaling (P4)", () => {
  it("is a no-op when effective equals base", () => {
    expect(scaleWinForRtp(100_000n, 9400, 9400)).toBe(100_000n);
  });

  it("lowers the win proportionally below base", () => {
    // 80% target on a 94% base → ~0.8511 of the gross win.
    expect(scaleWinForRtp(94_000n, 8_000, 9_400)).toBe(80_000n);
  });

  it("raises the win proportionally above base", () => {
    expect(scaleWinForRtp(94_000n, 10_000, 9_400)).toBe(100_000n);
  });

  it("floors fractional minor units (never credits a fraction)", () => {
    // 100 * 8000 / 9400 = 85.10… → floor 85
    expect(scaleWinForRtp(100n, 8_000, 9_400)).toBe(85n);
  });

  it("keeps a zero win at zero and tolerates a zero base", () => {
    expect(scaleWinForRtp(0n, 8_000, 9_400)).toBe(0n);
    expect(scaleWinForRtp(100n, 8_000, 0)).toBe(100n);
  });
});
