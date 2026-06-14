import type { OperatorSummary, Permission } from "@aureus/shared";

/** True if the operator principal holds the permission (reads its effective set). */
export function hasPermission(
  principal: Pick<OperatorSummary, "permissions"> | null | undefined,
  permission: Permission,
): boolean {
  return principal?.permissions.includes(permission) ?? false;
}

/** True if the principal holds ANY of the permissions (used for nav grouping). */
export function hasAnyPermission(
  principal: Pick<OperatorSummary, "permissions"> | null | undefined,
  permissions: Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(principal, permission));
}
