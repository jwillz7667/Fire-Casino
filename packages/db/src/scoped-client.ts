import { type PrismaClient } from "@prisma/client";
import { type ScopeContext } from "@aureus/shared";

/**
 * Subtree-scoping Prisma client extension (docs/04 §2, layer 2). Injects a path
 * filter into READ operations on scoped models, driven by the per-request scope
 * resolved into AsyncLocalStorage. This is defense-in-depth behind the
 * controller ScopeGuard: a query that forgot the guard still cannot read across
 * branches.
 *
 * Framework-free: the app passes a `getScope` accessor (wired to nestjs-cls).
 * The un-extended client (prismaSystem) is used by the ledger, workers, and seed
 * — code that legitimately spans the whole tree and touches system accounts.
 *
 * findUnique/findUniqueOrThrow are NOT covered (Prisma forbids relation filters
 * in unique-where); by-id single reads are covered by the controller ScopeGuard.
 */

const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

type ScopedModel = "operator" | "player" | "ledgerAccount" | "gameSession" | "redemptionRequest";

type WhereFragment = Record<string, unknown>;

// Matches nothing — used to deny reads a principal must never see.
const MATCH_NONE: WhereFragment = { id: { in: [] as string[] } };

function operatorSubtree(path: string): WhereFragment {
  return { OR: [{ path }, { path: { startsWith: `${path}.` } }] };
}

/** The where-fragment to AND into a model's read, or `null` for no scoping. */
function scopeFilter(model: ScopedModel, scope: ScopeContext): WhereFragment | null {
  if (scope.kind === "system" || scope.bypass) return null;

  if (scope.kind === "operator") {
    if (!scope.path) return MATCH_NONE;
    const op = operatorSubtree(scope.path);
    switch (model) {
      case "operator":
        return op;
      case "player":
        return { operator: op };
      case "ledgerAccount":
        return { OR: [{ operator: op }, { player: { operator: op } }] };
      case "gameSession":
      case "redemptionRequest":
        return { player: { operator: op } };
    }
  }

  // player principals may only ever read their own rows
  if (!scope.playerId) return MATCH_NONE;
  switch (model) {
    case "operator":
      return MATCH_NONE;
    case "player":
      return { id: scope.playerId };
    case "ledgerAccount":
    case "gameSession":
    case "redemptionRequest":
      return { playerId: scope.playerId };
  }
}

function withScope(existing: unknown, fragment: WhereFragment): WhereFragment {
  return existing ? { AND: [existing, fragment] } : fragment;
}

export type ScopedPrismaClient = ReturnType<typeof createScopedPrisma>;

export function createScopedPrisma(base: PrismaClient, getScope: () => ScopeContext | undefined) {
  const inject = (model: ScopedModel, operation: string, args: { where?: unknown }): void => {
    // Only reads are filtered here; writes are gated by the ScopeGuard + services.
    if (!READ_OPS.has(operation)) return;
    const scope = getScope();
    // Fail closed: a scoped read with no scope context is a wiring bug — deny it
    // rather than leak. System/pre-auth code uses the un-extended prismaSystem.
    if (!scope) {
      args.where = withScope(args.where, MATCH_NONE);
      return;
    }
    const fragment = scopeFilter(model, scope);
    if (fragment === null) return;
    args.where = withScope(args.where, fragment);
  };

  return base.$extends({
    query: {
      operator: {
        $allOperations({ operation, args, query }) {
          inject("operator", operation, args as { where?: unknown });
          return query(args);
        },
      },
      player: {
        $allOperations({ operation, args, query }) {
          inject("player", operation, args as { where?: unknown });
          return query(args);
        },
      },
      ledgerAccount: {
        $allOperations({ operation, args, query }) {
          inject("ledgerAccount", operation, args as { where?: unknown });
          return query(args);
        },
      },
      gameSession: {
        $allOperations({ operation, args, query }) {
          inject("gameSession", operation, args as { where?: unknown });
          return query(args);
        },
      },
      redemptionRequest: {
        $allOperations({ operation, args, query }) {
          inject("redemptionRequest", operation, args as { where?: unknown });
          return query(args);
        },
      },
    },
  });
}
