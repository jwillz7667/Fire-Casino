import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createScopedPrisma, type ScopedPrismaClient } from "@aureus/db";
import { can, loadEnv, type OperatorTier, type ScopeContext } from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { PasswordService } from "../../src/auth/password.service";
import { LedgerService } from "../../src/ledger/ledger.service";
import { CreditsService } from "../../src/operators/credits.service";
import { OperatorsService } from "../../src/operators/operators.service";
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
const operators = new OperatorsService(scoped, testPrisma, env, passwords, audit);
const credits = new CreditsService(testPrisma, env, ledger, operators, audit);

const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const op = (operatorId: string): AccountSelector => ({ kind: "operator", operatorId, currency: "CREDIT" });

function principal(
  node: { id?: string; operatorId?: string; userId: string; path: string; depth: number },
  tier: OperatorTier,
): OperatorPrincipal {
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

beforeEach(async () => {
  await resetDb();
  const root = await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0 });
  rootP = principal(root, "SUPER_ADMIN");
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("OperatorsService.createChild — tier & scope rules (docs/04)", () => {
  it("creates a child one tier below with a materialized path", async () => {
    const { operator } = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "Dist", username: "dist", tempPassword: "Passw0rd!" },
      ctx,
    );
    expect(operator.tier).toBe("DISTRIBUTOR");
    expect(operator.path).toBe("0.1");
    expect(operator.depth).toBe(1);
  });

  it("rejects creating a child of equal or higher rank", async () => {
    const dist = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "Dist", username: "dist", tempPassword: "Passw0rd!" },
      ctx,
    );
    const distP = principal({ ...dist.operator, userId: "x" }, "DISTRIBUTOR");
    await expect(
      operators.createChild(
        distP,
        { tier: "DISTRIBUTOR", displayName: "Peer", username: "peer", tempPassword: "Passw0rd!" },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
  });

  it("rejects a parent outside the caller's subtree", async () => {
    const distA = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "A", username: "distA", tempPassword: "Passw0rd!" },
      ctx,
    );
    const distB = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "B", username: "distB", tempPassword: "Passw0rd!" },
      ctx,
    );
    const distBP = principal({ ...distB.operator, userId: "x" }, "DISTRIBUTOR");
    await expect(
      operators.createChild(
        distBP,
        { tier: "STORE", displayName: "S", username: "s", tempPassword: "Passw0rd!", parentId: distA.operator.id },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "OUT_OF_SCOPE");
  });
});

describe("Credits — issue and transfer down the chain (docs/03 §4.1–4.2)", () => {
  it("mints to a child and transfers to a direct child; ledger reconciles", async () => {
    const dist = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "Dist", username: "dist", tempPassword: "Passw0rd!" },
      ctx,
    );
    const distNode = { operatorId: dist.operator.id, userId: (await userIdOf(dist.operator.id)), path: dist.operator.path, depth: dist.operator.depth };
    const distP = principal(distNode, "DISTRIBUTOR");
    const store = await operators.createChild(
      distP,
      { tier: "STORE", displayName: "Store", username: "store", tempPassword: "Passw0rd!" },
      ctx,
    );

    await credits.issue(rootP, { operatorId: dist.operator.id, quantityMinor: 1_000_000n }, randomUUID(), ctx);
    expect(await ledger.getBalance(op(dist.operator.id))).toBe(1_000_000n);

    await credits.transfer(distP, { toOperatorId: store.operator.id, quantityMinor: 400_000n, unitPriceCents: 1 }, randomUUID(), ctx);
    expect(await ledger.getBalance(op(dist.operator.id))).toBe(600_000n);
    expect(await ledger.getBalance(op(store.operator.id))).toBe(400_000n);

    await assertLedgerIntegrity(testPrisma);

    // a settlement row records the off-ledger cash owed (margin/reporting only)
    const settlement = await testPrisma.settlement.findFirst({ where: { counterpartyId: store.operator.id } });
    expect(settlement?.netCents).toBe(400); // 400 credits * 1 cent
  });

  it("rejects transferring to a non-direct child", async () => {
    const dist = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "Dist", username: "dist", tempPassword: "Passw0rd!" },
      ctx,
    );
    const distP = principal({ operatorId: dist.operator.id, userId: await userIdOf(dist.operator.id), path: dist.operator.path, depth: dist.operator.depth }, "DISTRIBUTOR");
    const store = await operators.createChild(
      distP,
      { tier: "STORE", displayName: "Store", username: "store", tempPassword: "Passw0rd!" },
      ctx,
    );
    await credits.issue(rootP, { operatorId: dist.operator.id, quantityMinor: 1_000_000n }, randomUUID(), ctx);
    // root -> store is a grandchild, not a direct child of root
    await expect(
      credits.transfer(rootP, { toOperatorId: store.operator.id, quantityMinor: 100_000n }, randomUUID(), ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
  });
});

describe("Suspend cascade & close (docs/04 §4)", () => {
  it("a suspended ancestor freezes actions in the subtree", async () => {
    const dist = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "Dist", username: "dist", tempPassword: "Passw0rd!" },
      ctx,
    );
    const distP = principal({ operatorId: dist.operator.id, userId: await userIdOf(dist.operator.id), path: dist.operator.path, depth: dist.operator.depth }, "DISTRIBUTOR");
    const store = await operators.createChild(
      distP,
      { tier: "STORE", displayName: "Store", username: "store", tempPassword: "Passw0rd!" },
      ctx,
    );
    // root suspends the distributor
    await operators.suspend(rootP, dist.operator.id, ctx);
    // creating under the (frozen) store now fails
    const storeP = principal({ operatorId: store.operator.id, userId: await userIdOf(store.operator.id), path: store.operator.path, depth: store.operator.depth }, "STORE");
    await expect(
      operators.createChild(
        storeP,
        { tier: "STORE", displayName: "X", username: "x", tempPassword: "Passw0rd!" },
        ctx,
      ),
    ).rejects.toBeInstanceOf(AppError);
    // issuing to the frozen distributor also fails
    await expect(
      credits.issue(rootP, { operatorId: dist.operator.id, quantityMinor: 1_000n }, randomUUID(), ctx),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("close blocks on children and on non-zero balance", async () => {
    const dist = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "Dist", username: "dist", tempPassword: "Passw0rd!" },
      ctx,
    );
    const distP = principal({ operatorId: dist.operator.id, userId: await userIdOf(dist.operator.id), path: dist.operator.path, depth: dist.operator.depth }, "DISTRIBUTOR");
    const store = await operators.createChild(
      distP,
      { tier: "STORE", displayName: "Store", username: "store", tempPassword: "Passw0rd!" },
      ctx,
    );
    // dist has a child -> cannot close
    await expect(operators.close(rootP, dist.operator.id, ctx)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "CONFLICT",
    );
    // fund the store -> cannot close (non-zero balance)
    await credits.issue(rootP, { operatorId: dist.operator.id, quantityMinor: 1_000n }, randomUUID(), ctx);
    await credits.transfer(distP, { toOperatorId: store.operator.id, quantityMinor: 1_000n }, randomUUID(), ctx);
    await expect(operators.close(rootP, store.operator.id, ctx)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "CONFLICT",
    );
  });
});

describe("Permission grants — no self-escalation (docs/04 §3, security B1)", () => {
  async function settingsOf(operatorId: string): Promise<{ permissions?: string[] } | null> {
    const o = await testPrisma.operator.findUniqueOrThrow({
      where: { id: operatorId },
      select: { settings: true },
    });
    return o.settings as { permissions?: string[] } | null;
  }

  async function makeDistributor(): Promise<OperatorPrincipal> {
    const dist = await operators.createChild(
      rootP,
      { tier: "DISTRIBUTOR", displayName: "Dist", username: "dist", tempPassword: "Passw0rd!" },
      ctx,
    );
    return principal(
      { operatorId: dist.operator.id, userId: await userIdOf(dist.operator.id), path: dist.operator.path, depth: dist.operator.depth },
      "DISTRIBUTOR",
    );
  }

  it("a distributor cannot grant permissions to its own node", async () => {
    const distP = await makeDistributor();
    await expect(
      operators.setGrants(distP, distP.operatorId, ["redemption.approve"], ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
  });

  it("a distributor cannot grant credit.mint to a descendant (super-admin-only)", async () => {
    const distP = await makeDistributor();
    const store = await operators.createChild(
      distP,
      { tier: "STORE", displayName: "S", username: "store", tempPassword: "Passw0rd!" },
      ctx,
    );
    await expect(
      operators.setGrants(distP, store.operator.id, ["credit.mint"], ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
    expect(can("STORE", await settingsOf(store.operator.id), "credit.mint")).toBe(false);
  });

  it("a distributor cannot grant a permission it does not itself hold", async () => {
    const distP = await makeDistributor();
    const store = await operators.createChild(
      distP,
      { tier: "STORE", displayName: "S", username: "store", tempPassword: "Passw0rd!" },
      ctx,
    );
    // DISTRIBUTOR lacks redemption.approve in its base set and has no grant.
    await expect(
      operators.setGrants(distP, store.operator.id, ["redemption.approve"], ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
  });

  it("a super admin can grant credit.mint to a descendant and it takes effect", async () => {
    const admin = await operators.createChild(
      rootP,
      { tier: "ADMIN", displayName: "Adm", username: "adm", tempPassword: "Passw0rd!" },
      ctx,
    );
    await operators.setGrants(rootP, admin.operator.id, ["credit.mint"], ctx);
    expect(can("ADMIN", await settingsOf(admin.operator.id), "credit.mint")).toBe(true);

    const logged = await testPrisma.auditLog.findFirst({
      where: { action: "operator.set_grants", targetId: admin.operator.id },
    });
    expect(logged).not.toBeNull();
  });

  it("the generic settings write cannot smuggle a permission grant", async () => {
    const distP = await makeDistributor();
    // A direct (bypassing the zod boundary) attempt to set permissions via settings.
    await operators.update(
      rootP,
      distP.operatorId,
      { settings: { permissions: ["credit.mint"], locale: "en" } as never },
      ctx,
    );
    const settings = await settingsOf(distP.operatorId);
    expect(settings?.permissions).toBeUndefined();
    expect(can("DISTRIBUTOR", settings, "credit.mint")).toBe(false);
    expect((settings as { locale?: string } | null)?.locale).toBe("en");
  });
});

async function userIdOf(operatorId: string): Promise<string> {
  const o = await testPrisma.operator.findUniqueOrThrow({ where: { id: operatorId }, select: { userId: true } });
  return o.userId;
}

describe("Credits — atomic reporting and audit", () => {
  async function makeTransferTree() {
    const dist = await createOperator({ username: "atomic-dist", tier: "DISTRIBUTOR", parent: { id: rootP.operatorId, path: rootP.path, depth: rootP.depth }, pathSegment: 1 });
    const store = await createOperator({ username: "atomic-store", tier: "STORE", parent: dist, pathSegment: 1 });
    const seller = principal(dist, "DISTRIBUTOR");
    await credits.issue(rootP, { operatorId: dist.id, quantityMinor: 1_000_000n }, randomUUID(), ctx);
    return { dist, store, seller };
  }

  it("rolls back an issue if its audit fails, then retries without losing or duplicating credits", async () => {
    const target = await createOperator({ username: "target", tier: "DISTRIBUTOR", parent: { id: rootP.operatorId, path: rootP.path, depth: rootP.depth }, pathSegment: 1 });
    const key = randomUUID();
    const auditFailure = vi.spyOn(audit, "record").mockRejectedValueOnce(new Error("audit unavailable"));
    try {
      await expect(credits.issue(rootP, { operatorId: target.id, quantityMinor: 100_000n }, key, ctx)).rejects.toThrow("audit unavailable");
    } finally {
      auditFailure.mockRestore();
    }
    expect(await ledger.getBalance(op(target.id))).toBe(0n);
    expect(await testPrisma.ledgerTransaction.count({ where: { idempotencyKey: `issue:${rootP.operatorId}:${key}` } })).toBe(0);
    expect(await testPrisma.outboxEvent.count({ where: { type: "balance.changed" } })).toBe(0);
    await credits.issue(rootP, { operatorId: target.id, quantityMinor: 100_000n }, key, ctx);
    await credits.issue(rootP, { operatorId: target.id, quantityMinor: 100_000n }, key, ctx);
    expect(await ledger.getBalance(op(target.id))).toBe(100_000n);
    expect(await testPrisma.auditLog.count({ where: { action: "ledger.issue", targetId: target.id } })).toBe(1);
    await assertLedgerIntegrity(testPrisma);
  });

  it("rolls back transfer, cash position, and balance events if the audit write fails", async () => {
    const { dist, store, seller } = await makeTransferTree();
    const key = randomUUID();
    const eventsBefore = await testPrisma.outboxEvent.count();
    const auditFailure = vi.spyOn(audit, "record").mockRejectedValueOnce(new Error("audit unavailable"));
    try {
      await expect(credits.transfer(seller, { toOperatorId: store.id, quantityMinor: 100_000n, unitPriceCents: 7 }, key, ctx)).rejects.toThrow("audit unavailable");
    } finally {
      auditFailure.mockRestore();
    }
    expect(await ledger.getBalance(op(dist.id))).toBe(1_000_000n);
    expect(await ledger.getBalance(op(store.id))).toBe(0n);
    expect(await testPrisma.settlement.count({ where: { operatorId: dist.id, counterpartyId: store.id } })).toBe(0);
    expect(await testPrisma.ledgerTransaction.count({ where: { idempotencyKey: `transfer:${dist.id}:${key}` } })).toBe(0);
    expect(await testPrisma.outboxEvent.count()).toBe(eventsBefore);
    const retry = await credits.transfer(seller, { toOperatorId: store.id, quantityMinor: 100_000n, unitPriceCents: 7 }, key, ctx);
    expect(retry.replayed).toBe(false);
    expect(await ledger.getBalance(op(store.id))).toBe(100_000n);
    expect(await testPrisma.settlement.findFirst({ where: { operatorId: dist.id, counterpartyId: store.id } })).toMatchObject({ netCents: 700 });
    expect(await testPrisma.auditLog.count({ where: { action: "ledger.transfer", targetId: store.id } })).toBe(1);
    await assertLedgerIntegrity(testPrisma);
  });

  it("concurrent same-key transfers keep the first committed price and one cash position", async () => {
    const { dist, store, seller } = await makeTransferTree();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => credits.transfer(seller, { toOperatorId: store.id, quantityMinor: 100_000n, unitPriceCents: i + 1 }, key, ctx)));
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
    const audits = await testPrisma.auditLog.findMany({ where: { action: "ledger.transfer", targetId: store.id } });
    expect(audits).toHaveLength(1);
    const agreedPrice = (audits[0]?.after as { unitPriceCents: number }).unitPriceCents;
    expect(agreedPrice).toBeGreaterThanOrEqual(1);
    expect(agreedPrice).toBeLessThanOrEqual(12);
    expect(await testPrisma.settlement.findFirst({ where: { operatorId: dist.id, counterpartyId: store.id } })).toMatchObject({ netCents: 100 * agreedPrice });
    expect(await ledger.getBalance(op(dist.id))).toBe(900_000n);
    expect(await ledger.getBalance(op(store.id))).toBe(100_000n);
    await assertLedgerIntegrity(testPrisma);
  });
});
