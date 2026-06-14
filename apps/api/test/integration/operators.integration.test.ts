import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createScopedPrisma, type ScopedPrismaClient } from "@aureus/db";
import { loadEnv, type OperatorTier, type ScopeContext } from "@aureus/shared";
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

async function userIdOf(operatorId: string): Promise<string> {
  const o = await testPrisma.operator.findUniqueOrThrow({ where: { id: operatorId }, select: { userId: true } });
  return o.userId;
}
