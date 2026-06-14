import { PrismaClient } from "@prisma/client";

/**
 * The un-extended ("system") Prisma client. Used by the ledger, background
 * workers, the seed, and migrations — code that legitimately operates across
 * the whole tree and on system accounts that have no subtree path.
 *
 * The subtree-scoped client extension (request handlers) is layered on top of
 * this in Phase 2 (scoped-client.ts).
 */
export const prismaSystem = new PrismaClient();

// Re-export the generated client surface (PrismaClient, the Prisma namespace,
// and all model/enum types) so consumers import everything from @aureus/db.
export * from "@prisma/client";
export { createScopedPrisma, type ScopedPrismaClient } from "./scoped-client";
