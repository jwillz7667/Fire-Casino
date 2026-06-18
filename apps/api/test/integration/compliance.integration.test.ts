import { afterAll, describe, expect, it } from "vitest";
import { loadEnv, type OperatorTier } from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { ComplianceService } from "../../src/compliance/compliance.service";
import { PlatformSettingsProvider } from "../../src/settings/platform-settings.provider";
import { GeoService } from "../../src/compliance/geo.service";
import { KycService } from "../../src/compliance/kyc.service";
import { AmlService } from "../../src/compliance/aml.service";
import { RgService } from "../../src/compliance/rg.service";
import { PromotionsService } from "../../src/compliance/promotions.service";
import { LedgerService } from "../../src/ledger/ledger.service";
import { StorageService } from "../../src/storage/storage.service";
import { type OperatorPrincipal, type PlayerPrincipal } from "../../src/common/auth/principal";
import { createOperator, createPlayer, resetDb, testPrisma } from "../helpers/db";
import { assertLedgerIntegrity, assertNoOwnerNegative } from "../helpers/ledger";

const env = loadEnv();
const audit = new AuditService(testPrisma);
const compliance = new ComplianceService(testPrisma, env, new PlatformSettingsProvider(testPrisma, env), new AmlService(testPrisma, audit));
const storage = new StorageService(env);
const ledger = new LedgerService(testPrisma);
const geo = new GeoService(testPrisma, audit);
const kyc = new KycService(testPrisma, env, audit, storage);
const aml = new AmlService(testPrisma, audit);
const rg = new RgService(testPrisma, audit);
const promotions = new PromotionsService(testPrisma, ledger, compliance, audit);

const ctx = { ip: "127.0.0.1", userAgent: "vitest" };

function operatorPrincipal(
  node: { operatorId: string; userId: string; path: string; depth: number },
  tier: OperatorTier,
): OperatorPrincipal {
  return {
    kind: "operator",
    userId: node.userId,
    operatorId: node.operatorId,
    username: "op",
    displayName: "Op",
    tier,
    path: node.path,
    depth: node.depth,
    mfaEnabled: false,
    settings: {},
    sessionId: "s",
  };
}

function playerPrincipal(playerId: string, store: { operatorId: string; path: string }): PlayerPrincipal {
  return {
    kind: "player",
    playerId,
    operatorId: store.operatorId,
    operatorPath: store.path,
    username: "pl",
    sessionId: "s",
  };
}

async function setup() {
  await resetDb();
  const root = await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0 });
  const store = await createOperator({ username: "store", tier: "STORE", parent: root, pathSegment: 1 });
  const { playerId } = await createPlayer({ username: "pl", operatorId: store.operatorId });
  return { root, store, playerId };
}

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("Compliance management (docs/09 Phase 9)", () => {
  it("upserts a geo rule with an uppercased region and removes it", async () => {
    const { root } = await setup();
    const admin = operatorPrincipal(root, "SUPER_ADMIN");

    const rule = await geo.upsert(admin, { region: "us", action: "BLOCK", reason: "test" }, ctx);
    expect(rule.region).toBe("US");
    expect(rule.action).toBe("BLOCK");
    expect((await geo.list()).map((r) => r.region)).toContain("US");

    const removed = await geo.remove(admin, "us", ctx);
    expect(removed).toMatchObject({ region: "US", removed: true });
    expect(await geo.list()).toHaveLength(0);
  });

  it("enforces a geo BLOCK rule when a region is resolved (CR1)", async () => {
    const { root, playerId } = await setup();
    const admin = operatorPrincipal(root, "SUPER_ADMIN");
    const amount = 10_000n; // below KYC threshold + no AML flag, so only geo can block

    await geo.upsert(admin, { region: "us", action: "BLOCK", reason: "test" }, ctx);

    // Region resolved + matching BLOCK rule → rejected (the prior floating `void`
    // swallowed this, so it failed open).
    await expect(compliance.checkRedeem(playerId, amount, { region: "US" })).rejects.toMatchObject({
      code: "REGION_BLOCKED",
    });
    // No region resolved → nothing to match, so it passes.
    await expect(compliance.checkRedeem(playerId, amount)).resolves.toBeUndefined();
    // A different region with no rule passes.
    await expect(compliance.checkRedeem(playerId, amount, { region: "CA" })).resolves.toBeUndefined();
  });

  it("KYC submit then verify unblocks the redemption gate above the threshold", async () => {
    const { root, store, playerId } = await setup();
    const admin = operatorPrincipal(root, "SUPER_ADMIN");
    const playerP = playerPrincipal(playerId, store);
    const amount = BigInt(env.REDEMPTION_KYC_THRESHOLD_MINOR) + 10_000n;

    await expect(compliance.checkRedeem(playerId, amount)).rejects.toMatchObject({ code: "KYC_REQUIRED" });

    await kyc.submit(
      playerP,
      playerId,
      { idType: "passport", documentUrl: "https://r2.stub.local/kyc/doc.png", level: 1 },
      ctx,
    );
    // PENDING is not VERIFIED — still blocked.
    await expect(compliance.checkRedeem(playerId, amount)).rejects.toMatchObject({ code: "KYC_REQUIRED" });

    const decided = await kyc.decision(admin, playerId, { decision: "VERIFIED" }, ctx);
    expect(decided.status).toBe("VERIFIED");
    await expect(compliance.checkRedeem(playerId, amount)).resolves.toBeUndefined();
  });

  it("enforces a responsible-gaming deposit limit at the deposit gate", async () => {
    const { store, playerId } = await setup();
    const playerP = playerPrincipal(playerId, store);

    await rg.setLimit(playerP, playerId, { type: "DEPOSIT", period: "DAILY", valueMinor: 100_000n }, ctx);

    // A prior recharge counts toward the daily window.
    await ledger.post({
      type: "RECHARGE",
      currency: "CREDIT",
      idempotencyKey: `t:${playerId}:rch`,
      allowNegative: ["MINT"],
      actor: { playerId },
      legs: [
        { account: { kind: "system", systemKey: "MINT", currency: "CREDIT" }, direction: "DEBIT", amountMinor: 60_000n },
        { account: { kind: "player", playerId, currency: "CREDIT" }, direction: "CREDIT", amountMinor: 60_000n },
      ],
    });

    await expect(compliance.checkDeposit(playerId, { amountMinor: 50_000n })).rejects.toMatchObject({
      code: "RG_LIMIT_EXCEEDED",
    });
    await expect(compliance.checkDeposit(playerId, { amountMinor: 30_000n })).resolves.toBeUndefined();
  });

  it("self-exclusion flips the account to SELF_EXCLUDED and blocks play", async () => {
    const { store, playerId } = await setup();
    const playerP = playerPrincipal(playerId, store);

    await rg.selfExclude(playerP, playerId, {}, ctx);
    const player = await testPrisma.player.findUniqueOrThrow({ where: { id: playerId } });
    expect(player.status).toBe("SELF_EXCLUDED");

    await expect(compliance.checkPlay(playerId)).rejects.toMatchObject({ code: "SELF_EXCLUDED" });
  });

  it("promo redeem grants credits through the ledger and enforces the per-player limit", async () => {
    const { root, store, playerId } = await setup();
    const admin = operatorPrincipal(root, "SUPER_ADMIN");
    const playerP = playerPrincipal(playerId, store);

    await promotions.create(
      admin,
      { code: "welcome", currency: "PLAY", grantMinor: 50_000n, isAmoe: false, perPlayerLimit: 1 },
      ctx,
    );

    const res = await promotions.redeem(playerP, { code: "welcome" }, ctx);
    expect(res.grantMinor).toBe("50000");
    expect(await ledger.getBalance({ kind: "player", playerId, currency: "PLAY" })).toBe(50_000n);
    await assertLedgerIntegrity(testPrisma);
    await assertNoOwnerNegative(testPrisma);

    // Second attempt is over the per-player cap and posts nothing.
    await expect(promotions.redeem(playerP, { code: "welcome" }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await ledger.getBalance({ kind: "player", playerId, currency: "PLAY" })).toBe(50_000n);
  });

  it("AML detection raises (and dedupes) a flag on a large redemption (CR2)", async () => {
    const { playerId } = await setup();

    await aml.screenRedemption(playerId, 5_000_000n);
    const flags = await testPrisma.amlFlag.findMany({
      where: { subjectId: playerId, ruleCode: "LARGE_REDEMPTION" },
    });
    expect(flags).toHaveLength(1);

    // The open flag now blocks redemption at the gate.
    await expect(compliance.checkRedeem(playerId, 10_000n)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Re-screening doesn't spawn a duplicate open flag.
    await aml.screenRedemption(playerId, 6_000_000n);
    expect(
      await testPrisma.amlFlag.count({ where: { subjectId: playerId, ruleCode: "LARGE_REDEMPTION", status: "OPEN" } }),
    ).toBe(1);
  });

  it("an open AML flag blocks redemption until it is resolved", async () => {
    const { root, playerId } = await setup();
    const admin = operatorPrincipal(root, "SUPER_ADMIN");
    const amount = 10_000n; // below the KYC threshold, so only AML can block

    await expect(compliance.checkRedeem(playerId, amount)).resolves.toBeUndefined();

    const flag = await aml.createFlag({
      subjectType: "PLAYER",
      subjectId: playerId,
      ruleCode: "STRUCTURING",
      severity: "HIGH",
      details: { note: "test" },
    });
    expect(flag.status).toBe("OPEN");
    const event = await testPrisma.outboxEvent.findFirst({ where: { type: "aml.flagged" } });
    expect(event?.rooms).toContain("admin:global");

    await expect(compliance.checkRedeem(playerId, amount)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await aml.resolve(admin, flag.id, { resolution: "CLEARED" }, ctx);
    await expect(compliance.checkRedeem(playerId, amount)).resolves.toBeUndefined();
  });

  it("blocks resolving an AML flag for a player outside the caller's subtree", async () => {
    await resetDb();
    const root = await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0 });
    const storeA = await createOperator({ username: "a", tier: "STORE", parent: root, pathSegment: 1 });
    const storeB = await createOperator({ username: "b", tier: "STORE", parent: root, pathSegment: 2 });
    const { playerId } = await createPlayer({ username: "pa", operatorId: storeA.operatorId });

    const flag = await aml.createFlag({
      subjectType: "PLAYER",
      subjectId: playerId,
      ruleCode: "VELOCITY",
      severity: "MEDIUM",
      details: {},
    });

    // storeB is a sibling of storeA — the player is outside its subtree.
    const outsider = operatorPrincipal(storeB, "STORE");
    await expect(aml.resolve(outsider, flag.id, { resolution: "CLEARED" }, ctx)).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    // The owning branch (root) can resolve it.
    const admin = operatorPrincipal(root, "SUPER_ADMIN");
    await expect(aml.resolve(admin, flag.id, { resolution: "CLEARED" }, ctx)).resolves.toBeDefined();
  });

  it("enforces a responsible-gaming WAGER limit at the play gate (forwarded betMinor)", async () => {
    const { store, playerId } = await setup();
    const playerP = playerPrincipal(playerId, store);

    await rg.setLimit(playerP, playerId, { type: "WAGER", period: "DAILY", valueMinor: 100_000n }, ctx);

    // Fund the player and record a prior bet so the daily wager window is non-empty.
    await ledger.post({
      type: "ISSUE",
      currency: "CREDIT",
      idempotencyKey: `t:${playerId}:fund`,
      allowNegative: ["MINT"],
      actor: { playerId },
      legs: [
        { account: { kind: "system", systemKey: "MINT", currency: "CREDIT" }, direction: "DEBIT", amountMinor: 60_000n },
        { account: { kind: "player", playerId, currency: "CREDIT" }, direction: "CREDIT", amountMinor: 60_000n },
      ],
    });
    await ledger.post({
      type: "GAME_BET",
      currency: "CREDIT",
      idempotencyKey: `t:${playerId}:bet`,
      allowNegative: ["REVENUE"],
      actor: { playerId },
      legs: [
        { account: { kind: "player", playerId, currency: "CREDIT" }, direction: "DEBIT", amountMinor: 60_000n },
        { account: { kind: "system", systemKey: "REVENUE", currency: "CREDIT" }, direction: "CREDIT", amountMinor: 60_000n },
      ],
    });

    // 60k already wagered + a 50k bet would exceed the 100k daily cap.
    await expect(compliance.checkPlay(playerId, { betMinor: 50_000n })).rejects.toMatchObject({
      code: "RG_LIMIT_EXCEEDED",
    });
    // A 30k bet stays within the cap.
    await expect(compliance.checkPlay(playerId, { betMinor: 30_000n })).resolves.toBeUndefined();
    // Without a bet amount the WAGER branch is skipped (status check still runs).
    await expect(compliance.checkPlay(playerId)).resolves.toBeUndefined();
  });
});
