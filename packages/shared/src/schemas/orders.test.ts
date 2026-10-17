import { describe, expect, it } from "vitest";
import { createOrderSchema, markOrderPaidSchema } from "./orders";
import { settleRedemptionSchema } from "./redemptions";

describe("order proof URL protocols", () => {
  it.each([
    "javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "not a URL",
  ])("rejects executable or local links: %s", (proofUrl) => {
    expect(createOrderSchema.safeParse({ quantityMinor: "1000", proofUrl }).success).toBe(false);
    expect(markOrderPaidSchema.safeParse({ paymentMethod: "bank", proofUrl }).success).toBe(false);
    expect(settleRedemptionSchema.safeParse({ payoutRef: "transfer-1", proofUrl }).success).toBe(
      false,
    );
  });
  it("preserves ordinary upload URLs", () => {
    expect(
      markOrderPaidSchema.parse({
        paymentMethod: "bank",
        proofUrl: "https://assets.example.com/proof.png",
      }).proofUrl,
    ).toBe("https://assets.example.com/proof.png");
  });
});
