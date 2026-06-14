import { describe, expect, it } from "vitest";
import { type OperatorTier } from "@aureus/shared";
import {
  type OperatorPrincipal,
  type PlayerPrincipal,
} from "../../src/common/auth/principal";
import {
  allowedRoomsFor,
  canJoinRoom,
  isAdminTier,
  selfRoom,
} from "../../src/realtime/room-access";

function operator(opts: { operatorId?: string; tier?: OperatorTier; path?: string } = {}): OperatorPrincipal {
  return {
    kind: "operator",
    userId: "u1",
    operatorId: opts.operatorId ?? "op-1",
    username: "op",
    displayName: "Op",
    tier: opts.tier ?? "STORE",
    path: opts.path ?? "0.1",
    depth: 1,
    mfaEnabled: false,
    settings: {},
    sessionId: "s1",
  };
}

function player(opts: { playerId?: string } = {}): PlayerPrincipal {
  return {
    kind: "player",
    playerId: opts.playerId ?? "pl-1",
    operatorId: "op-1",
    operatorPath: "0.1",
    username: "pl",
    sessionId: "s1",
  };
}

describe("isAdminTier", () => {
  it("is true for SUPER_ADMIN and ADMIN only", () => {
    expect(isAdminTier("SUPER_ADMIN")).toBe(true);
    expect(isAdminTier("ADMIN")).toBe(true);

    expect(isAdminTier("MASTER_DISTRIBUTOR")).toBe(false);
    expect(isAdminTier("DISTRIBUTOR")).toBe(false);
    expect(isAdminTier("SUB_DISTRIBUTOR")).toBe(false);
    expect(isAdminTier("STORE")).toBe(false);
  });
});

describe("selfRoom", () => {
  it("returns the player room for a player", () => {
    expect(selfRoom(player({ playerId: "pl-9" }))).toBe("player:pl-9");
  });

  it("returns the operator room for an operator", () => {
    expect(selfRoom(operator({ operatorId: "op-9" }))).toBe("operator:op-9");
  });
});

describe("allowedRoomsFor", () => {
  it("gives a player only its own room", () => {
    expect(allowedRoomsFor(player({ playerId: "pl-2" }))).toEqual(["player:pl-2"]);
  });

  it("gives a non-admin operator only its own room", () => {
    expect(allowedRoomsFor(operator({ operatorId: "op-2", tier: "STORE" }))).toEqual([
      "operator:op-2",
    ]);
  });

  it("adds admin:global for an admin-tier operator", () => {
    expect(allowedRoomsFor(operator({ operatorId: "op-3", tier: "ADMIN" }))).toEqual([
      "operator:op-3",
      "admin:global",
    ]);
  });
});

describe("canJoinRoom — player", () => {
  it("allows its own player room", () => {
    expect(canJoinRoom(player({ playerId: "pl-1" }), "player:pl-1")).toEqual({ kind: "allow" });
  });

  it("denies another player's room", () => {
    expect(canJoinRoom(player({ playerId: "pl-1" }), "player:pl-2")).toEqual({ kind: "deny" });
  });

  it("denies any operator room", () => {
    expect(canJoinRoom(player(), "operator:op-1")).toEqual({ kind: "deny" });
  });

  it("denies admin:global", () => {
    expect(canJoinRoom(player(), "admin:global")).toEqual({ kind: "deny" });
  });
});

describe("canJoinRoom — operator", () => {
  it("allows its own operator room", () => {
    expect(canJoinRoom(operator({ operatorId: "op-1" }), "operator:op-1")).toEqual({
      kind: "allow",
    });
  });

  it("returns a check-operator marker for another operator room without a resolver", () => {
    expect(canJoinRoom(operator({ operatorId: "op-1" }), "operator:op-2")).toEqual({
      kind: "check-operator",
      operatorId: "op-2",
    });
  });

  it("resolves descendant operator rooms via the supplied predicate", () => {
    const op = operator({ operatorId: "op-1" });
    expect(canJoinRoom(op, "operator:op-2", () => true)).toEqual({ kind: "allow" });
    expect(canJoinRoom(op, "operator:op-2", () => false)).toEqual({ kind: "deny" });
  });

  it("denies a player room", () => {
    expect(canJoinRoom(operator(), "player:pl-1")).toEqual({ kind: "deny" });
  });

  it("allows admin:global only for admin tiers", () => {
    expect(canJoinRoom(operator({ tier: "SUPER_ADMIN" }), "admin:global")).toEqual({
      kind: "allow",
    });
    expect(canJoinRoom(operator({ tier: "STORE" }), "admin:global")).toEqual({ kind: "deny" });
  });
});

describe("canJoinRoom — malformed", () => {
  it("denies unknown room shapes", () => {
    expect(canJoinRoom(operator(), "bogus")).toEqual({ kind: "deny" });
    expect(canJoinRoom(operator(), "operator:")).toEqual({ kind: "deny" });
    expect(canJoinRoom(player(), "")).toEqual({ kind: "deny" });
  });
});
