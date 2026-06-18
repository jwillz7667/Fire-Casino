import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createScopedPrisma, type ScopedPrismaClient } from "@aureus/db";
import { type Currency, type Env, loadEnv, type OperatorTier, type ScopeContext } from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { PasswordService } from "../../src/auth/password.service";
import { ComplianceService } from "../../src/compliance/compliance.service";
import { PlatformSettingsProvider } from "../../src/settings/platform-settings.provider";
import { LedgerService } from "../../src/ledger/ledger.service";
import { OperatorsService } from "../../src/operators/operators.service";
import { PlayersService } from "../../src/players/players.service";
import { WalletService } from "../../src/wallet/wallet.service";
import { type AccountSelector } from "../../src/ledger/ledger.types";
import { AppError } from "../../src/common/errors/domain-error";
import { type OperatorPrincipal, type PlayerPrincipal } from "../../src/common/auth/principal";
import { createOperator, createPlayer, resetDb, testPrisma } from "../helpers/db";
import { assertLedgerIntegrity } from "../helpers/ledger";

const env = loadEnv();
const complianceEnv: Env = { ...env, PLATFORM_MODE: "COMPLIANCE" };
let scope: ScopeContext | undefined;
const scoped: ScopedPrismaClient = createScopedPrisma(testPrisma, () => scope);
const passwords = new PasswordService(env);
const audit = new AuditService(testPrisma);
const ledger = new LedgerService(testPrisma);
const compliance = new ComplianceService(testPrisma, env, new PlatformSettingsProvider(testPrisma, env));
const operators = new OperatorsService(scoped, testPrisma, env, passwords, audit);
const players = new PlayersService(scoped, testPrisma, env, passwords, operators, audit);
const walletOperator = new WalletService(testPrisma, env, ledger, compliance, operators, audit);
const walletCompliance = new WalletService(testPrisma, complianceEnv, ledger, compliance, operators, audit);

const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const sel = (kind: "operator" | "player", id: string, currency: Currency): AccountSelector =>
  kind === "operator"
    ? { kind: "operator", operatorId: id, currency }
    : { kind: "player", playerId: id, currency };

function opPrincipal(node: { operatorId: string; userId: string; path: string; depth: number }, tier: OperatorTier): OperatorPrincipal {
  scope = { kind: "operator", path: node.path, operatorId: node.operatorId, tier, userId: node.userId };
  return {
    kind: "operator",
    userId: node.userId,
    operatorId: node.operatorId,
    username: "agent",
    displayName: "n",
    tier,
    path: node.path,
    depth: node.depth,
    mfaEnabled: false,
    settings: {},
    sessionId: "s",
  };
}

function playerPrincipal(playerId: string, operatorId: string, username: string): PlayerPrincipal {
  return { kind: "player", playerId, operatorId, operatorPath: "0.0", username, sessionId: "s" };
}

async function fund(operatorId: string, currency: Currency, amount: bigint): Promise<void> {
  await ledger.post({
    type: "ISSUE",
    currency,
    idempotencyKey: `fund:${randomUUID()}`,
    allowNegative: ["MINT"],
    legs: [
      { account: { kind: "system", systemKey: "MINT", currency }, direction: "DEBIT", amountMinor: amount },
      { account: { kind: "operator", operatorId, currency }, direction: "CREDIT", amountMinor: amount },
    ],
  });
}

let storeP: OperatorPrincipal;
let storeId: string;
let playerId: string;

beforeEach(async () => {
  await resetDb();
  const store = await createOperator({ username: "store", tier: "STORE", pathSegment: 0 });
  storeId = store.operatorId;
  storeP = opPrincipal(store, "STORE");
  const player = await createPlayer({ username: "p1", operatorId: storeId });
  playerId = player.playerId;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("PlayersService.create", () => {
  it("lets a store create a player with a wallet", async () => {
    const created = await players.create(storeP, { username: "newp", tempPassword: "Passw0rd!" }, ctx);
    expect(created.operatorId).toBe(storeId);
    const wallets = await testPrisma.ledgerAccount.count({ where: { ownerType: "PLAYER", player: { username: "newp" } } });
    expect(wallets).toBe(1); // OPERATOR mode -> single CREDIT wallet
  });

  it("forbids a non-store from creating players", async () => {
    const dist = await createOperator({ username: "dist", tier: "DISTRIBUTOR", pathSegment: 1 });
    const distP = opPrincipal(dist, "DISTRIBUTOR");
    await expect(
      players.create(distP, { username: "x", tempPassword: "Passw0rd!" }, ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "FORBIDDEN");
  });
});

describe("WalletService.recharge — OPERATOR mode", () => {
  it("moves credits from the agent to the player wallet", async () => {
    await fund(storeId, "CREDIT", 1_000_000n);
    const result = await walletOperator.recharge(storeP, { playerId, amountMinor: 100_000n }, randomUUID(), ctx);
    expect(result.mode).toBe("OPERATOR");
    expect(await ledger.getBalance(sel("operator", storeId, "CREDIT"))).toBe(900_000n);
    expect(await ledger.getBalance(sel("player", playerId, "CREDIT"))).toBe(100_000n);
    await assertLedgerIntegrity(testPrisma);
  });

  it("rejects when the agent has insufficient balance", async () => {
    await fund(storeId, "CREDIT", 50_000n);
    await expect(
      walletOperator.recharge(storeP, { playerId, amountMinor: 100_000n }, randomUUID(), ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "INSUFFICIENT_FUNDS");
  });
});

describe("WalletService.removeCredits — burn, never a refund to the agent (R8)", () => {
  async function rechargedPlayer(): Promise<void> {
    await fund(storeId, "CREDIT", 1_000_000n);
    await walletOperator.recharge(storeP, { playerId, amountMinor: 300_000n }, randomUUID(), ctx);
  }

  it("debits the player and credits SINK, leaving the agent balance untouched", async () => {
    await rechargedPlayer();
    // After recharge: agent 700k, player 300k.
    const result = await walletOperator.removeCredits(
      storeP,
      { playerId, amountMinor: 120_000n, reason: "chargeback" },
      randomUUID(),
      ctx,
    );
    expect(result.removedMinor).toBe("120000");
    expect(result.currency).toBe("CREDIT");

    expect(await ledger.getBalance(sel("player", playerId, "CREDIT"))).toBe(180_000n); // player down
    expect(await ledger.getBalance(sel("operator", storeId, "CREDIT"))).toBe(700_000n); // agent UNCHANGED
    expect(await ledger.getBalance({ kind: "system", systemKey: "SINK", currency: "CREDIT" })).toBe(120_000n); // burned
    await assertLedgerIntegrity(testPrisma);
  });

  it("cannot remove more than the player holds (no negative player balance)", async () => {
    await rechargedPlayer();
    await expect(
      walletOperator.removeCredits(storeP, { playerId, amountMinor: 400_000n, reason: "too much" }, randomUUID(), ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "INSUFFICIENT_FUNDS");
    // Nothing moved.
    expect(await ledger.getBalance(sel("player", playerId, "CREDIT"))).toBe(300_000n);
    expect(await ledger.getBalance(sel("operator", storeId, "CREDIT"))).toBe(700_000n);
  });

  it("is idempotent under a replayed key", async () => {
    await rechargedPlayer();
    const key = randomUUID();
    await walletOperator.removeCredits(storeP, { playerId, amountMinor: 50_000n, reason: "r" }, key, ctx);
    await walletOperator.removeCredits(storeP, { playerId, amountMinor: 50_000n, reason: "r" }, key, ctx);
    expect(await ledger.getBalance(sel("player", playerId, "CREDIT"))).toBe(250_000n); // applied once
    expect(await ledger.getBalance({ kind: "system", systemKey: "SINK", currency: "CREDIT" })).toBe(50_000n);
  });

  it("an agent cannot remove credits from another agent's player", async () => {
    await rechargedPlayer();
    const storeB = await createOperator({ username: "storeB2", tier: "STORE", pathSegment: 2 });
    const storeBP = opPrincipal(storeB, "STORE");
    await expect(
      walletOperator.removeCredits(storeBP, { playerId, amountMinor: 10_000n, reason: "x" }, randomUUID(), ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "OUT_OF_SCOPE");
    // restore the original store as the active scope for any later assertions
    storeP = opPrincipal({ operatorId: storeId, userId: storeP.userId, path: storeP.path, depth: storeP.depth }, "STORE");
    expect(await ledger.getBalance(sel("player", playerId, "CREDIT"))).toBe(300_000n);
  });
});

describe("WalletService.recharge — COMPLIANCE mode (PLAY purchase + PRIZE bonus)", () => {
  it("credits PLAY from the agent and PRIZE from PROMO atomically", async () => {
    await fund(storeId, "PLAY", 1_000_000n);
    const result = await walletCompliance.recharge(storeP, { playerId, amountMinor: 200_000n }, randomUUID(), ctx);
    expect(result.mode).toBe("COMPLIANCE");
    expect(result.prizeBonusMinor).toBe("200000"); // 100% bonus
    expect(await ledger.getBalance(sel("player", playerId, "PLAY"))).toBe(200_000n);
    expect(await ledger.getBalance(sel("player", playerId, "PRIZE"))).toBe(200_000n);
    expect(await ledger.getBalance(sel("operator", storeId, "PLAY"))).toBe(800_000n);
    // PRIZE came from PROMO (which goes negative — it's a grant source)
    expect(await ledger.getBalance({ kind: "system", systemKey: "PROMO", currency: "PRIZE" })).toBe(-200_000n);
    await assertLedgerIntegrity(testPrisma);
  });
});

describe("PlayersService.history — unified timeline (docs/05 §4)", () => {
  it("returns the player's ledger events ordered by time", async () => {
    await fund(storeId, "CREDIT", 1_000_000n);
    await walletOperator.recharge(storeP, { playerId, amountMinor: 100_000n }, randomUUID(), ctx);

    const history = await players.history(storeP, playerId, { limit: 50 });
    expect(history.items.length).toBeGreaterThanOrEqual(1);
    const recharge = history.items.find((e) => e.kind === "ledger" && e.type === "RECHARGE");
    expect(recharge).toBeDefined();
    expect(recharge?.kind === "ledger" && recharge.amountMinor).toBe("100000");
  });
});

describe("Wallet — subtree isolation (docs/04 §7)", () => {
  it("an agent cannot recharge another agent's player", async () => {
    // store A (beforeEach, path "0") owns the player; store B is a sibling (path "1").
    const storeB = await createOperator({ username: "storeB", tier: "STORE", pathSegment: 1 });
    const storeBP = opPrincipal(storeB, "STORE");
    await fund(storeB.operatorId, "CREDIT", 1_000_000n);

    await expect(
      walletOperator.recharge(storeBP, { playerId, amountMinor: 10_000n }, randomUUID(), ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "OUT_OF_SCOPE");

    // The cross-branch player's wallet is untouched.
    expect(await ledger.getBalance(sel("player", playerId, "CREDIT"))).toBe(0n);
  });
});

describe("Wallet — recharge request and compliance gate", () => {
  it("a recharge request notifies the owning agent without moving money", async () => {
    const pp = playerPrincipal(playerId, storeId, "p1");
    await walletOperator.rechargeRequest(pp, { amountMinor: 50_000n, note: "please load" }, ctx);
    const notifications = await testPrisma.notification.count({ where: { audience: "OPERATOR" } });
    const outbox = await testPrisma.outboxEvent.count({ where: { type: "recharge.requested" } });
    expect(notifications).toBe(1);
    expect(outbox).toBeGreaterThanOrEqual(1);
    expect(await ledger.getBalance(sel("player", playerId, "CREDIT"))).toBe(0n);
  });

  it("blocks recharge for a self-excluded player", async () => {
    await fund(storeId, "CREDIT", 1_000_000n);
    await testPrisma.selfExclusion.create({ data: { playerId, until: null } });
    await expect(
      walletOperator.recharge(storeP, { playerId, amountMinor: 10_000n }, randomUUID(), ctx),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "SELF_EXCLUDED");
  });
});
