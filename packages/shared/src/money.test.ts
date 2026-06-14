import { describe, expect, it } from "vitest";
import {
  MINOR,
  MINOR_DECIMALS,
  MINOR_PER_CREDIT,
  MoneyError,
  addMinor,
  assertNonNegative,
  bps,
  fromMinor,
  subMinor,
  toMinor,
  zMinor,
  zMinorOut,
  zMinorPositive,
} from "./money";

describe("scale", () => {
  it("defaults to 1000 minor units / 3 decimals", () => {
    expect(MINOR_PER_CREDIT).toBe(1000n);
    expect(MINOR).toBe(1000n);
    expect(MINOR_DECIMALS).toBe(3);
  });
});

describe("toMinor", () => {
  it("parses whole credits", () => {
    expect(toMinor("1500")).toBe(1_500_000n);
    expect(toMinor(1500)).toBe(1_500_000n);
    expect(toMinor("0")).toBe(0n);
  });

  it("parses fractional credits without float math", () => {
    expect(toMinor("12.345")).toBe(12_345n);
    expect(toMinor("0.001")).toBe(1n);
    expect(toMinor("0.1")).toBe(100n);
    expect(toMinor("1.2")).toBe(1_200n);
  });

  it("handles negatives", () => {
    expect(toMinor("-5")).toBe(-5_000n);
    expect(toMinor("-0.005")).toBe(-5n);
  });

  it("rejects precision finer than the scale", () => {
    expect(() => toMinor("1.2345")).toThrowError(MoneyError);
    try {
      toMinor("1.2345");
    } catch (e) {
      expect((e as MoneyError).code).toBe("EXCESS_PRECISION");
    }
  });

  it("rejects non-integer numeric input", () => {
    expect(() => toMinor(1.5)).toThrowError(MoneyError);
  });

  it("rejects malformed strings", () => {
    expect(() => toMinor("abc")).toThrowError(MoneyError);
    expect(() => toMinor("1,000")).toThrowError(MoneyError);
    expect(() => toMinor("")).toThrowError(MoneyError);
    expect(() => toMinor("1.")).toThrowError(MoneyError);
  });
});

describe("fromMinor", () => {
  it("formats with fixed precision", () => {
    expect(fromMinor(1_500_000n)).toBe("1500.000");
    expect(fromMinor(12_345n)).toBe("12.345");
    expect(fromMinor(1n)).toBe("0.001");
    expect(fromMinor(0n)).toBe("0.000");
  });

  it("formats negatives", () => {
    expect(fromMinor(-5_000n)).toBe("-5.000");
    expect(fromMinor(-5n)).toBe("-0.005");
  });
});

describe("round-trip", () => {
  it("toMinor ∘ fromMinor is identity over minor units", () => {
    for (const m of [0n, 1n, 999n, 1_000n, 12_345n, 1_500_000n, -7n, -1_234_567n]) {
      expect(toMinor(fromMinor(m))).toBe(m);
    }
  });
});

describe("bps", () => {
  it("applies basis points with floor division", () => {
    expect(bps(1_000_000n, 9400)).toBe(940_000n); // 94%
    expect(bps(1_000_000n, 10_000)).toBe(1_000_000n); // 100%
    expect(bps(1_000_000n, 0)).toBe(0n);
    expect(bps(1n, 9400)).toBe(0n); // floor
    expect(bps(3n, 5000)).toBe(1n); // 1.5 -> floor 1
  });

  it("rejects non-integer bps", () => {
    expect(() => bps(100n, 1.5)).toThrowError(MoneyError);
  });
});

describe("helpers", () => {
  it("addMinor/subMinor", () => {
    expect(addMinor(10n, 5n)).toBe(15n);
    expect(subMinor(10n, 5n)).toBe(5n);
  });

  it("assertNonNegative", () => {
    expect(() => assertNonNegative(0n)).not.toThrow();
    expect(() => assertNonNegative(5n)).not.toThrow();
    expect(() => assertNonNegative(-1n)).toThrowError(MoneyError);
  });
});

describe("zod boundary schemas", () => {
  it("zMinor parses integer strings and bigint to bigint", () => {
    expect(zMinor.parse("1500000")).toBe(1_500_000n);
    expect(zMinor.parse(42n)).toBe(42n);
    expect(zMinor.parse("-7")).toBe(-7n);
  });

  it("zMinor rejects decimals and junk", () => {
    expect(zMinor.safeParse("12.5").success).toBe(false);
    expect(zMinor.safeParse("abc").success).toBe(false);
  });

  it("zMinorPositive enforces > 0", () => {
    expect(zMinorPositive.parse("1")).toBe(1n);
    expect(zMinorPositive.safeParse("0").success).toBe(false);
    expect(zMinorPositive.safeParse("-1").success).toBe(false);
  });

  it("zMinorOut serializes bigint to integer string", () => {
    expect(zMinorOut.parse(1_500_000n)).toBe("1500000");
    expect(zMinorOut.parse(0n)).toBe("0");
  });
});
