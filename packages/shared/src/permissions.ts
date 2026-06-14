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
  "player.suspend",
  "player.view",
  "redemption.approve",
  "redemption.settle",
  "redemption.view",
  "game.configure",
  "game.rtp_override",
  "compliance.manage",
  "compliance.view",
  "ledger.adjust",
  "platform.settings",
  "audit.view",
  "report.view",
  "report.ledger_health",
  "announcement.manage",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

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
  "player.suspend": ["ADMIN", "STORE"],
  "player.view": ALL_TIERS,
  "redemption.approve": ["SUPER_ADMIN", "ADMIN", "STORE"], // distributor tiers via cfg
  "redemption.settle": ["SUPER_ADMIN", "ADMIN", "STORE"],
  "redemption.view": ALL_TIERS,
  "game.configure": ["SUPER_ADMIN", "ADMIN"],
  "game.rtp_override": ["SUPER_ADMIN", "ADMIN"], // distributor tiers via cfg
  "compliance.manage": ["SUPER_ADMIN", "ADMIN"],
  "compliance.view": ["SUPER_ADMIN", "ADMIN"],
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
