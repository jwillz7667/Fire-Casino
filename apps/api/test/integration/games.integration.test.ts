import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@aureus/shared";
import { AuditService } from "../../src/audit/audit.service";
import { type PlayerPrincipal } from "../../src/common/auth/principal";
import { AmlService } from "../../src/compliance/aml.service";
import { ComplianceService } from "../../src/compliance/compliance.service";
import { GamesService } from "../../src/games/games.service";
import { type GameProvider } from "../../src/games/rgs/provider";
import { LedgerService } from "../../src/ledger/ledger.service";
import { ReconciliationService } from "../../src/reconciliation/reconciliation.service";
import { PlatformSettingsProvider } from "../../src/settings/platform-settings.provider";
import { createOperator, createPlayer, resetDb, testPrisma } from "../helpers/db";
import { assertLedgerIntegrity, assertNoOwnerNegative } from "../helpers/ledger";

const env = loadEnv();
const ledger = new LedgerService(testPrisma);
const audit = new AuditService(testPrisma);
const compliance = new ComplianceService(testPrisma, env, new PlatformSettingsProvider(testPrisma, env), new AmlService(testPrisma, audit));
const play = vi.fn<GameProvider["play"]>(() => ({ winMinor: 9400n, outcome: { kind: "test-win" } }));
const games = new GamesService(testPrisma, { play }, ledger, compliance, audit);
let player: PlayerPrincipal;
let gameId: string;

beforeEach(async () => {
  await resetDb();
  play.mockReset();
  play.mockReturnValue({ winMinor: 9400n, outcome: { kind: "test-win" } });
  const store = await createOperator({ username: "store", tier: "STORE", pathSegment: 0 });
  const created = await createPlayer({ username: "player", operatorId: store.id });
  player = { kind: "player", playerId: created.playerId, operatorId: store.id, operatorPath: store.path, username: "player", sessionId: "auth-session" };
  const game = await testPrisma.game.create({ data: { code: "test", name: "Test", type: "SLOT", rtpBps: 9400, minBetMinor: 100n, maxBetMinor: 100_000n, supportedCurrencies: ["CREDIT"] } });
  gameId = game.id;
  await ledger.post({
    type: "ISSUE", currency: "CREDIT", idempotencyKey: "fund-player", allowNegative: ["MINT"],
    legs: [
      { account: { kind: "system", systemKey: "MINT", currency: "CREDIT" }, direction: "DEBIT", amountMinor: 100_000n },
      { account: { kind: "player", playerId: player.playerId, currency: "CREDIT" }, direction: "CREDIT", amountMinor: 100_000n },
    ],
  });
});

afterAll(async () => { await testPrisma.$disconnect(); });

async function assertInvariants() {
  await assertLedgerIntegrity(testPrisma);
  await assertNoOwnerNegative(testPrisma);
  const result = await new ReconciliationService(testPrisma).runAll();
  expect(result.checks.filter((check) => !check.ok)).toEqual([]);
}

describe("Game rounds — atomic concurrent settlement", () => {
  it("concurrent identical bets debit, credit, and increment session totals once", async () => {
    const session = await games.startSession(player, { gameCode: "test", currency: "CREDIT" });
    const responses = await Promise.all(Array.from({ length: 12 }, () => games.placeBet(player, session.sessionId, 10_000n, "same-bet")));
    expect(new Set(responses.map((r) => r.round.id)).size).toBe(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(await testPrisma.gameRound.count({ where: { sessionId: session.sessionId } })).toBe(1);
    expect(await testPrisma.gameSession.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject({ totalBetMinor: 10_000n, totalWinMinor: 9400n });
    expect(await ledger.getBalance({ kind: "player", playerId: player.playerId, currency: "CREDIT" })).toBe(99_400n);
    await assertInvariants();
  });

  it("provider failure rolls back the bet and shell, and the retry credits the new result exactly", async () => {
    const session = await games.startSession(player, { gameCode: "test", currency: "CREDIT" });
    play.mockImplementationOnce(() => { throw new Error("provider unavailable"); });
    await expect(games.placeBet(player, session.sessionId, 10_000n, "retry")).rejects.toThrow("provider unavailable");
    expect(await testPrisma.gameRound.count()).toBe(0);
    expect(await testPrisma.ledgerTransaction.count({ where: { type: "GAME_BET" } })).toBe(0);
    expect(await ledger.getBalance({ kind: "player", playerId: player.playerId, currency: "CREDIT" })).toBe(100_000n);
    await testPrisma.gameRtpOverride.create({ data: { gameId, operatorId: player.operatorId, playerId: player.playerId, rtpBps: 8000, setByUserId: "test" } });
    const settled = await games.placeBet(player, session.sessionId, 10_000n, "retry");
    expect(settled.round).toMatchObject({ winMinor: "8000", grossWinMinor: "9400", effectiveRtpBps: 8000, baseRtpBps: 9400 });
    expect(settled.balanceAfterMinor).toBe("98000");
    await assertInvariants();
  });

  it("completed replay keeps original payout provenance after game changes and seed reveal", async () => {
    const session = await games.startSession(player, { gameCode: "test", currency: "CREDIT" });
    const first = await games.placeBet(player, session.sessionId, 10_000n, "original");
    await testPrisma.game.update({ where: { id: gameId }, data: { rtpBps: 8000, config: { altered: true } } });
    await testPrisma.gameRtpOverride.create({ data: { gameId, operatorId: player.operatorId, playerId: player.playerId, rtpBps: 10000, setByUserId: "test" } });
    await games.endSession(player, session.sessionId);
    const replay = await games.placeBet(player, session.sessionId, 50_000n, "original");
    expect(replay).toEqual(first);
    expect(play).toHaveBeenCalledTimes(1);
    await expect(games.placeBet(player, session.sessionId, 10_000n, "after-reveal")).rejects.toMatchObject({ code: "CONFLICT" });
    await assertInvariants();
  });

  it("a concurrent seed reveal leaves either a fully settled round or no round", async () => {
    const session = await games.startSession(player, { gameCode: "test", currency: "CREDIT" });
    const [bet, end] = await Promise.allSettled([
      games.placeBet(player, session.sessionId, 10_000n, "racing-end"),
      games.endSession(player, session.sessionId),
    ]);
    expect(end.status).toBe("fulfilled");
    const stored = await testPrisma.gameSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored.status).toBe("ENDED");
    expect(stored.totalBetMinor).toBe(bet.status === "fulfilled" ? 10_000n : 0n);
    expect(await testPrisma.gameRound.count()).toBe(bet.status === "fulfilled" ? 1 : 0);
    await assertInvariants();
  });
});

describe("Game rounds — transactional compliance", () => {
  it("serializes concurrent different bets against the responsible-gaming wager limit", async () => {
    play.mockReturnValue({ winMinor: 0n, outcome: { kind: "test-loss" } });
    await testPrisma.responsibleGamingLimit.create({ data: { playerId: player.playerId, type: "WAGER", valueMinor: 15_000n, period: "DAILY" } });
    const session = await games.startSession(player, { gameCode: "test", currency: "CREDIT" });
    const results = await Promise.allSettled([
      games.placeBet(player, session.sessionId, 10_000n, "first"),
      games.placeBet(player, session.sessionId, 10_000n, "second"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "RG_LIMIT_EXCEEDED" } });
    expect(await testPrisma.gameRound.count()).toBe(1);
    await assertInvariants();
  });

  it("checks self-exclusion again on the transaction connection", async () => {
    const session = await games.startSession(player, { gameCode: "test", currency: "CREDIT" });
    await testPrisma.player.update({ where: { id: player.playerId }, data: { status: "SELF_EXCLUDED" } });
    await expect(games.placeBet(player, session.sessionId, 10_000n, "blocked")).rejects.toMatchObject({ code: "SELF_EXCLUDED" });
    expect(await testPrisma.gameRound.count()).toBe(0);
    expect(await ledger.getBalance({ kind: "player", playerId: player.playerId, currency: "CREDIT" })).toBe(100_000n);
    await assertInvariants();
  });
});

describe("Game rounds — legacy partial settlement", () => {
  it("requires reconciliation rather than reinterpreting a paid legacy round after RTP changes", async () => {
    const session = await games.startSession(player, { gameCode: "test", currency: "CREDIT" });
    const round = await testPrisma.gameRound.create({ data: { sessionId: session.sessionId, nonce: 1, betMinor: 10_000n, winMinor: 0n, outcome: { kind: "pending", params: {} }, idempotencyKey: `round:${session.sessionId}:legacy` } });
    await ledger.post({ type: "GAME_BET", currency: "CREDIT", idempotencyKey: `round:${round.id}:bet`, ref: { type: "GameRound", id: round.id }, legs: [
      { account: { kind: "player", playerId: player.playerId, currency: "CREDIT" }, direction: "DEBIT", amountMinor: 10_000n },
      { account: { kind: "system", systemKey: "REVENUE", currency: "CREDIT" }, direction: "CREDIT", amountMinor: 10_000n },
    ] });
    await ledger.post({ type: "GAME_WIN", currency: "CREDIT", idempotencyKey: `round:${round.id}:win`, ref: { type: "GameRound", id: round.id }, legs: [
      { account: { kind: "system", systemKey: "REVENUE", currency: "CREDIT" }, direction: "DEBIT", amountMinor: 9400n },
      { account: { kind: "player", playerId: player.playerId, currency: "CREDIT" }, direction: "CREDIT", amountMinor: 9400n },
    ] });
    await testPrisma.game.update({ where: { id: gameId }, data: { rtpBps: 8000 } });
    await expect(games.placeBet(player, session.sessionId, 10_000n, "legacy")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(play).not.toHaveBeenCalled();
    expect(await testPrisma.gameRound.findUniqueOrThrow({ where: { id: round.id } })).toMatchObject({ betTxId: null, winTxId: null, winMinor: 0n, outcome: { kind: "pending" } });
    expect(await testPrisma.gameSession.findUniqueOrThrow({ where: { id: session.sessionId } })).toMatchObject({ totalBetMinor: 0n, totalWinMinor: 0n });
    expect(await testPrisma.ledgerTransaction.count()).toBe(3);
    expect(await ledger.getBalance({ kind: "player", playerId: player.playerId, currency: "CREDIT" })).toBe(99_400n);
    await assertInvariants();
  });
});
