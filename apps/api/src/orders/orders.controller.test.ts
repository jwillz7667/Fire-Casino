import { type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can } from "@aureus/shared";
import { describe, expect, it } from "vitest";
import { PermissionGuard } from "../common/auth/permission.guard";
import { type OperatorPrincipal } from "../common/auth/principal";
import { OrdersController } from "./orders.controller";

const root: OperatorPrincipal = {
  kind: "operator",
  userId: "root-user",
  operatorId: "root-operator",
  username: "root",
  displayName: "Root",
  tier: "SUPER_ADMIN",
  path: "0",
  depth: 0,
  mfaEnabled: true,
  settings: {},
  sessionId: "root-session",
};

function context(handler: keyof OrdersController, principal: unknown): ExecutionContext {
  return {
    // Nest inspects the original method's metadata; this reference is never invoked.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    getHandler: () => OrdersController.prototype[handler],
    getClass: () => OrdersController,
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}

describe("order proof upload permissions", () => {
  const guard = new PermissionGuard(new Reflector());

  it("allows a root seller to upload fulfillment proof without granting request-up", () => {
    expect(can(root.tier, root.settings, "order.request_up")).toBe(false);
    expect(can(root.tier, root.settings, "order.fulfill")).toBe(true);
    expect(guard.canActivate(context("proofUrl", root))).toBe(true);
    expect(() => guard.canActivate(context("request", root))).toThrow();
  });

  it("allows buyers to upload proof and rejects non-operator principals", () => {
    expect(guard.canActivate(context("proofUrl", { ...root, tier: "STORE" }))).toBe(true);
    expect(() => guard.canActivate(context("proofUrl", { kind: "player" }))).toThrow();
    expect(() => guard.canActivate(context("proofUrl", undefined))).toThrow();
  });
});
