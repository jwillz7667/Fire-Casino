import { type OperatorTier } from "./enums";

/**
 * RBAC permission catalog and the per-tier base matrix (docs/04 §3).
 *
 * A permission grants the *ability*; the scope boundary (ScopeGuard + Prisma
 * extension) limits the *targets*. The check is:
 *   hasBasePermission(tier, perm) || hasGrant(operatorSettings, perm)
 *
 * Legend from docs/04 §3, encoded here:
 *  - ✓            → in the tier's base set
 *  - –            → absent
 *  - cfg          → absent from base; enabled per-operator via settings.permissions
 *  - grant-only   → absent from base; SUPER_ADMIN may grant via settings.permissions
 *  - subtree      → in the base set (scoping is the guard's job, not the matrix)
 */
export const PERMISSIONS = [
  "operator.create_child",
  "operator.suspend",
  "operator.set_pricing",
  "operator.view_subtree",
  "credit.mint",
  "credit.transfer_down",
  "order.request_up",
  "order.fulfill",
  "order.view",
  "player.create",
  "player.recharge",
  "player.deduct",
  "player.suspend",
  "player.view",
  "redemption.approve",
  "redemption.settle",
  "redemption.view",
  "game.configure",
  "game.rtp_override",
  "game.rtp_agent",
  "compliance.manage",
  "compliance.view",
  "promotion.manage",
  "ledger.adjust",
  "platform.settings",
  "audit.view",
  "report.view",
  "report.ledger_health",
  "announcement.manage",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Permissions that may be conferred per-operator via a grant (docs/04 §3 `cfg`
 * and `grant-only` rows). Anything not in this set is fixed by tier and can
 * never be added through `settings.permissions` — a node cannot widen its
 * structural abilities. Grants are the ONLY writer of `settings.permissions`.
 */
export const GRANTABLE_PERMISSIONS = [
  "credit.mint",
  "redemption.approve",
  "redemption.settle",
  "game.rtp_override",
  "compliance.manage",
  "compliance.view",
  "promotion.manage",
  "ledger.adjust",
  "platform.settings",
  "report.ledger_health",
  "announcement.manage",
  "audit.view",
] as const satisfies readonly Permission[];

export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number];

/**
 * Grants that ONLY a SUPER_ADMIN may confer (docs/04 §3 `grant-only`): minting
 * (direct `credit.mint` and `promotion.manage`, which mints redeemable
 * PROMO_GRANT credits), manual ledger adjustments, and platform-wide settings.
 * No other tier can hand these out, even to a descendant.
 */
export const SUPER_ADMIN_ONLY_GRANTS = [
  "credit.mint",
  "promotion.manage",
  "ledger.adjust",
  "platform.settings",
] as const satisfies readonly Permission[];

export function isGrantablePermission(value: string): value is GrantablePermission {
  return (GRANTABLE_PERMISSIONS as readonly string[]).includes(value);
}

function isSuperAdminOnlyGrant(permission: Permission): boolean {
  return (SUPER_ADMIN_ONLY_GRANTS as readonly string[]).includes(permission);
}

const ALL_TIERS: OperatorTier[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "MASTER_DISTRIBUTOR",
  "DISTRIBUTOR",
  "SUB_DISTRIBUTOR",
  "STORE",
];

const DISTRIBUTOR_TIERS: OperatorTier[] = [
  "MASTER_DISTRIBUTOR",
  "DISTRIBUTOR",
  "SUB_DISTRIBUTOR",
];

const NON_STORE_OPERATORS: OperatorTier[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "MASTER_DISTRIBUTOR",
  "DISTRIBUTOR",
  "SUB_DISTRIBUTOR",
];

/** Tiers that hold each permission in their base set (no per-operator grant). */
const BASE_MATRIX: Record<Permission, OperatorTier[]> = {
  "operator.create_child": NON_STORE_OPERATORS,
  "operator.suspend": NON_STORE_OPERATORS,
  "operator.set_pricing": NON_STORE_OPERATORS,
  "operator.view_subtree": ALL_TIERS,
  "credit.mint": ["SUPER_ADMIN"], // ADMIN is grant-only
  "credit.transfer_down": NON_STORE_OPERATORS,
  "order.request_up": ["ADMIN", ...DISTRIBUTOR_TIERS, "STORE"],
  "order.fulfill": NON_STORE_OPERATORS,
  "order.view": ALL_TIERS,
  "player.create": ["STORE"],
  "player.recharge": ["ADMIN", "STORE"],
  // Removing credits from a player BURNS them to the SINK account — it never
  // refunds the agent (docs/03 §4.4). Same actors as recharge; structural, so
  // it is NOT in GRANTABLE_PERMISSIONS and cannot be conferred to other tiers.
  "player.deduct": ["ADMIN", "STORE"],
  "player.suspend": ["ADMIN", "STORE"],
  "player.view": ALL_TIERS,
  "redemption.approve": ["SUPER_ADMIN", "ADMIN", "STORE"], // distributor tiers via cfg
  "redemption.settle": ["SUPER_ADMIN", "ADMIN", "STORE"],
  "redemption.view": ALL_TIERS,
  "game.configure": ["SUPER_ADMIN", "ADMIN"],
  "game.rtp_override": ["SUPER_ADMIN", "ADMIN"], // distributor tiers via cfg
  "game.rtp_agent": ["SUPER_ADMIN", "ADMIN", "STORE"], // agents tune their own players' win rates
  "compliance.manage": ["SUPER_ADMIN", "ADMIN"],
  "compliance.view": ["SUPER_ADMIN", "ADMIN"],
  // Promotions MINT credits (a PROMO_GRANT redeemable by players), so promo
  // management is SUPER_ADMIN base + super-admin-only grant, exactly like
  // credit.mint — it must NEVER be reachable via the grantable compliance.manage
  // (AUTHZ-1). Global geo-rule editing is likewise restricted to platform.settings
  // (SUPER_ADMIN-only) rather than compliance.manage (AUTHZ-2).
  "promotion.manage": ["SUPER_ADMIN"],
  "ledger.adjust": ["SUPER_ADMIN"],
  "platform.settings": ["SUPER_ADMIN"],
  "audit.view": ALL_TIERS, // scoped to subtree below SUPER_ADMIN/ADMIN
  "report.view": ALL_TIERS,
  "report.ledger_health": ["SUPER_ADMIN", "ADMIN"],
  "announcement.manage": ["SUPER_ADMIN", "ADMIN"],
  "settings.manage": ALL_TIERS, // own node; platform settings gated by platform.settings
};

/** True if the tier holds the permission in its base set. */
export function hasBasePermission(tier: OperatorTier, permission: Permission): boolean {
  return BASE_MATRIX[permission].includes(tier);
}

/**
 * Per-operator grants for `cfg`/`grant-only` cases live in
 * Operator.settings.permissions (a string[] of permission names).
 */
export function hasGrant(
  settings: { permissions?: readonly string[] } | null | undefined,
  permission: Permission,
): boolean {
  return settings?.permissions?.includes(permission) ?? false;
}

/** Authoritative ability check: base matrix OR a per-operator grant. */
export function can(
  tier: OperatorTier,
  settings: { permissions?: readonly string[] } | null | undefined,
  permission: Permission,
): boolean {
  return hasBasePermission(tier, permission) || hasGrant(settings, permission);
}

/** The full base permission set for a tier (used for /auth/me). */
export function basePermissionsFor(tier: OperatorTier): Permission[] {
  return PERMISSIONS.filter((p) => hasBasePermission(tier, p));
}

/** Effective permissions for an operator: base set ∪ granted. */
export function effectivePermissions(
  tier: OperatorTier,
  settings: { permissions?: readonly string[] } | null | undefined,
): Permission[] {
  return PERMISSIONS.filter((p) => can(tier, settings, p));
}

export interface GrantDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Whether `granter` may confer `permission` on a descendant (docs/04 §3, docs/01
 * §8 "deny by default", "least privilege"). A grant is allowed only when:
 *  1. the permission is grantable at all (not a tier-fixed structural ability);
 *  2. `grant-only` permissions (mint, ledger.adjust, platform.settings) are
 *     conferred solely by a SUPER_ADMIN;
 *  3. the granter actually holds the permission in its own effective set —
 *     you cannot hand out an ability you don't have (no self-escalation by proxy).
 * The caller separately enforces that the target is a strict descendant (never
 * self) — grants flow downward only.
 */
export function canGrantPermission(
  granter: { tier: OperatorTier; settings: { permissions?: readonly string[] } | null | undefined },
  permission: Permission,
): GrantDecision {
  if (!isGrantablePermission(permission)) {
    return { allowed: false, reason: `${permission} is fixed by tier and cannot be granted` };
  }
  if (isSuperAdminOnlyGrant(permission) && granter.tier !== "SUPER_ADMIN") {
    return { allowed: false, reason: `${permission} can only be granted by a super admin` };
  }
  if (!can(granter.tier, granter.settings, permission)) {
    return { allowed: false, reason: `cannot grant ${permission} without holding it` };
  }
  return { allowed: true };
}
