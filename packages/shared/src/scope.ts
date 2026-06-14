import { type OperatorTier } from "./enums";

/**
 * Request scope carried in AsyncLocalStorage and consumed by the Prisma subtree
 * extension and the ScopeGuard (docs/04 §2). Resolved per request from the DB/
 * cache (never trusted from the JWT, since the path can change).
 */
export type ScopeKind = "operator" | "player" | "system";

export interface ScopeContext {
  kind: ScopeKind;
  /** Operator's materialized path (operator kind). Its subtree = self + descendants. */
  path?: string;
  operatorId?: string;
  tier?: OperatorTier;
  userId?: string;
  /** Player kind: the player's own id and its owning operator's path. */
  playerId?: string;
  /** Explicit escape hatch for system actions performed inside a request. */
  bypass?: boolean;
}

/**
 * True iff `targetPath` is within the subtree rooted at `callerPath`
 * (the caller node itself or any descendant). Pure; the single definition of
 * "in scope" used by both enforcement layers.
 */
export function isInSubtree(callerPath: string, targetPath: string): boolean {
  return targetPath === callerPath || targetPath.startsWith(`${callerPath}.`);
}
