import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createScopedPrisma, type ScopedPrismaClient } from "@aureus/db";
import { loadEnv, type OperatorTier, type ScopeContext } from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { PasswordService } from "../../src/auth/password.service";
import { LedgerService } from "../../src/ledger/ledger.service";
import { OperatorsService } from "../../src/operators/operators.service";
import { OrdersService } from "../../src/orders/orders.service";
import { StorageService } from "../../src/storage/storage.service";
import { type AccountSelector } from "../../src/ledger/ledger.types";
import { AppError } from "../../src/common/errors/domain-error";
import { type OperatorPrincipal } from "../../src/common/auth/principal";
import { createOperator, resetDb, testPrisma } from "../helpers/db";
import { assertLedgerIntegrity } from "../helpers/ledger";

const env = loadEnv();
let scope: ScopeContext | undefined;
const scoped: ScopedPrismaClient = createScopedPrisma(testPrisma, () => scope);
const passwords = new PasswordService(env);
const audit = new AuditService(testPrisma);
const ledger = new LedgerService(testPrisma);
const storage = new StorageService(env);
const operators = new OperatorsService(scoped, testPrisma, env, passwords, audit);
const orders = new OrdersService(testPrisma, env, ledger, operators, audit, storage);

const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const op = (operatorId: string): AccountSelector => ({ kind: "operator", operatorId, currency: "CREDIT" });

function principal(node: { id?: string; operatorId?: string; userId: string; path: string; depth: number }, tier: OperatorTier): OperatorPrincipal {
  const operatorId = node.operatorId ?? node.id ?? "";
  scope = { kind: "operator", path: node.path, operatorId, tier, userId: node.userId };
  return {
    kind: "operator",
    userId: node.userId,
    operatorId,
    username: `u-${operatorId}`,
    displayName: "n",
    tier,
    path: node.path,
    depth: node.depth,
    mfaEnabled: false,
    settings: {},
    sessionId: "s",
  };
}

let rootP: OperatorPrincipal;
let distP: OperatorPrincipal;
let storeP: OperatorPrincipal;
let distId: string;
let storeId: string;

beforeEach(async () => {
  await resetDb();
  const root = await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0 });
  rootP = principal(root, "SUPER_ADMIN");
  const dist = await operators.createChild(
    rootP,
    { tier: "DISTRIBUTOR", displayName: "Dist", username: "dist", tempPassword: "Passw0rd!", buyUnitPriceCents: 8, sellUnitPriceCents: 10 },
    ctx,
  );
  distId = dist.operator.id;
  const distUser = await testPrisma.operator.findUniqueOrThrow({ where: { id: distId }, select: { userId: true } });
  distP = principal({ operatorId: distId, userId: distUser.userId, path: dist.operator.path, depth: dist.operator.depth }, "DISTRIBUTOR");
  const store = await operators.createChild(
    distP,
    { tier: "STORE", displayName: "Store", username: "store", tempPassword: "Passw0rd!", buyUnitPriceCents: 10 },
    ctx,
  );
  storeId = store.operator.id;
  const storeUser = await testPrisma.operator.findUniqueOrThrow({ where: { id: storeId }, select: { userId: true } });
  storeP = principal({ operatorId: storeId, userId: storeUser.userId, path: store.operator.path, depth: store.operator.depth }, "STORE");
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function fullCycle(buyer: OperatorPrincipal, seller: OperatorPrincipal, quantityMinor: bigint): Promise<string> {
  const order = await orders.request(buyer, { quantityMinor }, ctx);
  await orders.acknowledge(seller, order.id, ctx);
  await orders.markPaid(seller, order.id, { paymentMethod: "cash", paymentRef: "r1" }, ctx);
  const issued = await orders.issue(seller, order.id, ctx);
  expect(issued.status).toBe("ISSUED");
  expect(issued.issuedTxId).toBeTruthy();
  return order.id;
}

describe("Credit orders — fulfillment posts the ledger movement (docs/05 §3)", () => {
  it("mint-order (from super admin) issues credits to the distributor", async () => {
    const orderId = await fullCycle(distP, rootP, 5_000_000n);
    expect(await ledger.getBalance(op(distId))).toBe(5_000_000n);
    const order = await testPrisma.creditOrder.findUniqueOrThrow({ where: { id: orderId } });
    const txn = await testPrisma.ledgerTransaction.findUniqueOrThrow({ where: { id: order.issuedTxId ?? "" } });
    expect(txn.type).toBe("ISSUE");
    await assertLedgerIntegrity(testPrisma);
  });

  it("transfer-order (distributor to store) moves held credits and records margin", async () => {
    await fullCycle(distP, rootP, 5_000_000n); // fund distributor first
    const orderId = await fullCycle(storeP, distP, 100_000n);

    expect(await ledger.getBalance(op(storeId))).toBe(100_000n);
    expect(await ledger.getBalance(op(distId))).toBe(4_900_000n);

    const order = await testPrisma.creditOrder.findUniqueOrThrow({ where: { id: orderId } });
    const txn = await testPrisma.ledgerTransaction.findUniqueOrThrow({ where: { id: order.issuedTxId ?? "" } });
    expect(txn.type).toBe("TRANSFER");

    // margin recorded off-ledger: store owes dist 100 credits * 10c = 1000c
    const settlement = await testPrisma.settlement.findFirst({
      where: { operatorId: distId, counterpartyId: storeId },
    });
    expect(settlement?.netCents).toBe(1000);
    await assertLedgerIntegrity(testPrisma);
  });
});

describe("Credit orders — no movement on reject/cancel", () => {
  it("rejecting before issue moves no credits", async () => {
    const order = await orders.request(distP, { quantityMinor: 1_000_000n }, ctx);
    await orders.reject(rootP, order.id, { reason: "no payment received" }, ctx);
    const updated = await testPrisma.creditOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("CANCELLED");
    expect(updated.issuedTxId).toBeNull();
    expect(await ledger.getBalance(op(distId))).toBe(0n);
  });

  it("the buyer can cancel a pending order", async () => {
    const order = await orders.request(distP, { quantityMinor: 1_000_000n }, ctx);
    await orders.cancel(distP, order.id, ctx);
    const updated = await testPrisma.creditOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("CANCELLED");
  });

  it("an already-issued order cannot be cancelled", async () => {
    const orderId = await fullCycle(distP, rootP, 1_000_000n);
    await expect(orders.cancel(distP, orderId, ctx)).rejects.toBeInstanceOf(AppError);
  });
});

describe("Credit orders — issue is idempotent at the workflow level", () => {
  it("issuing twice does not double-apply", async () => {
    const order = await orders.request(distP, { quantityMinor: 1_000_000n }, ctx);
    await orders.acknowledge(rootP, order.id, ctx);
    await orders.markPaid(rootP, order.id, { paymentMethod: "cash" }, ctx);
    await orders.issue(rootP, order.id, ctx);
    await orders.issue(rootP, order.id, ctx); // replay
    expect(await ledger.getBalance(op(distId))).toBe(1_000_000n);
    await assertLedgerIntegrity(testPrisma);
  });
});

describe("Credit orders — proof upload presign (R2 stub)", () => {
  it("returns an upload + file URL", () => {
    const result = orders.presignProof(distP, { filename: "receipt.png" });
    expect(result.uploadUrl).toContain("stub-upload=true");
    expect(result.fileUrl).toContain(env.R2_BUCKET_ASSETS);
  });
});
