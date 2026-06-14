import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@aureus/db";
import { type SystemAccount } from "@aureus/shared";
import { ValidationError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";

export interface ReconCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReconResult {
  ranAt: string;
  checks: ReconCheck[];
}

type ExpectedSign = "negative" | "positive" | "non_negative" | "any";

export interface SystemAccountBalance {
  systemKey: string;
  currency: string;
  balanceMinor: string;
  expectedSign: ExpectedSign;
  ok: boolean;
}

export interface TransactionLookup {
  id?: string;
  idempotencyKey?: string;
}

/**
 * Expected resting sign of each system account (docs/03 §2). MINT and PROMO are
 * sources — debited to move credits out — so they trend non-positive; clearing
 * holds burned credits pending settlement and must never be negative; REVENUE,
 * ADJUSTMENT and ROUNDING can land either way.
 */
const SYSTEM_SIGN: Record<SystemAccount, ExpectedSign> = {
  MINT: "negative",
  REVENUE: "any",
  REDEMPTION_CLEARING: "non_negative",
  PROMO: "negative",
  ADJUSTMENT: "any",
  ROUNDING: "any",
};

function okForSign(sign: ExpectedSign, balance: bigint): boolean {
  switch (sign) {
    case "negative":
      return balance <= 0n;
    case "positive":
      return balance > 0n;
    case "non_negative":
      return balance >= 0n;
    case "any":
      return true;
  }
}

/**
 * Ledger integrity reconciliation (docs/03 §7-8). The entries are the source of
 * truth; cached balances are a journaled cache. Each check is computed directly
 * in SQL against the system client (system accounts have no subtree path) and is
 * order-independent, so it is safe to run against a live ledger. Results feed the
 * admin Ledger Health page and the scheduled worker; nothing here mutates the
 * ledger — corrections are made only via an audited ADJUSTMENT transaction.
 */
@Injectable()
export class ReconciliationService {
  constructor(@Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient) {}

  async runAll(): Promise<ReconResult> {
    const checks: ReconCheck[] = [];
    checks.push(await this.zeroSum());
    checks.push(await this.cacheVsDerived());
    checks.push(await this.snapshotContinuity());
    checks.push(await this.circulationIdentity());
    checks.push(await this.settlementSanity());
    return { ranAt: new Date().toISOString(), checks };
  }

  /** Each system account's cached balance per currency, with expected-sign verdicts. */
  async systemAccountBalances(): Promise<SystemAccountBalance[]> {
    const rows = await this.prisma.ledgerAccount.findMany({
      where: { ownerType: "SYSTEM" },
      select: { systemKey: true, currency: true, balanceMinor: true },
      orderBy: [{ systemKey: "asc" }, { currency: "asc" }],
    });
    return rows.map((r) => {
      const sign = r.systemKey ? SYSTEM_SIGN[r.systemKey] : "any";
      return {
        systemKey: r.systemKey ?? "UNKNOWN",
        currency: r.currency,
        balanceMinor: r.balanceMinor.toString(),
        expectedSign: sign,
        ok: okForSign(sign, r.balanceMinor),
      };
    });
  }

  /** Transaction explorer: resolve a transaction by id or idempotency key with all legs. */
  async lookupTransaction(lookup: TransactionLookup) {
    const where = lookup.id
      ? { id: lookup.id }
      : lookup.idempotencyKey
        ? { idempotencyKey: lookup.idempotencyKey }
        : null;
    if (!where) throw new ValidationError("Provide a transaction id or idempotency key");

    const txn = await this.prisma.ledgerTransaction.findUnique({
      where,
      include: {
        entries: {
          orderBy: { createdAt: "asc" },
          include: {
            account: { select: { ownerType: true, operatorId: true, playerId: true, systemKey: true } },
          },
        },
      },
    });
    if (!txn) return null;

    return {
      transaction: {
        id: txn.id,
        type: txn.type,
        status: txn.status,
        currency: txn.currency,
        idempotencyKey: txn.idempotencyKey,
        actorUserId: txn.actorUserId,
        actorPlayerId: txn.actorPlayerId,
        refType: txn.refType,
        refId: txn.refId,
        memo: txn.memo,
        createdAt: txn.createdAt,
      },
      legs: txn.entries.map((e) => ({
        id: e.id,
        direction: e.direction,
        amountMinor: e.amountMinor.toString(),
        currency: e.currency,
        balanceAfterMinor: e.balanceAfterMinor.toString(),
        account: {
          ownerType: e.account.ownerType,
          operatorId: e.account.operatorId,
          playerId: e.account.playerId,
          systemKey: e.account.systemKey,
        },
      })),
    };
  }

  // ---- individual checks (docs/03 §7) ----------------------------------------

  /** (a) Per currency, the sum of every account balance is zero. */
  private async zeroSum(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<{ currency: string; total: bigint }[]>(Prisma.sql`
      SELECT currency::text AS currency, COALESCE(SUM("balanceMinor"), 0)::bigint AS total
      FROM ledger_accounts GROUP BY currency`);
    const bad = rows.filter((r) => r.total !== 0n);
    return {
      name: "zero-sum",
      ok: bad.length === 0,
      detail:
        bad.length === 0
          ? "every currency nets to zero"
          : bad.map((r) => `${r.currency}=${r.total.toString()}`).join("; "),
    };
  }

  /** (b) Each account's cached balanceMinor equals the signed sum of its entries. */
  private async cacheVsDerived(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<{ id: string; cached: bigint; derived: bigint }[]>(Prisma.sql`
      SELECT a.id,
        a."balanceMinor" AS cached,
        COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e."amountMinor" ELSE -e."amountMinor" END), 0)::bigint AS derived
      FROM ledger_accounts a
      LEFT JOIN ledger_entries e ON e."accountId" = a.id
      GROUP BY a.id, a."balanceMinor"
      HAVING a."balanceMinor" <> COALESCE(SUM(CASE WHEN e.direction = 'CREDIT' THEN e."amountMinor" ELSE -e."amountMinor" END), 0)
      LIMIT 50`);
    return {
      name: "cache-vs-derived",
      ok: rows.length === 0,
      detail:
        rows.length === 0
          ? "no cached-balance drift"
          : rows.map((r) => `${r.id}: cached ${r.cached.toString()} != derived ${r.derived.toString()}`).join("; "),
    };
  }

  /** (c) Per account, each entry's balanceAfterMinor equals the running signed sum. */
  private async snapshotContinuity(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<{ id: string; accountId: string; snapshot: bigint; running: bigint }[]>(
      Prisma.sql`
        SELECT s.id, s."accountId", s."balanceAfterMinor" AS snapshot, s.running
        FROM (
          SELECT e.id, e."accountId", e."balanceAfterMinor",
            SUM(CASE WHEN e.direction = 'CREDIT' THEN e."amountMinor" ELSE -e."amountMinor" END)
              OVER (PARTITION BY e."accountId" ORDER BY e."createdAt", e.id
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::bigint AS running
          FROM ledger_entries e
        ) s
        WHERE s.running <> s."balanceAfterMinor"
        LIMIT 50`,
    );
    return {
      name: "snapshot-continuity",
      ok: rows.length === 0,
      detail:
        rows.length === 0
          ? "balanceAfter chain unbroken on every account"
          : rows.map((r) => `${r.accountId}/${r.id}: running ${r.running.toString()} != snapshot ${r.snapshot.toString()}`).join("; "),
    };
  }

  /**
   * (d) Circulation identity per currency (docs/03 §7.4): the magnitude of the
   * MINT account equals all live circulation, i.e. for each currency the sum of
   * every NON-mint balance equals -MINT. Zero-sum already implies this; asserting
   * it explicitly proves no credits leaked outside the mint relationship.
   */
  private async circulationIdentity(): Promise<ReconCheck> {
    const rows = await this.prisma.$queryRaw<{ currency: string; mint: bigint; nonmint: bigint }[]>(Prisma.sql`
      SELECT currency::text AS currency,
        COALESCE(SUM(CASE WHEN "ownerType" = 'SYSTEM' AND "systemKey" = 'MINT' THEN "balanceMinor" ELSE 0 END), 0)::bigint AS mint,
        COALESCE(SUM(CASE WHEN NOT ("ownerType" = 'SYSTEM' AND "systemKey" = 'MINT') THEN "balanceMinor" ELSE 0 END), 0)::bigint AS nonmint
      FROM ledger_accounts GROUP BY currency`);
    const bad = rows.filter((r) => r.nonmint !== -r.mint);
    return {
      name: "circulation-identity",
      ok: bad.length === 0,
      detail:
        bad.length === 0
          ? "mint magnitude equals live circulation for every currency"
          : bad.map((r) => `${r.currency}: nonMint ${r.nonmint.toString()} != -mint ${(-r.mint).toString()}`).join("; "),
    };
  }

  /** (e) REDEMPTION_CLEARING never negative; mint/promo non-positive; no owner negative. */
  private async settlementSanity(): Promise<ReconCheck> {
    const sysRows = await this.prisma.$queryRaw<{ systemKey: string; currency: string; balance: bigint }[]>(Prisma.sql`
      SELECT "systemKey"::text AS "systemKey", currency::text AS currency, "balanceMinor" AS balance
      FROM ledger_accounts WHERE "ownerType" = 'SYSTEM'`);
    const ownerNeg = await this.prisma.$queryRaw<{ id: string; ownerType: string; balance: bigint }[]>(Prisma.sql`
      SELECT id, "ownerType"::text AS "ownerType", "balanceMinor" AS balance
      FROM ledger_accounts WHERE "ownerType" IN ('OPERATOR', 'PLAYER') AND "balanceMinor" < 0`);

    const problems: string[] = [];
    for (const r of sysRows) {
      if (r.systemKey === "REDEMPTION_CLEARING" && r.balance < 0n) {
        problems.push(`REDEMPTION_CLEARING[${r.currency}] negative ${r.balance.toString()}`);
      }
      if (r.systemKey === "MINT" && r.balance > 0n) {
        problems.push(`MINT[${r.currency}] positive ${r.balance.toString()}`);
      }
      if (r.systemKey === "PROMO" && r.balance > 0n) {
        problems.push(`PROMO[${r.currency}] positive ${r.balance.toString()}`);
      }
    }
    for (const r of ownerNeg) {
      problems.push(`${r.ownerType} ${r.id} negative ${r.balance.toString()}`);
    }
    return {
      name: "settlement-sanity",
      ok: problems.length === 0,
      detail: problems.length === 0 ? "clearing non-negative; system signs as expected" : problems.join("; "),
    };
  }
}
