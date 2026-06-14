import {
  type Currency,
  type EntryDirection,
  type LedgerTxType,
  type SystemAccount,
} from "@aureus/shared";

/** Identifies a ledger account by its natural owner identity. */
export type AccountSelector =
  | { kind: "operator"; operatorId: string; currency: Currency }
  | { kind: "player"; playerId: string; currency: Currency }
  | { kind: "system"; systemKey: SystemAccount; currency: Currency };

/** One side of a transaction. amountMinor is always positive; direction signs it. */
export interface Leg {
  account: AccountSelector;
  direction: EntryDirection;
  amountMinor: bigint;
}

export interface PostInput {
  type: LedgerTxType;
  currency: Currency;
  idempotencyKey: string;
  legs: Leg[];
  actor?: { userId?: string; playerId?: string };
  ref?: { type: string; id: string };
  memo?: string;
  /** System accounts permitted to go negative for THIS operation (default: none). */
  allowNegative?: SystemAccount[];
}

/** A single-currency balanced group within a postBatch (e.g. PLAY leg + PRIZE leg). */
export type PostGroup = Omit<PostInput, "actor" | "ref" | "memo">;

export interface PostResult {
  transactionId: string;
  replayed: boolean;
}

export class LedgerImbalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerImbalanceError";
  }
}

/**
 * Assert a transaction's legs balance (hard rule #2): every amount is positive
 * and, for the currency, the sum of CREDIT equals the sum of DEBIT. Pure — the
 * single definition of "balanced", unit-tested without a database.
 */
export function assertBalanced(legs: Leg[], currency: Currency): void {
  if (legs.length < 2) {
    throw new LedgerImbalanceError("a transaction needs at least two legs");
  }
  let credits = 0n;
  let debits = 0n;
  for (const leg of legs) {
    if (leg.amountMinor <= 0n) {
      throw new LedgerImbalanceError(`leg amount must be positive: ${leg.amountMinor.toString()}`);
    }
    if (leg.account.currency !== currency) {
      throw new LedgerImbalanceError(
        `leg currency ${leg.account.currency} does not match transaction currency ${currency}`,
      );
    }
    if (leg.direction === "CREDIT") credits += leg.amountMinor;
    else debits += leg.amountMinor;
  }
  if (credits !== debits) {
    throw new LedgerImbalanceError(
      `unbalanced: credits ${credits.toString()} != debits ${debits.toString()}`,
    );
  }
}

export function selectorKey(selector: AccountSelector): string {
  switch (selector.kind) {
    case "operator":
      return `op:${selector.operatorId}:${selector.currency}`;
    case "player":
      return `pl:${selector.playerId}:${selector.currency}`;
    case "system":
      return `sys:${selector.systemKey}:${selector.currency}`;
  }
}
