import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedPrisma, type ScopedPrismaClient } from "@aureus/db";
import { type ScopeContext } from "@aureus/shared";
import { createOperator, createPlayer, resetDb, testPrisma } from "../helpers/db";

let scope: ScopeContext | undefined;
const scoped: ScopedPrismaClient = createScopedPrisma(testPrisma, () => scope);

interface Tree {
  root: { operatorId: string; path: string };
  distA: { operatorId: string; path: string };
  distB: { operatorId: string; path: string };
  storeA: { operatorId: string; path: string };
  storeB: { operatorId: string; path: string };
  playerA: string;
  playerB: string;
}

let tree: Tree;

beforeAll(async () => {
  await resetDb();
  const root = await createOperator({ username: "root", tier: "SUPER_ADMIN", pathSegment: 0 });
  const distA = await createOperator({ username: "distA", tier: "DISTRIBUTOR", parent: root, pathSegment: 1 });
  const distB = await createOperator({ username: "distB", tier: "DISTRIBUTOR", parent: root, pathSegment: 2 });
  const storeA = await createOperator({ username: "storeA", tier: "STORE", parent: distA, pathSegment: 1 });
  const storeB = await createOperator({ username: "storeB", tier: "STORE", parent: distB, pathSegment: 1 });
  const playerA = await createPlayer({ username: "playerA", operatorId: storeA.operatorId });
  const playerB = await createPlayer({ username: "playerB", operatorId: storeB.operatorId });
  tree = {
    root,
    distA,
    distB,
    storeA,
    storeB,
    playerA: playerA.playerId,
    playerB: playerB.playerId,
  };
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("Prisma subtree extension (docs/04 §2, layer 2)", () => {
  it("an operator sees only its own subtree's operators", async () => {
    scope = { kind: "operator", path: tree.distA.path, operatorId: tree.distA.operatorId };
    const ids = (await scoped.operator.findMany({ select: { id: true } })).map((o) => o.id);
    expect(ids).toContain(tree.distA.operatorId);
    expect(ids).toContain(tree.storeA.operatorId);
    expect(ids).not.toContain(tree.root.operatorId); // ancestor
    expect(ids).not.toContain(tree.distB.operatorId); // cousin
    expect(ids).not.toContain(tree.storeB.operatorId); // cousin's child
  });

  it("a cousin cannot read a cousin's players", async () => {
    scope = { kind: "operator", path: tree.distB.path, operatorId: tree.distB.operatorId };
    const players = await scoped.player.findMany({ select: { id: true } });
    expect(players.map((p) => p.id)).toEqual([tree.playerB]);
  });

  it("an operator's ledger-account reads exclude system accounts and other branches", async () => {
    // seed some system accounts to ensure they are filtered out
    await testPrisma.ledgerAccount.create({
      data: { ownerType: "SYSTEM", systemKey: "MINT", currency: "CREDIT", balanceMinor: 0n },
    });
    scope = { kind: "operator", path: tree.distA.path, operatorId: tree.distA.operatorId };
    const accounts = await scoped.ledgerAccount.findMany({
      select: { ownerType: true, operator: { select: { path: true } }, player: { select: { id: true } } },
    });
    expect(accounts.every((a) => a.ownerType !== "SYSTEM")).toBe(true);
    expect(accounts.some((a) => a.player?.id === tree.playerB)).toBe(false);
  });

  it("the super admin (root) sees everything", async () => {
    scope = { kind: "operator", path: tree.root.path, operatorId: tree.root.operatorId };
    const count = await scoped.operator.count();
    expect(count).toBe(5);
  });

  it("a player sees only its own rows", async () => {
    scope = { kind: "player", playerId: tree.playerA, operatorId: tree.storeA.operatorId };
    const players = await scoped.player.findMany({ select: { id: true } });
    expect(players.map((p) => p.id)).toEqual([tree.playerA]);
    const operators = await scoped.operator.findMany();
    expect(operators).toEqual([]); // players never read operators
  });

  it("fails closed: a scoped read with no scope returns nothing", async () => {
    scope = undefined;
    const operators = await scoped.operator.findMany();
    expect(operators).toEqual([]);
  });
});
