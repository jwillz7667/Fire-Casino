import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Currency } from "@aureus/shared";
import { LedgerService } from "../../src/ledger/ledger.service";
import { type AccountSelector } from "../../src/ledger/ledger.types";
import { AppError } from "../../src/common/errors/domain-error";
import { createOperator, createPlayer, resetDb, testPrisma } from "../helpers/db";
import { assertLedgerIntegrity, assertSnapshotContinuity } from "../helpers/ledger";

const ledger = new LedgerService(testPrisma);

const mint = (currency: Currency = "CREDIT"): AccountSelector => ({
  kind: "system",
  systemKey: "MINT",
  currency,
});
const promo = (currency: Currency): AccountSelector => ({
  kind: "system",
  systemKey: "PROMO",
  currency,
});
const op = (operatorId: string, currency: Currency = "CREDIT"): AccountSelector => ({
  kind: "operator",
  operatorId,
  currency,
});
const pl = (playerId: string, currency: Currency = "CREDIT"): AccountSelector => ({
  kind: "player",
  playerId,
  currency,
});

let operatorId: string;
let playerId: string;

async function issueToOperator(amount: bigint, currency: Currency = "CREDIT"): Promise<void> {
  await ledger.post({
    type: "ISSUE",
    currency,
    idempotencyKey: `issue:${randomUUID()}`,
    allowNegative: ["MINT"],
    legs: [
      { account: mint(currency), direction: "DEBIT", amountMinor: amount },
      { account: op(operatorId, currency), direction: "CREDIT", amountMinor: amount },
    ],
  });
}

beforeEach(async () => {
  await resetDb();
  const store = await createOperator({ username: "store", tier: "STORE", pathSegment: 0 });
  operatorId = store.operatorId;
  const player = await createPlayer({ username: "player", operatorId });
  playerId = player.playerId;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("LedgerService.post — invariants", () => {
  it("issues credits and nets to zero", async () => {
    await issueToOperator(1_000_000n);
    expect(await ledger.getBalance(op(operatorId))).toBe(1_000_000n);
    expect(await ledger.getBalance(mint())).toBe(-1_000_000n);
    await assertLedgerIntegrity(testPrisma);
  });

  it("enforces non-negative balances on owner accounts", async () => {
    await issueToOperator(1_000_000n);
    await expect(
      ledger.post({
        type: "RECHARGE",
        currency: "CREDIT",
        idempotencyKey: `recharge:${randomUUID()}`,
        legs: [
          { account: op(operatorId), direction: "DEBIT", amountMinor: 2_000_000n },
          { account: pl(playerId), direction: "CREDIT", amountMinor: 2_000_000n },
        ],
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "INSUFFICIENT_FUNDS");
    // balance unchanged
    expect(await ledger.getBalance(op(operatorId))).toBe(1_000_000n);
    await assertLedgerIntegrity(testPrisma);
  });

  it("rejects an unbalanced transaction", async () => {
    await expect(
      ledger.post({
        type: "ADJUSTMENT",
        currency: "CREDIT",
        idempotencyKey: `bad:${randomUUID()}`,
        legs: [
          { account: mint(), direction: "DEBIT", amountMinor: 100n },
          { account: op(operatorId), direction: "CREDIT", amountMinor: 90n },
        ],
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("LedgerService.post — idempotency", () => {
  it("replays a duplicate idempotency key without double-applying", async () => {
    await issueToOperator(1_000_000n);
    const key = `recharge:${randomUUID()}`;
    const input = {
      type: "RECHARGE" as const,
      currency: "CREDIT" as const,
      idempotencyKey: key,
      legs: [
        { account: op(operatorId), direction: "DEBIT" as const, amountMinor: 100_000n },
        { account: pl(playerId), direction: "CREDIT" as const, amountMinor: 100_000n },
      ],
    };
    const first = await ledger.post(input);
    const second = await ledger.post(input);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await ledger.getBalance(pl(playerId))).toBe(100_000n); // applied once
    await assertLedgerIntegrity(testPrisma);
  });

  it("collapses concurrent posts sharing one idempotency key to a single apply", async () => {
    await issueToOperator(1_000_000n);
    const key = `recharge:${randomUUID()}`;
    const input = {
      type: "RECHARGE" as const,
      currency: "CREDIT" as const,
      idempotencyKey: key,
      legs: [
        { account: op(operatorId), direction: "DEBIT" as const, amountMinor: 50_000n },
        { account: pl(playerId), direction: "CREDIT" as const, amountMinor: 50_000n },
      ],
    };
    await Promise.all(Array.from({ length: 5 }, () => ledger.post(input)));
    expect(await ledger.getBalance(pl(playerId))).toBe(50_000n);
    const txns = await testPrisma.ledgerTransaction.count({ where: { idempotencyKey: key } });
    expect(txns).toBe(1);
    await assertLedgerIntegrity(testPrisma);
  });
});

describe("LedgerService.post — concurrency (docs/03 §6)", () => {
  it("serializes concurrent debits on one account with no lost updates or negatives", async () => {
    await issueToOperator(1_000n);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        ledger.post({
          type: "RECHARGE",
          currency: "CREDIT",
          idempotencyKey: `recharge:${randomUUID()}`,
          legs: [
            { account: op(operatorId), direction: "DEBIT", amountMinor: 100n },
            { account: pl(playerId), direction: "CREDIT", amountMinor: 100n },
          ],
        }),
      ),
    );
    expect(await ledger.getBalance(op(operatorId))).toBe(0n);
    expect(await ledger.getBalance(pl(playerId))).toBe(1_000n);
    await assertLedgerIntegrity(testPrisma);
  });
});

describe("LedgerService.postBatch — multi-currency (compliance recharge)", () => {
  it("posts a PLAY purchase and a PRIZE bonus atomically", async () => {
    await issueToOperator(1_000_000n, "PLAY");
    const results = await ledger.postBatch(
      [
        {
          type: "RECHARGE",
          currency: "PLAY",
          idempotencyKey: `recharge:${randomUUID()}:play`,
          legs: [
            { account: op(operatorId, "PLAY"), direction: "DEBIT", amountMinor: 200_000n },
            { account: pl(playerId, "PLAY"), direction: "CREDIT", amountMinor: 200_000n },
          ],
        },
        {
          type: "PROMO_GRANT",
          currency: "PRIZE",
          idempotencyKey: `recharge:${randomUUID()}:prize`,
          allowNegative: ["PROMO"],
          legs: [
            { account: promo("PRIZE"), direction: "DEBIT", amountMinor: 20_000n },
            { account: pl(playerId, "PRIZE"), direction: "CREDIT", amountMinor: 20_000n },
          ],
        },
      ],
      { memo: "compliance recharge" },
    );
    expect(results).toHaveLength(2);
    expect(await ledger.getBalance(pl(playerId, "PLAY"))).toBe(200_000n);
    expect(await ledger.getBalance(pl(playerId, "PRIZE"))).toBe(20_000n);
    await assertLedgerIntegrity(testPrisma);
  });
});

describe("LedgerService — snapshot continuity (docs/03 §7.3)", () => {
  it("each entry's balanceAfter matches the running sum", async () => {
    await issueToOperator(1_000_000n);
    for (let i = 0; i < 5; i++) {
      await ledger.post({
        type: "RECHARGE",
        currency: "CREDIT",
        idempotencyKey: `recharge:${randomUUID()}`,
        legs: [
          { account: op(operatorId), direction: "DEBIT", amountMinor: 10_000n },
          { account: pl(playerId), direction: "CREDIT", amountMinor: 10_000n },
        ],
      });
    }
    await assertSnapshotContinuity(testPrisma);
    await assertLedgerIntegrity(testPrisma);
  });
});
