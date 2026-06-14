import { describe, expect, it } from "vitest";
import { assertBalanced, type Leg, LedgerImbalanceError, selectorKey } from "./ledger.types";

function leg(direction: "DEBIT" | "CREDIT", amount: bigint): Leg {
  return {
    account: { kind: "system", systemKey: "MINT", currency: "CREDIT" },
    direction,
    amountMinor: amount,
  };
}

describe("assertBalanced (hard rule #2)", () => {
  it("accepts a balanced two-leg transaction", () => {
    expect(() => assertBalanced([leg("DEBIT", 100n), leg("CREDIT", 100n)], "CREDIT")).not.toThrow();
  });

  it("rejects an unbalanced transaction", () => {
    expect(() => assertBalanced([leg("DEBIT", 100n), leg("CREDIT", 90n)], "CREDIT")).toThrow(
      LedgerImbalanceError,
    );
  });

  it("rejects non-positive amounts", () => {
    expect(() => assertBalanced([leg("DEBIT", 0n), leg("CREDIT", 0n)], "CREDIT")).toThrow(
      LedgerImbalanceError,
    );
    expect(() => assertBalanced([leg("DEBIT", -5n), leg("CREDIT", -5n)], "CREDIT")).toThrow(
      LedgerImbalanceError,
    );
  });

  it("rejects fewer than two legs", () => {
    expect(() => assertBalanced([leg("DEBIT", 100n)], "CREDIT")).toThrow(LedgerImbalanceError);
  });

  it("rejects a leg whose currency differs from the transaction", () => {
    const mismatched: Leg = {
      account: { kind: "system", systemKey: "MINT", currency: "PLAY" },
      direction: "CREDIT",
      amountMinor: 100n,
    };
    expect(() => assertBalanced([leg("DEBIT", 100n), mismatched], "CREDIT")).toThrow(
      LedgerImbalanceError,
    );
  });

  it("balances multi-leg transactions", () => {
    expect(() =>
      assertBalanced([leg("DEBIT", 100n), leg("CREDIT", 60n), leg("CREDIT", 40n)], "CREDIT"),
    ).not.toThrow();
  });
});

describe("selectorKey", () => {
  it("is stable and distinct per owner+currency", () => {
    expect(selectorKey({ kind: "operator", operatorId: "o1", currency: "CREDIT" })).toBe(
      "op:o1:CREDIT",
    );
    expect(selectorKey({ kind: "player", playerId: "p1", currency: "PRIZE" })).toBe("pl:p1:PRIZE");
    expect(selectorKey({ kind: "system", systemKey: "MINT", currency: "PLAY" })).toBe(
      "sys:MINT:PLAY",
    );
  });
});
