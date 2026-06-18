import { type ExecutionContext } from "@nestjs/common";
import { type Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { type PrismaClient } from "@aureus/db";
import { AppError } from "../errors/domain-error";
import { MfaEnrollmentGuard } from "./mfa-enrollment.guard";
import { PermissionGuard } from "./permission.guard";
import { ScopeGuard } from "./scope.guard";
import { type OperatorPrincipal, type PlayerPrincipal } from "./principal";

function mockContext(req: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function reflectorReturning(value: unknown): Reflector {
  return { getAllAndOverride: vi.fn().mockReturnValue(value) } as unknown as Reflector;
}

const operator: OperatorPrincipal = {
  kind: "operator",
  userId: "u1",
  operatorId: "op-distA",
  username: "distA",
  displayName: "Dist A",
  tier: "DISTRIBUTOR",
  path: "0.1",
  depth: 1,
  mfaEnabled: false,
  settings: {},
  sessionId: "s1",
};

const player: PlayerPrincipal = {
  kind: "player",
  playerId: "pl1",
  operatorId: "op-storeA",
  operatorPath: "0.1.1",
  username: "playerA",
  sessionId: "s2",
};

describe("PermissionGuard (docs/04 §3)", () => {
  it("passes when no permission is required", () => {
    const guard = new PermissionGuard(reflectorReturning(undefined));
    expect(guard.canActivate(mockContext({ principal: operator }))).toBe(true);
  });

  it("allows an operator holding the base permission", () => {
    const guard = new PermissionGuard(reflectorReturning(["credit.transfer_down"]));
    expect(guard.canActivate(mockContext({ principal: operator }))).toBe(true);
  });

  it("rejects an operator missing the permission", () => {
    const guard = new PermissionGuard(reflectorReturning(["credit.mint"]));
    expect(() => guard.canActivate(mockContext({ principal: operator }))).toThrow(AppError);
  });

  it("allows a cfg permission when granted via settings", () => {
    const granted: OperatorPrincipal = { ...operator, settings: { permissions: ["credit.mint"] } };
    const guard = new PermissionGuard(reflectorReturning(["credit.mint"]));
    expect(guard.canActivate(mockContext({ principal: granted }))).toBe(true);
  });

  it("rejects a player on a permission-gated route", () => {
    const guard = new PermissionGuard(reflectorReturning(["player.view"]));
    expect(() => guard.canActivate(mockContext({ principal: player }))).toThrow(AppError);
  });
});

describe("MfaEnrollmentGuard (forced 2FA, docs/01 §4)", () => {
  const admin: OperatorPrincipal = { ...operator, tier: "ADMIN", mfaEnabled: false };

  it("passes a player principal (MFA is operator-only)", () => {
    const guard = new MfaEnrollmentGuard(reflectorReturning(false));
    expect(guard.canActivate(mockContext({ principal: player }))).toBe(true);
  });

  it("passes a public route with no principal", () => {
    const guard = new MfaEnrollmentGuard(reflectorReturning(false));
    expect(guard.canActivate(mockContext({}))).toBe(true);
  });

  it("passes a non-MFA tier even when unenrolled", () => {
    const guard = new MfaEnrollmentGuard(reflectorReturning(false));
    expect(guard.canActivate(mockContext({ principal: operator }))).toBe(true);
  });

  it("blocks an unenrolled MFA-required admin on a normal route", () => {
    const guard = new MfaEnrollmentGuard(reflectorReturning(false));
    expect(() => guard.canActivate(mockContext({ principal: admin }))).toThrow(AppError);
  });

  it("emits MFA_ENROLLMENT_REQUIRED for the blocked admin", () => {
    const guard = new MfaEnrollmentGuard(reflectorReturning(false));
    try {
      guard.canActivate(mockContext({ principal: admin }));
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("MFA_ENROLLMENT_REQUIRED");
    }
  });

  it("allows the admin onto an @AllowMfaEnrollment route", () => {
    const guard = new MfaEnrollmentGuard(reflectorReturning(true));
    expect(guard.canActivate(mockContext({ principal: admin }))).toBe(true);
  });

  it("passes an enrolled MFA-required admin on any route", () => {
    const guard = new MfaEnrollmentGuard(reflectorReturning(false));
    const enrolled: OperatorPrincipal = { ...admin, mfaEnabled: true };
    expect(guard.canActivate(mockContext({ principal: enrolled }))).toBe(true);
  });
});

describe("ScopeGuard (docs/04 §2, layer 1)", () => {
  function guardWithTargetPath(path: string | null): ScopeGuard {
    const prisma = {
      operator: { findUnique: vi.fn().mockResolvedValue(path ? { path } : null) },
      player: { findUnique: vi.fn() },
    } as unknown as PrismaClient;
    return new ScopeGuard(
      reflectorReturning({ operatorIdFrom: [{ source: "params", key: "id" }] }),
      prisma,
    );
  }

  it("passes when no scope check is configured", async () => {
    const prisma = {} as unknown as PrismaClient;
    const guard = new ScopeGuard(reflectorReturning(undefined), prisma);
    await expect(
      guard.canActivate(mockContext({ principal: operator, params: { id: "x" } })),
    ).resolves.toBe(true);
  });

  it("allows a target inside the caller's subtree", async () => {
    const guard = guardWithTargetPath("0.1.4");
    await expect(
      guard.canActivate(mockContext({ principal: operator, params: { id: "op-child" } })),
    ).resolves.toBe(true);
  });

  it("rejects a target outside the caller's subtree (cousin)", async () => {
    const guard = guardWithTargetPath("0.2.1");
    await expect(
      guard.canActivate(mockContext({ principal: operator, params: { id: "op-cousin" } })),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "OUT_OF_SCOPE");
  });

  it("rejects an ancestor target", async () => {
    const guard = guardWithTargetPath("0");
    await expect(
      guard.canActivate(mockContext({ principal: operator, params: { id: "op-root" } })),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects when the target does not exist", async () => {
    const guard = guardWithTargetPath(null);
    await expect(
      guard.canActivate(mockContext({ principal: operator, params: { id: "missing" } })),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a player principal on a scope-checked operator route", async () => {
    const guard = guardWithTargetPath("0.1.1");
    await expect(
      guard.canActivate(mockContext({ principal: player, params: { id: "x" } })),
    ).rejects.toBeInstanceOf(AppError);
  });
});
