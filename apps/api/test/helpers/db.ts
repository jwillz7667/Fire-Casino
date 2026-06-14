import { hash } from "@node-rs/argon2";
import { type OperatorTier, type Prisma, PrismaClient } from "@aureus/db";

const url =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://aureus:aureus@localhost:5432/aureus_test";

/** A dedicated Prisma client bound to the test database. */
export const testPrisma = new PrismaClient({ datasourceUrl: url });

/** Truncate every table (except the migrations bookkeeping) for a clean slate. */
export async function resetDb(): Promise<void> {
  const rows = await testPrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export function hashTestPassword(plain: string): Promise<string> {
  return hash(plain, { memoryCost: 8192, timeCost: 1, parallelism: 1 });
}

/** Create a User+Operator node with a CREDIT ledger account. */
export async function createOperator(args: {
  username: string;
  tier: OperatorTier;
  parent?: { id: string; path: string; depth: number } | null;
  pathSegment: number;
  password?: string;
  settings?: Record<string, unknown>;
}): Promise<{ id: string; operatorId: string; userId: string; username: string; path: string; depth: number }> {
  const passwordHash = await hashTestPassword(args.password ?? "Passw0rd!Test");
  const path = args.parent ? `${args.parent.path}.${String(args.pathSegment)}` : String(args.pathSegment);
  const depth = args.parent ? args.parent.depth + 1 : 0;
  const op = await testPrisma.operator.create({
    data: {
      tier: args.tier,
      displayName: args.username,
      parent: args.parent ? { connect: { id: args.parent.id } } : undefined,
      pathSegment: args.pathSegment,
      path,
      depth,
      settings: (args.settings ?? {}) as Prisma.InputJsonObject,
      user: { create: { username: args.username, passwordHash } },
      ledgerAccounts: { create: { ownerType: "OPERATOR", currency: "CREDIT", balanceMinor: 0n } },
    },
    select: { id: true, userId: true, path: true, depth: true },
  });
  return {
    id: op.id,
    operatorId: op.id,
    userId: op.userId,
    username: args.username,
    path: op.path,
    depth: op.depth,
  };
}

/** Create a player under an operator with a CREDIT wallet. */
export async function createPlayer(args: {
  username: string;
  operatorId: string;
  password?: string;
}): Promise<{ playerId: string; username: string }> {
  const passwordHash = await hashTestPassword(args.password ?? "Passw0rd!Test");
  const player = await testPrisma.player.create({
    data: {
      username: args.username,
      passwordHash,
      operator: { connect: { id: args.operatorId } },
      wallets: { create: { ownerType: "PLAYER", currency: "CREDIT", balanceMinor: 0n } },
    },
    select: { id: true },
  });
  return { playerId: player.id, username: args.username };
}
