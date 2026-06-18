import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createScopedPrisma, type ScopedPrismaClient } from "@aureus/db";
import {
  type Currency,
  type Env,
  loadEnv,
  type OperatorTier,
  type PlatformMode,
  redeemableCurrency,
  type ScopeContext,
} from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { PasswordService } from "../../src/auth/password.service";
import { ComplianceService } from "../../src/compliance/compliance.service";
import { PlatformSettingsProvider } from "../../src/settings/platform-settings.provider";
import { GamesService } from "../../src/games/games.service";
import { PlaceholderRgsProvider } from "../../src/games/rgs/placeholder.provider";
import { LedgerService } from "../../src/ledger/ledger.service";
import { OperatorsService } from "../../src/operators/operators.service";
import { CreditsService } from "../../src/operators/credits.service";
import { PlayersService } from "../../src/players/players.service";
import { WalletService } from "../../src/wallet/wallet.service";
import { type AccountSelector } from "../../src/ledger/ledger.types";
import { type OperatorPrincipal, type PlayerPrincipal } from "../../src/common/auth/principal";
import { createOperator, resetDb, testPrisma } from "../helpers/db";
import {
  assertLedgerIntegrity,
  assertNoOwnerNegative,
  assertSnapshotContinuity,
} from "../helpers/ledger";

const baseEnv = loadEnv();
const ledger = new LedgerService(testPrisma);
const compliance = new ComplianceService(testPrisma, baseEnv, new PlatformSettingsProvider(testPrisma, baseEnv));
const audit = new AuditService(testPrisma);
const passwords = new PasswordService(baseEnv);
const rgs = new PlaceholderRgsProvider();

let scope: ScopeContext | undefined;
const scoped: ScopedPrismaClient = createScopedPrisma(testPrisma, () => scope);

const ctx = { ip: "127.0.0.1", userAgent: "vitest" };

function opPrincipal(node: { operatorId: string; userId: string; path: string; depth: number }, tier: OperatorTier): OperatorPrincipal {
  scope = { kind: "operator", path: node.path, operatorId: node.operatorId, tier, userId: node.userId };
  return {
    kind: "operator",
    userId: node.userId,
    operatorId: node.operatorId,
    username: "u",
    displayName: "n",
    tier,
    path: node.path,
    depth: node.depth,
    mfaEnabled: false,
    settings: {},
    sessionId: "s",
  };
}

async function userIdOf(operatorId: string): Promise<string> {
  const o = await testPrisma.operator.findUniqueOrThrow({ where: { id: operatorId }, select: { userId: true } });
  return o.userId;
}

afterAll(async () => {
  await testPrisma.$disconnect();
});

async function assertInvariants(): Promise<void> {
  await assertLedgerIntegrity(testPrisma); // zero-sum + cache=derived (circulation identity)
  await assertNoOwnerNegative(testPrisma);
}

async function runLifecycle(mode: PlatformMode): Promise<void> {
  await resetDb();
  const env: Env = { ...baseEnv, PLATFORM_MODE: mode };
  const operators = new OperatorsService(scoped, testPrisma, env, passwords, audit);
  const credits = new CreditsService(testPrisma, env, ledger, operators, audit);
  const players = new PlayersService(scoped, testPrisma, env, passwords, operators, audit);
  const wallet = new WalletService(testPrisma, env, ledger, compliance, operators, audit);
  const games = new GamesService(testPrisma, rgs, ledger, compliance, audit);

  const operatorCur: Currency = mode === "COMPLIANCE" ? "PLAY" : "CREDIT";
  const playCur: Currency = mode === "COMPLIANCE" ? "PLAY" : "CREDIT";
  const redeemCur = redeemableCurrency(mode);

  const acct = (kind: "operator" | "player", id: string, currency: Currency): AccountSelector =>
    kind === "operator" ? { kind: "operator", operatorId: id, currency } : { kind: "player", playerId: id, currency };

  // a game in the (truncated) test DB
  await testPrisma.game.create({
    data: {
      code: "reef",
      name: "Reef",
      type: "FISH",
      rtpBps: 9400,
      minBetMinor: 100n,
      maxBetMinor: 5_000_000n,
      supportedCurrencies: ["CREDIT", "PLAY", "PRIZE"],
    },
  });

  // 1. tree: super admin -> distributor -> store -> player
  const root = await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0 });
  const rootP = opPrincipal(root, "SUPER_ADMIN");
  const dist = await operators.createChild(rootP, { tier: "DISTRIBUTOR", displayName: "D", username: "dist", tempPassword: "Passw0rd!" }, ctx);
  const distP = opPrincipal({ operatorId: dist.operator.id, userId: await userIdOf(dist.operator.id), path: dist.operator.path, depth: dist.operator.depth }, "DISTRIBUTOR");
  const store = await operators.createChild(distP, { tier: "STORE", displayName: "S", username: "store", tempPassword: "Passw0rd!" }, ctx);
  const storeId = store.operator.id;
  const storeP = opPrincipal({ operatorId: storeId, userId: await userIdOf(storeId), path: store.operator.path, depth: store.operator.depth }, "STORE");
  const player = await players.create(storeP, { username: "pl", tempPassword: "Passw0rd!" }, ctx);
  const playerId = player.id;
  const playerP: PlayerPrincipal = { kind: "player", playerId, operatorId: storeId, operatorPath: store.operator.path, username: "pl", sessionId: "s" };
  await assertInvariants();

  // 2. mint to distributor
  await credits.issue(rootP, { operatorId: dist.operator.id, quantityMinor: 10_000_000n }, randomUUID(), ctx);
  expect(await ledger.getBalance(acct("operator", dist.operator.id, operatorCur))).toBe(10_000_000n);
  await assertInvariants();

  // 3. transfer distributor -> store
  await credits.transfer(distP, { toOperatorId: storeId, quantityMinor: 5_000_000n }, randomUUID(), ctx);
  expect(await ledger.getBalance(acct("operator", storeId, operatorCur))).toBe(5_000_000n);
  await assertInvariants();

  // 4. recharge store -> player
  await wallet.recharge(storeP, { playerId, amountMinor: 1_000_000n }, randomUUID(), ctx);
  expect(await ledger.getBalance(acct("player", playerId, playCur))).toBe(1_000_000n);
  if (mode === "COMPLIANCE") {
    expect(await ledger.getBalance(acct("player", playerId, "PRIZE"))).toBe(1_000_000n);
  }
  await assertInvariants();

  // 5. play several rounds (server-authoritative)
  const session = await games.startSession(playerP, { gameCode: "reef", currency: playCur });
  for (let i = 0; i < 6; i++) {
    await games.placeBet(playerP, session.sessionId, 10_000n, randomUUID());
    await assertInvariants();
  }
  const revealed = await games.endSession(playerP, session.sessionId);
  expect(revealed.serverSeed).toBeTruthy();

  // 6. redeem: hold (player redeemable -> clearing) then settle (clearing -> mint)
  const redeemAmount = 100_000n;
  const redeemable = await ledger.getBalance(acct("player", playerId, redeemCur));
  expect(redeemable).toBeGreaterThanOrEqual(redeemAmount);

  await ledger.post({
    type: "REDEEM_HOLD",
    currency: redeemCur,
    idempotencyKey: `redeem:${randomUUID()}:hold`,
    actor: { playerId },
    legs: [
      { account: acct("player", playerId, redeemCur), direction: "DEBIT", amountMinor: redeemAmount },
      { account: { kind: "system", systemKey: "REDEMPTION_CLEARING", currency: redeemCur }, direction: "CREDIT", amountMinor: redeemAmount },
    ],
  });
  await assertInvariants();

  await ledger.post({
    type: "REDEEM_SETTLE",
    currency: redeemCur,
    idempotencyKey: `redeem:${randomUUID()}:settle`,
    allowNegative: ["MINT"],
    actor: { playerId },
    legs: [
      { account: { kind: "system", systemKey: "REDEMPTION_CLEARING", currency: redeemCur }, direction: "DEBIT", amountMinor: redeemAmount },
      { account: { kind: "system", systemKey: "MINT", currency: redeemCur }, direction: "CREDIT", amountMinor: redeemAmount },
    ],
  });
  await assertInvariants();

  // clearing fully drains; final integrity + snapshot continuity
  expect(await ledger.getBalance({ kind: "system", systemKey: "REDEMPTION_CLEARING", currency: redeemCur })).toBe(0n);
  await assertSnapshotContinuity(testPrisma);
}

describe("THE GATE — full credit lifecycle nets to zero (docs/09 Phase 7)", () => {
  it("issue -> transfer -> recharge -> play -> redeem in OPERATOR mode", async () => {
    await runLifecycle("OPERATOR");
  });

  it("issue -> transfer -> recharge -> play -> redeem in COMPLIANCE mode", async () => {
    await runLifecycle("COMPLIANCE");
  });
});
