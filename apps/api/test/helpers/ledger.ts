import { type PrismaClient } from "@aureus/db";

/**
 * Ledger integrity invariants (docs/03 §7), reused by the Phase 7 gate:
 *  1. zero-sum: per currency, the sum of every account's balance is 0.
 *  2. cache-vs-derived: each account's cached balance equals the sum of its
 *     entries.
 * Order-independent, so safe to call after concurrent posts. Throws on any drift.
 */
export async function assertLedgerIntegrity(prisma: PrismaClient): Promise<void> {
  const accounts = await prisma.ledgerAccount.findMany({
    select: { id: true, currency: true, balanceMinor: true },
  });

  const perCurrency = new Map<string, bigint>();
  for (const a of accounts) {
    perCurrency.set(a.currency, (perCurrency.get(a.currency) ?? 0n) + a.balanceMinor);
  }
  for (const [currency, sum] of perCurrency) {
    if (sum !== 0n) {
      throw new Error(`zero-sum violated for ${currency}: total balance ${sum.toString()} != 0`);
    }
  }

  for (const a of accounts) {
    const rows = await prisma.$queryRaw<{ bal: bigint }[]>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END), 0)::bigint AS bal
      FROM ledger_entries WHERE "accountId" = ${a.id}`;
    const derived = rows[0]?.bal ?? 0n;
    if (derived !== a.balanceMinor) {
      throw new Error(
        `cache drift on ${a.id}: cached ${a.balanceMinor.toString()} != derived ${derived.toString()}`,
      );
    }
  }
}

/** No operator or player account is ever negative (only named system accounts may go negative). */
export async function assertNoOwnerNegative(prisma: PrismaClient): Promise<void> {
  const negative = await prisma.ledgerAccount.findFirst({
    where: { ownerType: { in: ["OPERATOR", "PLAYER"] }, balanceMinor: { lt: 0n } },
    select: { id: true, ownerType: true, balanceMinor: true },
  });
  if (negative) {
    throw new Error(
      `owner account went negative: ${negative.ownerType} ${negative.id} = ${negative.balanceMinor.toString()}`,
    );
  }
}

/** Snapshot continuity (docs/03 §7.3): per account, each entry's balanceAfter
 * equals the running signed sum. Order by (createdAt, id); reliable when each
 * account gets at most one entry per transaction. Throws on a break. */
export async function assertSnapshotContinuity(prisma: PrismaClient): Promise<void> {
  const accounts = await prisma.ledgerAccount.findMany({ select: { id: true } });
  for (const a of accounts) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: a.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { direction: true, amountMinor: true, balanceAfterMinor: true },
    });
    let running = 0n;
    for (const e of entries) {
      running += e.direction === "CREDIT" ? e.amountMinor : -e.amountMinor;
      if (running !== e.balanceAfterMinor) {
        throw new Error(
          `snapshot continuity broke on ${a.id}: running ${running.toString()} != snapshot ${e.balanceAfterMinor.toString()}`,
        );
      }
    }
  }
}
