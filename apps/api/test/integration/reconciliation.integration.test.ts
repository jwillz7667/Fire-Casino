import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LedgerService } from "../../src/ledger/ledger.service";
import { ReconciliationService } from "../../src/reconciliation/reconciliation.service";
import { createOperator, createPlayer, resetDb, testPrisma } from "../helpers/db";

const ledger = new LedgerService(testPrisma);
const recon = new ReconciliationService(testPrisma);
const CREDIT = "CREDIT" as const;

async function seedLedger(): Promise<{ playerId: string }> {
  await resetDb();
  const root = await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0 });
  const store = await createOperator({ username: "store", tier: "STORE", parent: root, pathSegment: 1 });
  const { playerId } = await createPlayer({ username: "pl", operatorId: store.operatorId });

  // Mint into the store, then recharge the player — two balanced, locked posts.
  await ledger.post({
    type: "ISSUE",
    currency: CREDIT,
    idempotencyKey: "recon:issue",
    allowNegative: ["MINT"],
    actor: { userId: root.userId },
    legs: [
      { account: { kind: "system", systemKey: "MINT", currency: CREDIT }, direction: "DEBIT", amountMinor: 1_000_000n },
      { account: { kind: "operator", operatorId: store.operatorId, currency: CREDIT }, direction: "CREDIT", amountMinor: 1_000_000n },
    ],
  });
  await ledger.post({
    type: "RECHARGE",
    currency: CREDIT,
    idempotencyKey: "recon:recharge",
    actor: { userId: store.userId, playerId },
    legs: [
      { account: { kind: "operator", operatorId: store.operatorId, currency: CREDIT }, direction: "DEBIT", amountMinor: 200_000n },
      { account: { kind: "player", playerId, currency: CREDIT }, direction: "CREDIT", amountMinor: 200_000n },
    ],
  });

  return { playerId };
}

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("ReconciliationService (docs/09 Phase 13)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reports every integrity check ok for a healthy ledger", async () => {
    await seedLedger();

    const result = await recon.runAll();

    expect(result.ranAt).toBeTypeOf("string");
    for (const check of result.checks) {
      expect(check.ok, `${check.name}: ${check.detail}`).toBe(true);
    }
    expect(result.checks.map((c) => c.name)).toEqual([
      "zero-sum",
      "cache-vs-derived",
      "snapshot-continuity",
      "circulation-identity",
      "settlement-sanity",
    ]);
  });

  it("flags the MINT account as negative-with-correct-sign and resolves a transaction by key", async () => {
    await seedLedger();

    const balances = await recon.systemAccountBalances();
    const mint = balances.find((b) => b.systemKey === "MINT");
    expect(mint?.expectedSign).toBe("negative");
    expect(mint?.ok).toBe(true);
    expect(mint?.balanceMinor).toBe("-1000000");

    const txn = await recon.lookupTransaction({ idempotencyKey: "recon:recharge" });
    expect(txn?.transaction.type).toBe("RECHARGE");
    expect(txn?.legs).toHaveLength(2);
  });

  it("detects cached-balance drift after a raw balance corruption", async () => {
    const { playerId } = await seedLedger();

    const account = await testPrisma.ledgerAccount.findFirstOrThrow({
      where: { ownerType: "PLAYER", playerId, currency: CREDIT },
      select: { id: true },
    });
    // Corrupt the cache directly (the kind of drift no real code path can create).
    await testPrisma.$executeRaw`UPDATE ledger_accounts SET "balanceMinor" = "balanceMinor" + 1 WHERE id = ${account.id}`;

    const result = await recon.runAll();
    const cache = result.checks.find((c) => c.name === "cache-vs-derived");
    const zeroSum = result.checks.find((c) => c.name === "zero-sum");

    expect(cache?.ok).toBe(false);
    expect(cache?.detail).toContain(account.id);
    expect(zeroSum?.ok).toBe(false);
  });
});
