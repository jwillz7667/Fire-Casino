# 03 - Credit Ledger and Money Flow

This is the core of the platform. Read it twice. Everything that moves a balance goes through `LedgerService` as a double-entry transaction that nets to zero. No exceptions, no shortcuts.

---

## 1. Principles

1. **Double-entry.** Every `LedgerTransaction` has two or more `LedgerEntry` rows. For each currency in the transaction, the sum of debits equals the sum of credits. Net change across the system is always zero. Money is never created or destroyed except at the `MINT` account.
2. **Integer minor units, `BigInt`, everywhere.** No floats, no `number`. Helpers in `packages/shared/money.ts`.
3. **Cached balance, journaled truth.** `LedgerAccount.balanceMinor` is a cache updated in the same DB transaction as the entries. The entries are the source of truth. A reconciliation job proves the cache matches.
4. **Atomic + locked.** A money operation runs in one `prisma.$transaction`, locks the involved account rows (`SELECT ... FOR UPDATE`) in a deterministic order, validates, writes entries, updates cached balances, writes an outbox event, commits.
5. **Idempotent.** Every money operation takes an idempotency key. Replaying a key returns the original result without double-posting.
6. **Append-only history.** Entries and transactions are never updated or deleted. Corrections are new `ADJUSTMENT` or `REVERSAL` transactions.

---

## 2. Accounts in play

### System accounts (one per currency, created at seed)
- `MINT` — the source of issued credits. Debiting it issues credits into circulation. It runs unbounded negative; its magnitude equals total credits ever issued and still live (plus settled redemptions, see below). This is by design.
- `REVENUE` — house edge sink. Game losses flow here, wins flow out of here. Its balance over time is the platform's gross gaming win.
- `REDEMPTION_CLEARING` — holds prize credits burned during a redemption, awaiting offline cash settlement. On settle, this is drained to `MINT` (the credits leave circulation).
- `PROMO` — source of promotional grants (separate from MINT so promo cost is reportable).
- `ADJUSTMENT` — the counter-account for manual corrections. Always paired with an audit log.
- `ROUNDING` — absorbs sub-minor-unit remainders so everything stays integer and balanced.

### Owner accounts
- Each operator: one account in the active currency (or two in compliance mode if an operator ever holds prize credits — normally operators hold only `CREDIT`/`PLAY`; prize credits live only in player wallets and clearing).
- Each player wallet: `CREDIT` (operator mode) or `PLAY` + `PRIZE` (compliance mode).

> Convention: in OPERATOR mode the only currency is `CREDIT`. In COMPLIANCE mode operators transact in `PLAY` and players hold `PLAY` + `PRIZE`. Wherever this doc says "credits" without qualification, read it as the active operator currency.

---

## 3. The `LedgerService.post` primitive

Everything is built on one function. Pseudocode:

```ts
type Leg = { accountSelector: AccountSelector; direction: 'DEBIT' | 'CREDIT'; amountMinor: bigint };

async function post(input: {
  type: LedgerTxType;
  currency: Currency;
  idempotencyKey: string;
  legs: Leg[];
  actor: { userId?: string; playerId?: string };
  ref?: { type: string; id: string };
  memo?: string;
  allowNegative?: Set<SystemAccount>;   // accounts permitted to go negative (default: { MINT, REVENUE })
}): Promise<LedgerTransaction> {

  // 1. Idempotency: if a txn with this key exists, return it.
  const existing = await db.ledgerTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  // 2. Validate balance: per currency, sum(DEBIT) === sum(CREDIT).
  assertBalanced(legs);

  return db.$transaction(async (tx) => {
    // 3. Resolve accounts, lock rows in a deterministic order (sorted by account id) to avoid deadlocks.
    const accounts = await lockAccountsForUpdate(tx, legs);   // SELECT ... FOR UPDATE

    // 4. Re-check idempotency inside the txn (race safety).
    const dup = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey } });
    if (dup) return dup;

    // 5. Apply each leg: compute new balance, enforce non-negative unless allowed.
    for (const leg of legs) {
      const acct = accounts.get(leg);
      const delta = leg.direction === 'CREDIT' ? leg.amountMinor : -leg.amountMinor;
      const next = acct.balanceMinor + delta;
      if (next < 0n && !isNegativeAllowed(acct, allowNegative))
        throw new InsufficientFundsError(acct, leg.amountMinor);
      acct.balanceMinor = next;
    }

    // 6. Create the transaction + entries (with balanceAfter snapshots), update cached balances + version.
    const txn = await tx.ledgerTransaction.create({ data: { type, currency, idempotencyKey, ... } });
    for (const leg of legs) {
      const acct = accounts.get(leg);
      await tx.ledgerEntry.create({ data: {
        transactionId: txn.id, accountId: acct.id, direction: leg.direction,
        amountMinor: leg.amountMinor, currency, balanceAfterMinor: acct.balanceMinor,
      }});
      await tx.ledgerAccount.update({
        where: { id: acct.id, version: acct.versionAtRead },     // optimistic guard
        data: { balanceMinor: acct.balanceMinor, version: { increment: 1 } },
      });
    }

    // 7. Write outbox events for affected owners (balance.changed).
    await writeOutbox(tx, txn, accounts);

    return txn;
  }, { isolationLevel: 'Serializable', timeout: 10_000 });
}
```

Notes:
- **Lock ordering** by account id prevents deadlocks when two operations touch overlapping accounts.
- **Serializable isolation** plus row locks plus the version guard is deliberately redundant. Money correctness is worth the redundancy. If serializable causes too many retries under load, drop to `RepeatableRead` but keep the row locks and version guard, and add a bounded retry-on-conflict wrapper.
- **Idempotency** is checked before and inside the transaction. The unique constraint on `idempotencyKey` is the final backstop (a duplicate insert throws; catch it and return the existing row).
- **`allowNegative`** lets only system accounts go negative, and only the ones the operation names. A player or operator account going negative is always a bug and must throw.

All flows below are just specific `legs` arrays passed to `post`.

---

## 4. The money flows

For each: trigger, preconditions, the entries, side effects. Currency shown as `CREDIT` (operator mode); in compliance mode substitute `PLAY` except where `PRIZE` is called out.

### 4.1 Issue (mint) — super admin gives credits to an operator

Trigger: a `CreditOrder` with no seller (direct mint) is marked `PAID`, or super admin issues directly.

Preconditions: caller is `SUPER_ADMIN` (or an operator explicitly granted mint rights). Target operator is in caller's subtree. Order is paid.

Entries (`type: ISSUE`, allowNegative includes `MINT`):
```
DEBIT   MINT[CREDIT]              quantity
CREDIT  Operator[target][CREDIT] quantity
```
Side effects: order → `ISSUED`, link `issuedTxId`; audit `ledger.issue`; outbox `balance.changed` to target operator; update `Settlement`.

### 4.2 Transfer — operator sells credits to a direct child operator

Trigger: a `CreditOrder` between two operators is marked `PAID`, or a direct push.

Preconditions: caller is the seller or an ancestor/admin. Buyer is a **direct child** of seller. Seller balance ≥ quantity. (Multi-level distribution is just repeated one-level transfers.)

Entries (`type: TRANSFER`):
```
DEBIT   Operator[seller][CREDIT]  quantity
CREDIT  Operator[buyer][CREDIT]   quantity
```
Side effects: order → `ISSUED`; audit `ledger.transfer`; outbox to both operators; `Settlement` update (records the cash the buyer owes the seller at the agreed unit price).

> The agreed cash price (`unitPriceCents`) is recorded on the order and rolled into `Settlement` for margin reporting. The ledger moves only credit units. This is the separation that keeps the model clean.

### 4.3 Recharge — agent loads a player's wallet

Trigger: agent recharges a player (player paid cash offline).

Preconditions: caller is the player's owning operator (a `STORE`) or an ancestor. Operator balance ≥ amount. Player is `ACTIVE`, not self-excluded. Responsible-gaming deposit limits pass (`compliance.checkDeposit`). Region allowed.

OPERATOR mode entries (`type: RECHARGE`):
```
DEBIT   Operator[agent][CREDIT]   amount
CREDIT  Player[wallet][CREDIT]    amount
```

COMPLIANCE mode: the recharge is a purchase of `PLAY` credits with a bonus grant of `PRIZE` credits (the sweeps model). Two coupled postings (one transaction each, or one multi-currency... keep them as two transactions linked by `refId` since currencies differ):
```
# play purchase
DEBIT   Operator[agent][PLAY]     playAmount
CREDIT  Player[wallet][PLAY]      playAmount
# prize bonus (from PROMO, no operator cost — it's a sweepstakes grant)
DEBIT   PROMO[PRIZE]              prizeBonus
CREDIT  Player[wallet][PRIZE]     prizeBonus
```
Side effects: audit `wallet.recharge`; outbox `balance.changed` to player + agent; RG counters incremented; AML velocity scan enqueued.

### 4.4 Gameplay — bet and win

Games are stubbed, but the money is real. The arcade asks the API to place a bet; the server (not the client) calls the RGS, gets an outcome, and posts entries. See the RGS contract in `docs/05`.

Per round, two options:

**Option A — separate bet and win (clearer audit, recommended):**
```
# bet (always)
type GAME_BET
DEBIT   Player[wallet][cur]   betMinor
CREDIT  REVENUE[cur]          betMinor

# win (only if outcome.winMinor > 0)
type GAME_WIN
DEBIT   REVENUE[cur]          winMinor       (REVENUE may go negative intra-day; that's fine)
CREDIT  Player[wallet][cur]   winMinor
```

**Option B — netted single transaction (`GAME_ROUND_NET`)** for high round volume: post one transaction with the net (player net = win - bet). Use A for clarity unless round throughput forces B.

Preconditions: player `ACTIVE`, wallet ≥ bet, bet within game min/max, game `ACTIVE`, currency supported, session `ACTIVE`, RG wager limits pass, not self-excluded.

Currency rule (compliance mode): a round is played in exactly one currency. Bets and wins are same-currency. `PRIZE` wins are redeemable; `PLAY` wins are not. The player chooses play vs sweeps mode per session.

Side effects: write `GameRound` with `betTxId`/`winTxId`, update `GameSession` totals, outbox balance update, enqueue AML scan on large swings.

The placeholder RGS honors `Game.rtpBps`: over many rounds, total wins / total bets trends to RTP, and `REVENUE` accrues the edge. See `docs/05` for the stub algorithm.

### 4.5 Redemption — player cashes out (the reverse flow)

This is a workflow, not one event. Only `PRIZE` (compliance) or `CREDIT` (operator) redeems. `PLAY` never redeems.

**Step 1 — Request.** Player submits `RedemptionRequest` (amount, method). Preconditions: amount ≤ redeemable balance, KYC verified if amount ≥ `REDEMPTION_KYC_THRESHOLD_MINOR`, region allowed, not self-excluded, RG/AML checks pass. Status `PENDING`. No ledger movement yet, but **soft-reserve** the amount so the player can't double-spend it elsewhere (track reserved amount on the wallet via a `reservedMinor` derived value, or post a hold immediately — see below).

> Decision: post the hold at **approval**, and prevent double-spend between request and approval by checking `redeemableBalance - sumPendingRedemptions >= amount` at request time. Simpler than a separate reservation ledger and good enough. If you prefer hard reservation, post the hold at request time instead and reverse on reject.

**Step 2 — Approve (hold/burn).** An authorized operator (the owning agent, or an upline/admin per `Operator.settings.redemptionApproval`) approves. Entries (`type: REDEEM_HOLD`):
```
DEBIT   Player[wallet][PRIZE]        amount
CREDIT  REDEMPTION_CLEARING[PRIZE]   amount
```
Status `APPROVED`, link `holdTxId`. The player's redeemable balance drops now. A payable is recorded: the agent owes the player `amount` in cash (tracked via `Settlement`/redemption record). Outbox to player + operator.

**Step 3a — Settle (cash paid).** Agent pays the player offline, uploads proof, marks settled. Entries (`type: REDEEM_SETTLE`) drain clearing to mint (credits leave circulation):
```
DEBIT   REDEMPTION_CLEARING[PRIZE]   amount
CREDIT  MINT[PRIZE]                  amount
```
Status `PAID`, link `settleTxId`, set `settledAt`, `payoutRef`. Update `Settlement` (who funded the cash — agent now owes upline a credit buy-back, or gets reimbursed, per config; record it).

**Step 3b — Reject / Cancel before approval.** No ledger movement (nothing was held). Status `REJECTED`/`CANCELLED` with reason.

**Step 3c — Cancel after approval (reverse the hold).** Entries (`type: REDEEM_CANCEL`):
```
DEBIT   REDEMPTION_CLEARING[PRIZE]   amount
CREDIT  Player[wallet][PRIZE]        amount
```
Status `CANCELLED`, credits returned to player.

> Who funds the cash? Two common models, switchable in `Operator.settings`:
> - **Agent-funded**: the agent pays the player from their own pocket and is made whole by selling fewer credits / a credit-back from upline. Record the cash owed in `Settlement`.
> - **Upline-reimbursed**: the agent pays the player, then claims reimbursement up the chain. Record a reverse `Settlement` leg at each level.
> The ledger handles the credit side identically (burn to clearing, then to mint). The cash reconciliation differs only in the `Settlement` bookkeeping. Build agent-funded first; make the model a setting.

### 4.6 Promo grant

Trigger: player redeems a `Promotion` code, or an AMoE (no-purchase) sweeps grant.
```
type PROMO_GRANT
DEBIT   PROMO[cur]            grantMinor
CREDIT  Player[wallet][cur]   grantMinor
```
Enforce per-player and total limits. AMoE grants go to `PRIZE`. Audit + outbox.

### 4.7 Adjustment (manual correction)

`SUPER_ADMIN` only, always with a reason, always audited. Pairs the affected account against `ADJUSTMENT`.
```
type ADJUSTMENT
# to add credits to an account:
DEBIT   ADJUSTMENT[cur]       amount     (ADJUSTMENT allowed negative)
CREDIT  Target[cur]           amount
# to remove:
DEBIT   Target[cur]           amount
CREDIT  ADJUSTMENT[cur]       amount
```

### 4.8 Reversal

Reverse any prior transaction by posting its mirror with `type: REVERSAL`, linking `reversedById` both ways, and marking the original `REVERSED`. Use for mistaken transfers/recharges caught quickly.

---

## 5. Idempotency keys (how to build them)

The key must be stable for the same logical action and unique across different ones. Compose from the action + business object + actor:
- Issue/transfer from order: `order:{orderId}:issue`
- Recharge: client supplies a UUID per recharge attempt; server namespaces it `recharge:{operatorId}:{clientUuid}`
- Game bet: `round:{sessionId}:{nonce}:bet`, win: `round:{sessionId}:{nonce}:win`
- Redemption hold: `redeem:{requestId}:hold`, settle: `redeem:{requestId}:settle`, cancel: `redeem:{requestId}:cancel`

The arcade and console generate a UUID per user-initiated money action and send it as an `Idempotency-Key` header; the server combines it with context. Double-clicks, retries, and network replays all collapse to one posting.

---

## 6. Concurrency scenarios to handle (and test)

- **Two recharges from the same agent at once** draining the same operator balance: row lock on the operator account serializes them; the second sees the updated balance and either succeeds or hits insufficient funds.
- **Player bets while a redemption is being approved**: the wallet row lock serializes; whichever posts first wins, the other re-reads. The pending-redemption check prevents redeeming spent credits.
- **Double-submit of a credit order approval**: idempotency key `order:{id}:issue` collapses to one issue.
- **Reversal racing a settle**: both lock clearing/player rows; ordering by account id plus status checks (can't settle a cancelled request) prevent inconsistency. Guard with the workflow status, not just the ledger.

Write the integration test in `docs/09` to exercise these.

---

## 7. Reconciliation and integrity (scheduled jobs)

Run these on a schedule and on demand from the admin console:

1. **Zero-sum check**: for each currency, `SUM(entries where direction=CREDIT) - SUM(entries where direction=DEBIT) == 0`. Any nonzero is a critical alarm.
2. **Cache-vs-derived check**: for each `LedgerAccount`, recompute balance from entries and compare to `balanceMinor`. Drift is a critical alarm; auto-correct only via an audited `ADJUSTMENT`, never a silent UPDATE.
3. **Snapshot continuity**: each entry's `balanceAfterMinor` equals the prior entry's snapshot plus this entry's signed amount, per account.
4. **Circulation identity**: `-MINT.balance == sum(all operator balances) + sum(all player balances) + REDEMPTION_CLEARING.balance + PROMO.balance(spent) ...` — define the exact identity per mode and assert it. This proves no credits leaked.
5. **Settlement sanity**: redeemed-and-settled credit totals reconcile against `Settlement` cash positions within expected tolerance.

Surface results on an admin "Ledger Health" page (`docs/06`).

---

## 8. Money helper contract (`packages/shared/money.ts`)

```ts
export const MINOR = BigInt(process.env.CREDIT_MINOR_UNITS ?? 1000);
export const toMinor = (credits: number | string): bigint => /* parse decimal -> bigint, no float */;
export const fromMinor = (m: bigint): string => /* format with fixed dp */;
export const addMinor = (a: bigint, b: bigint) => a + b;
export const assertNonNegative = (m: bigint) => { if (m < 0n) throw new Error('negative amount'); };
export const bps = (amount: bigint, basisPoints: number): bigint => (amount * BigInt(basisPoints)) / 10000n;
// JSON: register a BigInt serializer that emits strings; parse known money fields back to BigInt at the boundary.
```

Never parse a decimal string into a JS `number` on the way to a balance. Parse straight to `BigInt` minor units.

---

## 9. What "no payment processor" means concretely

There is no Stripe, no card form, no ACH in this codebase. Every real-money event is represented by:
- a **`CreditOrder`** (an operator bought credits from its upline) or a **recharge** (a player bought credits from an agent), where the cash changed hands offline and the system records the amount, agreed price, method, reference, and proof; and
- a **redemption settlement** (an agent paid a player cash offline), recorded the same way.

The ledger moves credits; `Settlement` and the order/redemption records track the cash trail. That trail is the auditable replacement for a processor's transaction log. If a real processor is ever added (for operators to buy credits by card, say), it slots in as one more way to mark a `CreditOrder` paid, and nothing else in the ledger changes.
