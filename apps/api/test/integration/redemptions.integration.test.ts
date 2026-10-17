import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createScopedPrisma, type ScopedPrismaClient } from "@aureus/db";
import { type Env, loadEnv, type ScopeContext } from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { PasswordService } from "../../src/auth/password.service";
import { ComplianceService } from "../../src/compliance/compliance.service";
import { PlatformSettingsProvider } from "../../src/settings/platform-settings.provider";
import { AmlService } from "../../src/compliance/aml.service";
import { LedgerService } from "../../src/ledger/ledger.service";
import { OperatorsService } from "../../src/operators/operators.service";
import { RedemptionsService } from "../../src/redemptions/redemptions.service";
import { StorageService } from "../../src/storage/storage.service";
import { type OperatorPrincipal, type PlayerPrincipal } from "../../src/common/auth/principal";
import { createOperator, createPlayer, resetDb, testPrisma } from "../helpers/db";
import { assertLedgerIntegrity, assertNoOwnerNegative, assertSnapshotContinuity } from "../helpers/ledger";

const baseEnv = loadEnv();
const env: Env = { ...baseEnv, PLATFORM_MODE: "COMPLIANCE" };
const ledger = new LedgerService(testPrisma);
const audit = new AuditService(testPrisma);
const compliance = new ComplianceService(testPrisma, env, new PlatformSettingsProvider(testPrisma, env), new AmlService(testPrisma, audit));
const passwords = new PasswordService(env);
const storage = new StorageService(env);

let scope: ScopeContext | undefined;
const scoped: ScopedPrismaClient = createScopedPrisma(testPrisma, () => scope);
const operators = new OperatorsService(scoped, testPrisma, env, passwords, audit);
const redemptions = new RedemptionsService(scoped, testPrisma, env, ledger, compliance, operators, audit, storage);

const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const PRIZE = "PRIZE" as const;

function storePrincipal(node: { operatorId: string; userId: string; path: string; depth: number }): OperatorPrincipal {
  scope = { kind: "operator", path: node.path, operatorId: node.operatorId, tier: "STORE", userId: node.userId };
  return {
    kind: "operator",
    userId: node.userId,
    operatorId: node.operatorId,
    username: "store",
    displayName: "Store",
    tier: "STORE",
    path: node.path,
    depth: node.depth,
    mfaEnabled: false,
    settings: {},
    sessionId: "s",
  };
}

function playerPrincipal(playerId: string, store: { operatorId: string; path: string }): PlayerPrincipal {
  scope = { kind: "player", playerId, operatorId: store.operatorId };
  return { kind: "player", playerId, operatorId: store.operatorId, operatorPath: store.path, username: "pl", sessionId: "s" };
}

async function setup(opts: { kyc?: boolean; prize?: bigint } = {}) {
  await resetDb();
  const root = await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0 });
  const store = await createOperator({ username: "store", tier: "STORE", parent: root, pathSegment: 1 });
  const { playerId } = await createPlayer({ username: "pl", operatorId: store.operatorId });
  if (opts.kyc) {
    await testPrisma.kycRecord.create({ data: { playerId, status: "VERIFIED", level: 1, verifiedAt: new Date() } });
  }
  const prize = opts.prize ?? 1_000_000n;
  if (prize > 0n) {
    await ledger.post({
      type: "PROMO_GRANT",
      currency: PRIZE,
      idempotencyKey: `seed:${playerId}:prize`,
      allowNegative: ["PROMO"],
      actor: { playerId },
      legs: [
        { account: { kind: "system", systemKey: "PROMO", currency: PRIZE }, direction: "DEBIT", amountMinor: prize },
        { account: { kind: "player", playerId, currency: PRIZE }, direction: "CREDIT", amountMinor: prize },
      ],
    });
  }
  return { root, store, playerId };
}

async function assertInvariants(): Promise<void> {
  await assertLedgerIntegrity(testPrisma);
  await assertNoOwnerNegative(testPrisma);
}

function prizeBalance(playerId: string): Promise<bigint> {
  return ledger.getBalance({ kind: "player", playerId, currency: PRIZE });
}

function clearingBalance(): Promise<bigint> {
  return ledger.getBalance({ kind: "system", systemKey: "REDEMPTION_CLEARING", currency: PRIZE });
}

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("RedemptionsService (docs/09 Phase 8)", () => {
  beforeEach(() => {
    scope = undefined;
  });

  it("request → approve → settle drains clearing and nets to zero at each step", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const storeP = storePrincipal(store);
    const playerP = playerPrincipal(playerId, store);

    const req = await redemptions.request(playerP, { amountMinor: 200_000n, method: "cash" }, ctx);
    expect(req.status).toBe("PENDING");
    expect(await prizeBalance(playerId)).toBe(1_000_000n); // no hold yet
    await assertInvariants();

    storePrincipal(store); // re-assert operator scope for the scoped queue read
    const queued = await redemptions.queue({ limit: 50 });
    expect(queued.items.map((i) => i.id)).toContain(req.id);

    const approved = await redemptions.approve(storeP, req.id, ctx);
    expect(approved.status).toBe("APPROVED");
    expect(await prizeBalance(playerId)).toBe(800_000n);
    expect(await clearingBalance()).toBe(200_000n);
    await assertInvariants();

    const settled = await redemptions.settle(storeP, req.id, { payoutRef: "PAYOUT-1" }, ctx);
    expect(settled.status).toBe("PAID");
    expect(await clearingBalance()).toBe(0n);
    await assertInvariants();
    await assertSnapshotContinuity(testPrisma);
  });

  it("cancel after approval returns the held credits to the player", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const storeP = storePrincipal(store);
    const playerP = playerPrincipal(playerId, store);

    const req = await redemptions.request(playerP, { amountMinor: 100_000n, method: "cash" }, ctx);
    await redemptions.approve(storeP, req.id, ctx);
    expect(await prizeBalance(playerId)).toBe(900_000n);

    const cancelled = await redemptions.cancel(storeP, req.id, { reason: "changed mind" }, ctx);
    expect(cancelled.status).toBe("CANCELLED");
    expect(await prizeBalance(playerId)).toBe(1_000_000n);
    expect(await clearingBalance()).toBe(0n);
    await assertInvariants();
  });

  it("records the settlement payable at full cent precision (fractional credits, no truncation)", async () => {
    const { store, playerId } = await setup({ kyc: true });
    // 100¢ per credit; a 1.5-credit redemption owes 150¢, not 100¢.
    await testPrisma.operator.update({ where: { id: store.operatorId }, data: { sellUnitPriceCents: 100 } });
    const storeP = storePrincipal(store);
    const playerP = playerPrincipal(playerId, store);

    const req = await redemptions.request(playerP, { amountMinor: 1_500n, method: "cash" }, ctx);
    await redemptions.approve(storeP, req.id, ctx);

    const settlement = await testPrisma.settlement.findFirst({ where: { counterpartyId: playerId } });
    expect(settlement?.netCents).toBe(-150); // negative = operator owes the player
  });

  it("reject before approval moves no credits", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const storeP = storePrincipal(store);
    const playerP = playerPrincipal(playerId, store);

    const req = await redemptions.request(playerP, { amountMinor: 100_000n, method: "cash" }, ctx);
    const rejected = await redemptions.reject(storeP, req.id, { reason: "suspicious" }, ctx);
    expect(rejected.status).toBe("REJECTED");
    expect(await prizeBalance(playerId)).toBe(1_000_000n);
    await assertInvariants();
  });

  it("player can withdraw a pending request", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const playerP = playerPrincipal(playerId, store);

    const req = await redemptions.request(playerP, { amountMinor: 100_000n, method: "cash" }, ctx);
    const withdrawn = await redemptions.withdraw(playerP, req.id, {}, ctx);
    expect(withdrawn.status).toBe("CANCELLED");
    await assertInvariants();
  });

  it("blocks a request above the redeemable balance net of pending requests", async () => {
    const { store, playerId } = await setup({ kyc: true, prize: 150_000n });
    const playerP = playerPrincipal(playerId, store);

    await redemptions.request(playerP, { amountMinor: 100_000n, method: "cash" }, ctx);
    await expect(
      redemptions.request(playerP, { amountMinor: 100_000n, method: "cash" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("blocks redemption at/above the KYC threshold without verified KYC", async () => {
    const { store, playerId } = await setup({ kyc: false });
    const playerP = playerPrincipal(playerId, store);

    await expect(
      redemptions.request(playerP, { amountMinor: 60_000n, method: "cash" }, ctx),
    ).rejects.toMatchObject({ code: "KYC_REQUIRED" });
  });

  it("approval is idempotent — a replayed approve returns APPROVED and does not double-burn", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const storeP = storePrincipal(store);
    const playerP = playerPrincipal(playerId, store);

    const req = await redemptions.request(playerP, { amountMinor: 100_000n, method: "cash" }, ctx);
    await redemptions.approve(storeP, req.id, ctx);
    // A duplicate approve returns the already-approved request without a second
    // hold/payable (workflow-level idempotency, mirrors OrdersService.issue).
    const replay = await redemptions.approve(storeP, req.id, ctx);
    expect(replay.status).toBe("APPROVED");
    expect(await prizeBalance(playerId)).toBe(900_000n);
    await assertInvariants();
  });
});

describe("RedemptionsService — concurrent decisions", () => {
  it("concurrent approve retries create one hold, payable, and audit", async () => {
    const { store, playerId } = await setup({ kyc: true });
    await testPrisma.operator.update({ where: { id: store.operatorId }, data: { sellUnitPriceCents: 100 } });
    const caller = storePrincipal(store);
    const request = await redemptions.request(playerPrincipal(playerId, store), { amountMinor: 1500n, method: "cash" }, ctx);
    const results = await Promise.all(Array.from({ length: 12 }, () => redemptions.approve(caller, request.id, ctx)));
    expect(new Set(results.map((r) => r.holdTxId)).size).toBe(1);
    expect(await prizeBalance(playerId)).toBe(998_500n);
    expect(await clearingBalance()).toBe(1500n);
    expect(await testPrisma.settlement.findFirst({ where: { counterpartyId: playerId } })).toMatchObject({ netCents: -150 });
    expect(await testPrisma.auditLog.count({ where: { action: "redemption.approve", targetId: request.id } })).toBe(1);
    await assertInvariants();
  });

  it("settle versus cancel consumes only this request's hold, preserving another hold", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const caller = storePrincipal(store);
    const player = playerPrincipal(playerId, store);
    const first = await redemptions.request(player, { amountMinor: 100_000n, method: "cash" }, ctx);
    const other = await redemptions.request(player, { amountMinor: 200_000n, method: "cash" }, ctx);
    await redemptions.approve(caller, first.id, ctx);
    await redemptions.approve(caller, other.id, ctx);
    const results = await Promise.allSettled([
      redemptions.settle(caller, first.id, { payoutRef: "one-payment" }, ctx),
      redemptions.cancel(caller, first.id, {}, ctx),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const final = await testPrisma.redemptionRequest.findUniqueOrThrow({ where: { id: first.id } });
    expect(["PAID", "CANCELLED"]).toContain(final.status);
    expect(await clearingBalance()).toBe(200_000n);
    expect(await prizeBalance(playerId)).toBe(final.status === "PAID" ? 700_000n : 800_000n);
    expect(await testPrisma.ledgerTransaction.count({ where: { refId: first.id, type: { in: ["REDEEM_SETTLE", "REDEEM_CANCEL"] } } })).toBe(1);
    await redemptions.settle(caller, other.id, { payoutRef: "other-payment" }, ctx);
    expect(await clearingBalance()).toBe(0n);
    await assertInvariants();
  });

  it("concurrent requests cannot over-reserve a player's available wallet", async () => {
    const { store, playerId } = await setup({ kyc: true, prize: 150_000n });
    const player = playerPrincipal(playerId, store);
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => redemptions.request(player, { amountMinor: 100_000n, method: "cash" }, ctx)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await testPrisma.redemptionRequest.count({ where: { playerId, status: "PENDING" } })).toBe(1);
    await assertInvariants();
  });
});

describe("RedemptionsService — original payable reversal", () => {
  it("cancels once at the original price after the operator price changes", async () => {
    const { store, playerId } = await setup({ kyc: true });
    await testPrisma.operator.update({ where: { id: store.operatorId }, data: { sellUnitPriceCents: 100 } });
    const caller = storePrincipal(store);
    const request = await redemptions.request(playerPrincipal(playerId, store), { amountMinor: 1500n, method: "cash" }, ctx);
    await Promise.all(Array.from({ length: 4 }, () => redemptions.approve(caller, request.id, ctx)));
    await testPrisma.operator.update({ where: { id: store.operatorId }, data: { sellUnitPriceCents: 500 } });
    await Promise.all(Array.from({ length: 4 }, () => redemptions.cancel(caller, request.id, {}, ctx)));
    expect(await testPrisma.settlement.findFirst({ where: { counterpartyId: playerId } })).toMatchObject({ netCents: 0 });
    expect(await testPrisma.redemptionRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "CANCELLED", approvedPayableCents: 150, approvedPayableOperatorId: store.operatorId });
    expect(await testPrisma.auditLog.count({ where: { action: "redemption.cancel", targetId: request.id } })).toBe(1);
    expect(await clearingBalance()).toBe(0n);
    expect(await prizeBalance(playerId)).toBe(1_000_000n);
    await assertInvariants();
  });

  it("leaves an old unsnapshotted hold unchanged until its cash amount is reviewed", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const caller = storePrincipal(store);
    const request = await redemptions.request(playerPrincipal(playerId, store), { amountMinor: 100_000n, method: "cash" }, ctx);
    await redemptions.approve(caller, request.id, ctx);
    // Simulate an APPROVED row created before the additive migration.
    await testPrisma.redemptionRequest.update({ where: { id: request.id }, data: { approvedPayableCents: null, approvedPayableOperatorId: null } });
    await expect(redemptions.cancel(caller, request.id, {}, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await testPrisma.redemptionRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "APPROVED" });
    expect(await clearingBalance()).toBe(100_000n);
    expect(await prizeBalance(playerId)).toBe(900_000n);
    expect(await testPrisma.ledgerTransaction.count({ where: { type: "REDEEM_CANCEL", refId: request.id } })).toBe(0);
    await assertInvariants();
  });

  it("transactional approval still blocks a newly opened AML flag", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const caller = storePrincipal(store);
    const request = await redemptions.request(playerPrincipal(playerId, store), { amountMinor: 100_000n, method: "cash" }, ctx);
    await testPrisma.amlFlag.create({ data: { subjectType: "PLAYER", subjectId: playerId, ruleCode: "manual-review", severity: "HIGH", details: {} } });
    await expect(redemptions.approve(caller, request.id, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await clearingBalance()).toBe(0n);
    expect(await prizeBalance(playerId)).toBe(1_000_000n);
    await assertInvariants();
  });
});

describe("RedemptionsService — private payout receipt", () => {
  it("stores the verified private receipt and signs an audited preview", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const caller = storePrincipal(store);
    const request = await redemptions.request(playerPrincipal(playerId, store), { amountMinor: 100_000n, method: "cash" }, ctx);
    await redemptions.approve(caller, request.id, ctx);
    const upload = redemptions.presignProof(caller, "payout.png");
    const paid = await redemptions.settle(caller, request.id, { payoutRef: "cash-1", proofUrl: upload.fileUrl }, ctx);
    expect(paid.hasProof).toBe(true);
    expect(paid).not.toHaveProperty("proofUrl");
    const preview = await redemptions.proofDocument(caller, request.id, ctx);
    expect(preview.url).toContain("stub-download=true");
    expect(preview.url).toContain(env.R2_BUCKET_KYC);
    expect(preview.expiresInSeconds).toBe(300);
    expect(await testPrisma.auditLog.count({ where: { action: "redemption.proof_view", targetId: request.id } })).toBe(1);
    const outsider = await createOperator({ username: "outsider", tier: "STORE", pathSegment: 9 });
    await expect(redemptions.proofDocument(storePrincipal(outsider), request.id, ctx)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    await assertInvariants();
  });

  it("rejects a forged proof before any settlement movement", async () => {
    const { store, playerId } = await setup({ kyc: true });
    const caller = storePrincipal(store);
    const request = await redemptions.request(playerPrincipal(playerId, store), { amountMinor: 100_000n, method: "cash" }, ctx);
    await redemptions.approve(caller, request.id, ctx);
    const publicUpload = storage.presignUpload("assets", `redemptions/${caller.operatorId}`, "public.png");
    const otherUpload = storage.presignUpload("kyc", "redemptions/another-operator", "other.png");
    for (const proofUrl of ["https://attacker.example/receipt.png", publicUpload.fileUrl, otherUpload.fileUrl]) {
      await expect(redemptions.settle(caller, request.id, { payoutRef: "forged", proofUrl }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(await clearingBalance()).toBe(100_000n);
    expect(await testPrisma.redemptionRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "APPROVED", proofUrl: null });
    await assertInvariants();
  });
});
