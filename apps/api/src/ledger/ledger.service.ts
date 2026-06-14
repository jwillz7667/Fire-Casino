import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@aureus/db";
import { type Currency, type SystemAccount } from "@aureus/shared";
import { InsufficientFundsError } from "../common/errors/domain-error";
import { PRISMA_SYSTEM } from "../prisma/prisma.module";
import {
  type AccountSelector,
  assertBalanced,
  type Leg,
  type PostGroup,
  type PostInput,
  type PostResult,
  selectorKey,
} from "./ledger.types";

interface LockedRow {
  id: string;
  balanceMinor: bigint;
  version: number;
}

interface AccountRefs {
  idByKey: Map<string, string>;
  selectorById: Map<string, AccountSelector>;
}

const RETRYABLE_CODES = new Set(["P2034", "40001", "40P01"]);
const VERSION_CONFLICT = "P2034";

function isRetryable(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && RETRYABLE_CODES.has(e.code)) return true;
  const message = typeof e.message === "string" ? e.message : "";
  return message.includes("40001") || message.includes("40P01");
}

function isIdempotencyConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withConflictRetry<T>(fn: () => Promise<T>, max = 8): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isRetryable(error) && attempt < max) {
        await delay(2 ** attempt * 5 + Math.random() * 10);
        continue;
      }
      throw error;
    }
  }
}

function versionConflict(): Error {
  const error = new Error("ledger account version conflict") as Error & { code: string };
  error.code = VERSION_CONFLICT;
  return error;
}

/**
 * The double-entry ledger (docs/03 §3) — the platform's heart. Every balance
 * change goes through post()/postBatch(): balanced-or-throw, idempotent, atomic,
 * with per-entry balance snapshots and an optimistic version guard. Uses the
 * un-extended system client (system accounts have no subtree path).
 *
 * Concurrency model: `SELECT ... FOR UPDATE` on the involved account rows,
 * acquired in deterministic id order, is the real mutual exclusion — it
 * serializes writers and prevents deadlocks. Isolation is READ COMMITTED so a
 * lock waiter re-reads the latest committed balance (rather than aborting with a
 * 40001 serialization failure, as Serializable/RepeatableRead do under
 * contention — docs/03 §3 anticipates lowering the level while keeping the row
 * locks + version guard). The bounded retry wrapper still covers rare deadlocks
 * (40P01) and version conflicts; the optimistic version guard is the backstop.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(PRISMA_SYSTEM) private readonly prisma: PrismaClient) {}

  /** Post one balanced single-currency transaction. */
  async post(input: PostInput): Promise<PostResult> {
    assertBalanced(input.legs, input.currency);
    const refs = await this.resolveAccounts(input.legs);
    const allowNegative = new Set(input.allowNegative ?? []);

    const run = (): Promise<PostResult> =>
      this.prisma.$transaction(
        async (tx) => {
          const dup = await tx.ledgerTransaction.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: { id: true },
          });
          if (dup) return { transactionId: dup.id, replayed: true };

          const state = await this.lockAccounts(tx, this.idsOf(input.legs, refs));
          const transaction = await tx.ledgerTransaction.create({
            data: {
              type: input.type,
              currency: input.currency,
              idempotencyKey: input.idempotencyKey,
              actorUserId: input.actor?.userId,
              actorPlayerId: input.actor?.playerId,
              refType: input.ref?.type,
              refId: input.ref?.id,
              memo: input.memo,
            },
            select: { id: true },
          });

          await this.applyLegs(tx, transaction.id, input.legs, input.currency, refs, state, allowNegative);
          await this.commitBalances(tx, state);
          await this.writeBalanceOutbox(tx, state, refs);

          return { transactionId: transaction.id, replayed: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
      );

    return this.runWithIdempotency(run, input.idempotencyKey);
  }

  /**
   * Post several balanced single-currency groups atomically in one transaction
   * (e.g. compliance recharge: a PLAY purchase + a PRIZE bonus). Each group has
   * its own type/currency/idempotency key; all commit or none do.
   */
  async postBatch(
    groups: PostGroup[],
    meta?: { actor?: PostInput["actor"]; ref?: PostInput["ref"]; memo?: string },
  ): Promise<PostResult[]> {
    if (groups.length === 0) return [];
    for (const group of groups) assertBalanced(group.legs, group.currency);

    const allLegs = groups.flatMap((g) => g.legs);
    const refs = await this.resolveAccounts(allLegs);
    const keys = groups.map((g) => g.idempotencyKey);

    const run = (): Promise<PostResult[]> =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.ledgerTransaction.findMany({
            where: { idempotencyKey: { in: keys } },
            select: { id: true, idempotencyKey: true },
          });
          if (existing.length === groups.length) {
            const byKey = new Map(existing.map((e) => [e.idempotencyKey, e.id]));
            return keys.map((k) => ({ transactionId: byKey.get(k) ?? "", replayed: true }));
          }
          if (existing.length !== 0) {
            throw versionConflict(); // partial batch — retry/abort
          }

          const state = await this.lockAccounts(tx, this.idsOf(allLegs, refs));
          const results: PostResult[] = [];
          for (const group of groups) {
            const allowNegative = new Set(group.allowNegative ?? []);
            const transaction = await tx.ledgerTransaction.create({
              data: {
                type: group.type,
                currency: group.currency,
                idempotencyKey: group.idempotencyKey,
                actorUserId: meta?.actor?.userId,
                actorPlayerId: meta?.actor?.playerId,
                refType: meta?.ref?.type,
                refId: meta?.ref?.id,
                memo: meta?.memo,
              },
              select: { id: true },
            });
            await this.applyLegs(
              tx,
              transaction.id,
              group.legs,
              group.currency,
              refs,
              state,
              allowNegative,
            );
            results.push({ transactionId: transaction.id, replayed: false });
          }
          await this.commitBalances(tx, state);
          await this.writeBalanceOutbox(tx, state, refs);
          return results;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 },
      );

    return this.runWithIdempotencyBatch(run, keys);
  }

  /** Cached balance for an account (0 if it does not exist yet). */
  async getBalance(selector: AccountSelector): Promise<bigint> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: this.selectorWhere(selector),
      select: { balanceMinor: true },
    });
    return account?.balanceMinor ?? 0n;
  }

  /** Balance derived from summing entries — for reconciliation (docs/03 §7). */
  async deriveBalance(accountId: string): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<{ bal: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END), 0)::bigint AS bal
      FROM ledger_entries WHERE "accountId" = ${accountId}`);
    return rows[0]?.bal ?? 0n;
  }

  // ---- internals -------------------------------------------------------------

  private async runWithIdempotency(
    run: () => Promise<PostResult>,
    idempotencyKey: string,
  ): Promise<PostResult> {
    try {
      return await withConflictRetry(run);
    } catch (error) {
      if (isIdempotencyConflict(error)) {
        const existing = await this.prisma.ledgerTransaction.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        if (existing) return { transactionId: existing.id, replayed: true };
      }
      throw error;
    }
  }

  private async runWithIdempotencyBatch(
    run: () => Promise<PostResult[]>,
    keys: string[],
  ): Promise<PostResult[]> {
    try {
      return await withConflictRetry(run);
    } catch (error) {
      if (isIdempotencyConflict(error)) {
        const existing = await this.prisma.ledgerTransaction.findMany({
          where: { idempotencyKey: { in: keys } },
          select: { id: true, idempotencyKey: true },
        });
        if (existing.length === keys.length) {
          const byKey = new Map(existing.map((e) => [e.idempotencyKey, e.id]));
          return keys.map((k) => ({ transactionId: byKey.get(k) ?? "", replayed: true }));
        }
      }
      throw error;
    }
  }

  private idsOf(legs: Leg[], refs: AccountRefs): string[] {
    const ids = new Set<string>();
    for (const leg of legs) {
      const id = refs.idByKey.get(selectorKey(leg.account));
      if (id) ids.add(id);
    }
    return [...ids].sort();
  }

  private async lockAccounts(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<Map<string, { read: number; balance: bigint }>> {
    const rows = await tx.$queryRaw<LockedRow[]>(Prisma.sql`
      SELECT id, "balanceMinor", version FROM ledger_accounts
      WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    if (rows.length !== ids.length) {
      throw versionConflict();
    }
    return new Map(rows.map((r) => [r.id, { read: r.version, balance: r.balanceMinor }]));
  }

  private async applyLegs(
    tx: Prisma.TransactionClient,
    transactionId: string,
    legs: Leg[],
    currency: Currency,
    refs: AccountRefs,
    state: Map<string, { read: number; balance: bigint }>,
    allowNegative: Set<SystemAccount>,
  ): Promise<void> {
    for (const leg of legs) {
      const id = refs.idByKey.get(selectorKey(leg.account));
      if (!id) throw versionConflict();
      const slot = state.get(id);
      if (!slot) throw versionConflict();

      const delta = leg.direction === "CREDIT" ? leg.amountMinor : -leg.amountMinor;
      const next = slot.balance + delta;
      if (next < 0n && !this.isNegativeAllowed(id, refs, allowNegative)) {
        // Do not leak the internal account identity (e.g. MINT/REVENUE/another
        // owner) to the client — only the currency and attempted amount (L7).
        throw new InsufficientFundsError("Insufficient funds", {
          currency,
          attempted: leg.amountMinor.toString(),
        });
      }
      slot.balance = next;
      await tx.ledgerEntry.create({
        data: {
          transactionId,
          accountId: id,
          direction: leg.direction,
          amountMinor: leg.amountMinor,
          currency,
          balanceAfterMinor: next,
        },
      });
    }
  }

  /** One version-guarded balance update per distinct account. */
  private async commitBalances(
    tx: Prisma.TransactionClient,
    state: Map<string, { read: number; balance: bigint }>,
  ): Promise<void> {
    for (const [id, slot] of state) {
      const updated = await tx.ledgerAccount.updateMany({
        where: { id, version: slot.read },
        data: { balanceMinor: slot.balance, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw versionConflict();
    }
  }

  private async writeBalanceOutbox(
    tx: Prisma.TransactionClient,
    state: Map<string, { read: number; balance: bigint }>,
    refs: AccountRefs,
  ): Promise<void> {
    const events: Prisma.OutboxEventCreateManyInput[] = [];
    for (const [id, slot] of state) {
      const selector = refs.selectorById.get(id);
      if (!selector || selector.kind === "system") continue;
      const ownerRoom =
        selector.kind === "operator"
          ? `operator:${selector.operatorId}`
          : `player:${selector.playerId}`;
      events.push({
        type: "balance.changed",
        payload: {
          ownerType: selector.kind,
          currency: selector.currency,
          balanceMinor: slot.balance.toString(),
        },
        rooms: [ownerRoom],
      });
    }
    if (events.length > 0) await tx.outboxEvent.createMany({ data: events });
  }

  private isNegativeAllowed(
    id: string,
    refs: AccountRefs,
    allowNegative: Set<SystemAccount>,
  ): boolean {
    const selector = refs.selectorById.get(id);
    return selector?.kind === "system" && allowNegative.has(selector.systemKey);
  }

  private async resolveAccounts(legs: Leg[]): Promise<AccountRefs> {
    const idByKey = new Map<string, string>();
    const selectorById = new Map<string, AccountSelector>();
    for (const leg of legs) {
      const key = selectorKey(leg.account);
      if (idByKey.has(key)) continue;
      const id = await this.getOrCreateAccount(leg.account);
      idByKey.set(key, id);
      selectorById.set(id, leg.account);
    }
    return { idByKey, selectorById };
  }

  private async getOrCreateAccount(selector: AccountSelector): Promise<string> {
    const where = this.selectorWhere(selector);
    const existing = await this.prisma.ledgerAccount.findFirst({ where, select: { id: true } });
    if (existing) return existing.id;
    try {
      const created = await this.prisma.ledgerAccount.create({
        data: this.selectorCreate(selector),
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (isIdempotencyConflict(error)) {
        const again = await this.prisma.ledgerAccount.findFirst({ where, select: { id: true } });
        if (again) return again.id;
      }
      throw error;
    }
  }

  private selectorWhere(selector: AccountSelector): Prisma.LedgerAccountWhereInput {
    switch (selector.kind) {
      case "operator":
        return { ownerType: "OPERATOR", operatorId: selector.operatorId, currency: selector.currency };
      case "player":
        return { ownerType: "PLAYER", playerId: selector.playerId, currency: selector.currency };
      case "system":
        return { ownerType: "SYSTEM", systemKey: selector.systemKey, currency: selector.currency };
    }
  }

  private selectorCreate(selector: AccountSelector): Prisma.LedgerAccountCreateInput {
    switch (selector.kind) {
      case "operator":
        return {
          ownerType: "OPERATOR",
          currency: selector.currency,
          operator: { connect: { id: selector.operatorId } },
        };
      case "player":
        return {
          ownerType: "PLAYER",
          currency: selector.currency,
          player: { connect: { id: selector.playerId } },
        };
      case "system":
        return { ownerType: "SYSTEM", currency: selector.currency, systemKey: selector.systemKey };
    }
  }
}
