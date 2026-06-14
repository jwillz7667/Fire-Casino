import type { OperatorSummary, Permission } from "@aureus/shared";

/**
 * Reads an OperatorSummary's effective permission set. The arcade is a player
 * surface (players have no permissions), but the helper is provided per the
 * shared lib contract and is safe to call with a null principal.
 */
export function hasPermission(
  principal: Pick<OperatorSummary, "permissions"> | null | undefined,
  perm: Permission,
): boolean {
  return principal?.permissions.includes(perm) ?? false;
}
