import { describe, expect, it } from "vitest";
import {
  can,
  canGrantPermission,
  effectivePermissions,
  hasBasePermission,
  hasGrant,
  isGrantablePermission,
} from "./permissions";
import { tierRequiresMfa } from "./enums";
import { isInSubtree } from "./scope";

describe("permission matrix (docs/04 §3)", () => {
  it("only STORE creates players; STORE cannot create operators", () => {
    expect(hasBasePermission("STORE", "player.create")).toBe(true);
    expect(hasBasePermission("DISTRIBUTOR", "player.create")).toBe(false);
    expect(hasBasePermission("STORE", "operator.create_child")).toBe(false);
    expect(hasBasePermission("DISTRIBUTOR", "operator.create_child")).toBe(true);
  });

  it("only SUPER_ADMIN mints in the base set; ADMIN is grant-only", () => {
    expect(hasBasePermission("SUPER_ADMIN", "credit.mint")).toBe(true);
    expect(hasBasePermission("ADMIN", "credit.mint")).toBe(false);
    expect(can("ADMIN", { permissions: ["credit.mint"] }, "credit.mint")).toBe(true);
  });

  it("ledger.adjust and platform.settings are SUPER_ADMIN only", () => {
    for (const tier of ["ADMIN", "DISTRIBUTOR", "STORE"] as const) {
      expect(hasBasePermission(tier, "ledger.adjust")).toBe(false);
      expect(hasBasePermission(tier, "platform.settings")).toBe(false);
    }
    expect(hasBasePermission("SUPER_ADMIN", "ledger.adjust")).toBe(true);
  });

  it("redemption.approve is cfg for distributor tiers (grant required)", () => {
    expect(hasBasePermission("DISTRIBUTOR", "redemption.approve")).toBe(false);
    expect(can("DISTRIBUTOR", null, "redemption.approve")).toBe(false);
    expect(can("DISTRIBUTOR", { permissions: ["redemption.approve"] }, "redemption.approve")).toBe(
      true,
    );
    expect(hasBasePermission("STORE", "redemption.approve")).toBe(true);
  });

  it("hasGrant tolerates missing settings", () => {
    expect(hasGrant(null, "credit.mint")).toBe(false);
    expect(hasGrant({}, "credit.mint")).toBe(false);
    expect(hasGrant({ permissions: ["credit.mint"] }, "credit.mint")).toBe(true);
  });

  it("player.deduct (credit removal) is an agent ability, not grantable or self-mintable", () => {
    // Same actors as recharge: ADMIN + STORE hold it; distributors and super admin do not.
    expect(hasBasePermission("STORE", "player.deduct")).toBe(true);
    expect(hasBasePermission("ADMIN", "player.deduct")).toBe(true);
    expect(hasBasePermission("DISTRIBUTOR", "player.deduct")).toBe(false);
    expect(hasBasePermission("SUPER_ADMIN", "player.deduct")).toBe(false);
    // Structural — cannot be conferred via a grant, and a STORE holding it still cannot mint.
    expect(isGrantablePermission("player.deduct")).toBe(false);
    expect(can("STORE", null, "credit.mint")).toBe(false);
  });

  it("effectivePermissions merges base and grants", () => {
    const eff = effectivePermissions("STORE", { permissions: ["redemption.approve"] });
    expect(eff).toContain("player.create");
    expect(eff).toContain("redemption.approve");
    expect(eff).not.toContain("ledger.adjust");
  });
});

describe("canGrantPermission — grant authority (docs/04 §3, security B1)", () => {
  it("blocks granting tier-fixed (non-grantable) permissions", () => {
    const granter = { tier: "SUPER_ADMIN" as const, settings: null };
    expect(canGrantPermission(granter, "operator.create_child").allowed).toBe(false);
    expect(canGrantPermission(granter, "player.create").allowed).toBe(false);
  });

  it("only a super admin can grant mint / ledger.adjust / platform.settings", () => {
    const admin = { tier: "ADMIN" as const, settings: { permissions: ["credit.mint"] } };
    expect(canGrantPermission(admin, "credit.mint").allowed).toBe(false); // even if it holds it
    const superAdmin = { tier: "SUPER_ADMIN" as const, settings: null };
    expect(canGrantPermission(superAdmin, "credit.mint").allowed).toBe(true);
    expect(canGrantPermission(superAdmin, "ledger.adjust").allowed).toBe(true);
  });

  it("a granter cannot confer a permission it does not itself hold", () => {
    const dist = { tier: "DISTRIBUTOR" as const, settings: null };
    expect(canGrantPermission(dist, "redemption.approve").allowed).toBe(false);
    const distWithGrant = { tier: "DISTRIBUTOR" as const, settings: { permissions: ["redemption.approve"] } };
    expect(canGrantPermission(distWithGrant, "redemption.approve").allowed).toBe(true);
  });
});

describe("tierRequiresMfa (docs/01 §4)", () => {
  it("requires MFA for SUPER_ADMIN and ADMIN only", () => {
    expect(tierRequiresMfa("SUPER_ADMIN")).toBe(true);
    expect(tierRequiresMfa("ADMIN")).toBe(true);
    expect(tierRequiresMfa("DISTRIBUTOR")).toBe(false);
    expect(tierRequiresMfa("STORE")).toBe(false);
  });
});

describe("isInSubtree (docs/04 §2)", () => {
  it("matches self and descendants only", () => {
    expect(isInSubtree("0.1", "0.1")).toBe(true); // self
    expect(isInSubtree("0.1", "0.1.3")).toBe(true); // child
    expect(isInSubtree("0.1", "0.1.3.7")).toBe(true); // grandchild
    expect(isInSubtree("0.1", "0.2")).toBe(false); // sibling
    expect(isInSubtree("0.1", "0")).toBe(false); // ancestor
    expect(isInSubtree("0.1", "0.10")).toBe(false); // prefix-but-not-descendant
  });

  it("super admin root contains everything", () => {
    expect(isInSubtree("0", "0.1.2.3")).toBe(true);
    expect(isInSubtree("0", "0")).toBe(true);
  });
});
