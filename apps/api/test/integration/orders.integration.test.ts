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

  it("emits order.updated to the buyer on each transition (R1)", async () => {
    const order = await orders.request(distP, { quantityMinor: 1_000_000n }, ctx);
    await orders.cancel(distP, order.id, ctx);

    const events = await testPrisma.outboxEvent.findMany({ where: { type: "order.updated" } });
    const statuses = events
      .map((e) => e.payload as { orderId: string; status: string })
      .filter((p) => p.orderId === order.id)
      .map((p) => p.status);
    expect(statuses).toContain("REQUESTED");
    expect(statuses).toContain("CANCELLED");
    expect(events.some((e) => e.rooms.includes(`operator:${distId}`))).toBe(true);
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
    expect(result.fileUrl).toContain(env.R2_BUCKET_KYC);
  });
});

describe("Credit orders — concurrent decisions are atomic", () => {
  it("concurrent issue retries post one transfer, settlement, audit, and status event", async () => {
    await fullCycle(distP, rootP, 1_000_000n);
    const order = await orders.request(storeP, { quantityMinor: 100_000n }, ctx);
    await orders.markPaid(distP, order.id, { paymentMethod: "cash" }, ctx);
    const results = await Promise.all(Array.from({ length: 12 }, () => orders.issue(distP, order.id, ctx)));
    expect(new Set(results.map((r) => r.issuedTxId)).size).toBe(1);
    expect(await ledger.getBalance(op(storeId))).toBe(100_000n);
    expect(await testPrisma.settlement.findFirst({ where: { operatorId: distId, counterpartyId: storeId } })).toMatchObject({ netCents: 1000 });
    expect(await testPrisma.auditLog.count({ where: { action: "order.issue", targetId: order.id } })).toBe(1);
    const events = await testPrisma.outboxEvent.findMany({ where: { type: "order.updated" } });
    expect(events.filter((e) => (e.payload as { orderId: string; status: string }).orderId === order.id && (e.payload as { status: string }).status === "ISSUED")).toHaveLength(1);
    await assertLedgerIntegrity(testPrisma);
  });

  it("issue and cancel cannot leave an issued balance behind a cancelled order", async () => {
    const order = await orders.request(distP, { quantityMinor: 100_000n }, ctx);
    await orders.markPaid(rootP, order.id, { paymentMethod: "cash" }, ctx);
    const results = await Promise.allSettled([
      orders.issue(rootP, order.id, ctx),
      orders.cancel(distP, order.id, ctx),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const final = await testPrisma.creditOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(["ISSUED", "CANCELLED"]).toContain(final.status);
    expect(await ledger.getBalance(op(distId))).toBe(final.status === "ISSUED" ? 100_000n : 0n);
    expect(final.issuedTxId !== null).toBe(final.status === "ISSUED");
    await assertLedgerIntegrity(testPrisma);
  });
});

describe("Credit orders — private receipt access", () => {
  it("accepts the uploader's private folder and returns an audited signed preview", async () => {
    const upload = orders.presignProof(distP, { filename: "bank-receipt.png" });
    const order = await orders.request(distP, { quantityMinor: 100_000n, proofUrl: upload.fileUrl }, ctx);
    const preview = await orders.proofDocument(rootP, order.id, ctx);
    expect(preview.url).toContain("stub-download=true");
    expect(preview.url).toContain(env.R2_BUCKET_KYC);
    expect(preview.expiresInSeconds).toBe(300);
    expect(await testPrisma.auditLog.count({ where: { action: "order.proof_view", targetId: order.id } })).toBe(1);
  });

  it("rejects external, public, and another operator's receipt URLs", async () => {
    const publicUpload = storage.presignUpload("assets", `proofs/${distId}`, "public.png");
    const otherUpload = orders.presignProof(storeP, { filename: "other.png" });
    for (const proofUrl of ["https://attacker.example/receipt.png", publicUpload.fileUrl, otherUpload.fileUrl]) {
      await expect(orders.request(distP, { quantityMinor: 100_000n, proofUrl }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    const order = await orders.request(storeP, { quantityMinor: 100_000n }, ctx);
    await expect(orders.markPaid(distP, order.id, { paymentMethod: "cash", proofUrl: otherUpload.fileUrl }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("denies a receipt preview to an operator outside its subtree", async () => {
    const upload = orders.presignProof(distP, { filename: "receipt.png" });
    const order = await orders.request(distP, { quantityMinor: 100_000n, proofUrl: upload.fileUrl }, ctx);
    const unrelated = await createOperator({ username: "outsider", tier: "STORE", pathSegment: 9 });
    await expect(orders.proofDocument(principal(unrelated, "STORE"), order.id, ctx)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(await testPrisma.auditLog.count({ where: { action: "order.proof_view", targetId: order.id } })).toBe(0);
  });
});
