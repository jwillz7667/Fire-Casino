# Superadmin & Agent Portal Audit — Credit-Flow Business Rules

_Audited 2026-06-16 against the owner's stated model (super admin mints to agents; agents fund/remove player credits). "Agent" == STORE tier. Produced by a 12-dimension multi-agent audit with adversarial verification._

## Executive summary

The system faithfully implements the owner's credit model in the default **OPERATOR** mode, with the three core concerns resolving as follows. **R8 (burn-not-refund): SAFE BY CONSTRUCTION, BUT THE LITERAL CAPABILITY IS UNBUILT.** There is no agent-facing endpoint that removes credits from a player anywhere in the codebase; recharge is add-only and rejects negative amounts (`money.ts:132` `zMinorPositive`), and every existing path that decreases a player balance (game bets, player-initiated redemptions) routes the credits to a *system* account, never back to the agent (`games.service.ts:285-286`, `redemptions.service.ts:244-245,308-309`). So the dangerous direction the owner feared — removal refunding the agent — is structurally impossible today; what is missing is the feature itself plus a dedicated sink account. **R4 (agents cannot mint): COMPLIANT.** `credit.mint` and `ledger.adjust` are SUPER_ADMIN-only in the base matrix and flagged `SUPER_ADMIN_ONLY_GRANTS`, the settings sanitizer strips any `permissions` field, and the only three ledger legs that credit an operator account are mint/transfer_down/fulfill — none invokable by a STORE token (`permissions.ts:119,135`, `credits.service.ts`, `orders.service.ts:144-214`). **R5 (agents only hold credits funded from above): COMPLIANT in OPERATOR mode** — a STORE's sole balance inflow is its parent transferring/fulfilling, ultimately rooted at a super-admin mint, and the ledger refuses to drive any operator account negative (`ledger.service.ts:290-299`). The one material caveat is mode-gated: in **COMPLIANCE (sweeps) mode** a leaf STORE can self-raise its own `prizeBonusBps` to 10x and hand colluding players redeemable PRIZE funded from a floorless PROMO sink, indirectly minting redeemable value it never funded (brushes R4/R10) — latent until sweeps mode is switched on. Net: holdings analytics, recharge, minting controls, and subtree isolation are correctly enforced; the gaps are the unbuilt R8 burn capability, the missing per-agent "credits sold to players" metric (R3b), and the COMPLIANCE-mode prize-bonus self-configuration.

## Scorecard

| Rule | Capability | Verdict |
|------|-----------|---------|
| R1 | Super admin can create agent accounts | COMPLIANT |
| R2 | Super admin can issue/mint credits to agents | COMPLIANT |
| R3 | Analytics: agent holdings (a) + credits sold to players (b) | PARTIAL |
| R4 | Agents cannot mint/create credits | COMPLIANT |
| R5 | Agents only hold credits funded from above; cannot self-inflate | COMPLIANT |
| R6 | Agents can create player accounts | COMPLIANT |
| R7 | Agents recharge their credits into players | COMPLIANT |
| R8 | Removing player credits is a BURN, not a refund to the agent | GAP |
| R9 | Console gates super-admin vs agent capabilities | PARTIAL |
| R10 | Agents confined to their own subtree/players | COMPLIANT |
| R11 | Ledger integrity across all credit operations | PARTIAL |
| R12 | Adversarial: ways an agent could violate the rules | PARTIAL |

> Note: R5 is enforced by the same machinery audited under R4 (no separate R5 dimension exists in the codebase; its verdict is derived from the R4 analysis).

## Findings

(Refuted finding R1-1 — the claim that the console can only create operators as a direct child of the caller — was **dropped**: the Organization page at `apps/console/src/app/(app)/org/page.tsx` renders the full subtree with an "Add child operator" button per non-STORE node that passes that node's id as `parentId`, so a super admin *can* nest an agent under an arbitrary in-subtree distributor through the UI.)

### Critical
None.

### High

**H1 — No per-agent metric for "credits an agent has SOLD to players" (R3b)** · Rule R3
- *Expected:* The super admin can see, per agent, the total credits that agent has recharged into its players' wallets.
- *Actual:* No report or endpoint aggregates RECHARGE outflow grouped by agent. `creditFlow` buckets recharges by **time only** across the whole subtree (`reports.service.ts:127,142` — `GROUP BY 1`); `overview.netRechargesTodayMinor` is subtree-wide (`reports.service.ts:81`); `playerActivity` is per-player (top-100); `getStats` returns current circulation, not cumulative sold. The recharge DEBIT lands on the operator account (`wallet.service.ts:76`) so the data exists, but nothing rolls it up by `operatorId`.
- *Fix:* Add a reports endpoint that `GROUP BY operatorId` over RECHARGE DEBITs on operator accounts within the caller's subtree, returning `{operatorId, rechargedToPlayersMinor}`, surfaced alongside each agent's holdings. Fully derivable from existing ledger data; no migration needed.

**H2 — No dedicated sink/void/house ledger account and no burn operation (R8/R11 foundation)** · Rule R11
- *Expected:* A sink/void/house SystemAccount exists and absorbs R8 burns (player DEBIT → system CREDIT, agent untouched).
- *Actual:* `systemAccountSchema` is `[MINT, REVENUE, REDEMPTION_CLEARING, PROMO, ADJUSTMENT, ROUNDING]` — **no VOID/SINK/HOUSE/BURN** (`enums.ts:46-53`, mirrored in `schema.prisma:203-210`). No service method debits a player as a burn. The only credit-destroying flow is redemption settle draining `REDEMPTION_CLEARING → MINT` (`redemptions.service.ts:308-309`), which is the player-initiated redemption path, not an agent burn.
- *Fix:* When R8 is built, add a dedicated `BURN`/`VOID` SystemAccount to the zod enum, Prisma enum, and the reconciliation `SYSTEM_SIGN` map, and model removal as a balanced `LedgerService.post()` with the player on DEBIT and the new sink on CREDIT (never an operator leg). This is an *absent-capability gap*, not an active money leak.

### Medium

**M1 — No agent-initiated player-credit removal/burn capability exists (R8 unimplemented)** · Rule R8
- *Expected:* An agent can REMOVE credits from a player where player balance goes down, agent balance is unchanged, and the credits go to a void/house/sink (a burn).
- *Actual:* No such endpoint. The wallet controller exposes only `recharge`, `recharge-request`, and reads (`wallet.controller.ts:33-76`); the players controller exposes create/list/get/history/update/suspend/reset-password/transfer (`players.controller.ts:31-112`) — no deduct/debit/clawback/forfeit/adjust route. `updatePlayerSchema` permits only displayName/phone/email and Player has no balance field, so PATCH cannot move money. Recharge cannot be abused as a negative deduction (`zMinorPositive`, `money.ts:132`). `ledger.adjust` is defined SUPER_ADMIN-only but wired to **zero** endpoints (`permissions.ts:135`).
- *Fix:* Add `POST /wallet/remove` (or `/clawback`): player DEBIT → system sink CREDIT, no operator leg, idempotency-keyed and subtree-checked, gated by `player.recharge` or a new `player.remove` permission. Unit test asserting agent balance unchanged + sink absorbs the amount + ledger nets zero. (If the owner intends agents to *not* remove credits, document R8 as satisfied solely by the burn-on-redemption design and close it.)

**M2 — No "remove player credits" control anywhere in the console (R8 UI counterpart)** · Rule R9
- *Expected:* A gated agent control to remove credits from a player.
- *Actual:* The player detail page exposes only Recharge / Reset password / Suspend (`players/[id]/page.tsx:90-110`); the recharge dialog is add-only (Review disabled when `amount <= 0n`, `recharge-dialog.tsx:103`); the backend has no removal endpoint, so the console has nothing to surface.
- *Fix:* Ships together with M1 — add a gated "Remove credits" button on the player detail page behind the new removal permission.

**M3 — Per-agent "credits sold to players" derivation is capped at top-100 and not rendered in the console** · Rule R3
- *Expected:* If R3b is derived rather than first-class, the underlying data must be complete and reachable in the UI.
- *Actual:* `playerActivity` is hard-capped at `LIMIT 100` players by recharge (`reports.service.ts:222-223`) and never rolled up per operator, so long-tail agents are undercounted. The console reports page renders only the credit-flow tab; every other tab shows an "Export to view" placeholder (`reports/page.tsx:113-132`), and the export escape hatch is broken — `POST /reports/export` returns inline `{filename, csv}` but the console mutation types it as `{jobId?}`, ignores the body, and only toasts (`reports/page.tsx:63-75`). (Note: `creditFlow` *does* accept an uncapped `operatorId` filter at the API level, but the console never passes it and has no operator selector.)
- *Fix:* Build the server-side per-operator rollup from H1 (uncapped), render a per-agent summary table in-app, and fix the CSV-download wiring.

**M4 — COMPLIANCE mode: a STORE can self-configure its prize-bonus rate and mint redeemable PRIZE from the PROMO sink** · Rule R12 (brushes R4/R5/R10)
- *Expected:* An agent must not create/mint value (directly or indirectly) or inflate value in its subtree beyond what was funded from above; promo bonus rates are platform/operator policy, not a leaf agent's to set.
- *Actual:* `settings.manage` is in **every** tier's base set (`permissions.ts:141` `ALL_TIERS`), so a STORE may call `PUT /settings/node`. The schema allows `prizeBonusBps` up to `100_000` = 10x (`settings.ts:33`), `SettingsService.updateNode` writes it onto the caller's own node, and in COMPLIANCE mode `WalletService.recharge` honors it with no platform clamp (`wallet.service.ts:85-86,205-208`), granting the player `bps(amount, bonusBps)` of redeemable PRIZE from the `PROMO` system account with `allowNegative:["PROMO"]` and no floor (`wallet.service.ts:98-109`). The agent's own balance is not inflated (R5 holds), but a colluding player extracts up to 10x in redeemable value no one funded. Mode-gated: default `PLATFORM_MODE` is `OPERATOR` (`env.ts:20`).
- *Fix:* Move `prizeBonusBps` changes behind `platform.settings`/`compliance.manage` (or make it a platform-level setting), OR clamp the effective rate used in recharge to a platform-wide ceiling.

### Low

**L1 — `margin.soldCents` is operator-to-operator order value, easily mistaken for R3b** · Rule R3 — `soldCents` is computed from `CreditOrder` rows grouped by `sellerOperatorId` in off-platform **cents** (`reports.service.ts:284-298,313`), strictly operator→operator (`orders.service.ts:60-63`, `schema.prisma` CreditOrder has no player link). *Fix:* when adding the true R3b metric, name it distinctly (e.g. `rechargedToPlayersMinor`); the conflation risk is at the API/CSV/code level (`reports.service.ts:391,402` emit a raw `soldCents` header).

**L2 — No consolidated all-agents holdings view; list rows omit balance** · Rule R3 — `getBalances` is per-operator only (`operators.service.ts:294-300`, `GET /operators/:id/balance`); the list `NODE_SELECT` excludes balance and the console columns are name/tier/status/depth/created (`operators/page.tsx:33-39`). The spec'd player-list "lifetime recharged" column (outline-docs/06 §3.6, line 106) is also unimplemented. R3a is functionally met one agent at a time. *Fix:* add a balance column to the operators list and the lifetime-recharged column to the players list.

**L3 — `players.service` by-id reads/mutations rely solely on the ScopeGuard (no in-service subtree backstop)** · Rule R10 — `get/history/update/suspend/resetPassword` run against the un-scoped `this.system` client with no `isInSubtree` check (`players.service.ts:146,174-208,252,266,290`), unlike `wallet.recharge` (`wallet.service.ts:59`) and `operators.setGrants` (`operators.service.ts:227`). The scoped-Prisma extension only filters READS and only on the scoped client, so layer 2 does not engage here. No current exploit (every route carries `@ScopeCheck`), but the documented two-layer invariant collapses to one. *Fix:* add a one-line `isInSubtree(caller.path, player.operator.path)` backstop to each method.

**L4 — `operators.update()` relies solely on the controller ScopeGuard** · Rule R12 — writes via un-scoped `this.system` with no `isInSubtree` (`operators.service.ts:188-211`); depends entirely on the `@ScopeCheck` at `operators.controller.ts:86`. Not STORE-exploitable (`operator.set_pricing` is NON_STORE), but single-layer. `setStatus`/`close` similarly block only self via `id===caller.operatorId`. *Fix:* add an in-service `isInSubtree` assertion mirroring recharge/setGrants.

**L5 — `player.recharge` is held by ADMIN as well as STORE** · Rule R7 — base matrix grants it to `["ADMIN","STORE"]` (`permissions.ts:125`). This is **intended and spec'd** (outline-docs/04 §3 marks ADMIN `✓*` = "only within an assigned branch"), and the code enforces exactly that (controller `@ScopeCheck` + `wallet.service.ts:59`). The recharge always debits the caller's own account, so no free credits. *Fix:* none required; documented design (ADMIN as scope-bounded support tooling).

**L6 — Player username is globally unique, not per-store; cross-store collisions surface as opaque 409** · Rule R6 — `username String @unique` (`schema.prisma:141`), written directly (`players.service.ts:98`), P2002 mapped to a generic `409 "Resource already exists"` (`exception.filter.ts:74-75`). An agent gets an unactionable failure for a username it cannot see (intentional, since username is the player's global login handle — `auth.service.ts:127-128`). *Fix (UX, not security):* return "Username already taken", or switch to composite `@@unique([operatorId, username])` and adjust login lookup.

**L7 — Operators nav/page shown to leaf STORE with misleading empty-state copy** · Rule R9 — gated on `operator.view_subtree` (ALL_TIERS, `permissions.ts:118`), so STORE sees the page; the "Add operator" button is correctly hidden (`canCreate` false) but the empty state unconditionally reads "Create your first child operator to get started." (`operators/page.tsx:73-74`). *Fix:* hide the nav item for STORE or make the copy conditional on `canCreate` (as the Players page already does, `players/page.tsx:108`).

**L8 — Ledger account rows created outside the posting transaction (benign zero-balance orphans on rollback)** · Rule R11 — `resolveAccounts`/`getOrCreateAccount` create rows via the autocommit system client before `$transaction` opens (`ledger.service.ts:87,376-393`); a rollback leaves a balance-0, zero-entry account. All five reconciliation checks tolerate it; concurrent races handled by the P2002 catch. *Fix:* optional — move account upsert inside the `$transaction`, or periodically prune zero-balance/zero-entry accounts.

### Informational notes (upheld, no action required for R1–R8)

- **R1-2:** Create-operator dialog subtitle says "one tier below" but the picker offers all strictly-lower tiers (`create-operator-dialog.tsx:38,133`; `enums.ts:170`). Cosmetic copy fix → "any tier below".
- **R2-1:** Mint idempotency key is `issue:{caller}:{key}` (`credits.service.ts:50`) — caller-scoped, not keyed on target/amount. Standard client-owns-the-key semantics; optionally return 409 on replayed key with a different operator/quantity.
- **R4-1:** `ledger.adjust` is declared and grantable (SUPER_ADMIN-only) but wired to **no** endpoint — latent, currently safer for R4. Add an ADR; if ever implemented, route only through a SYSTEM source/sink and keep it SUPER_ADMIN-base-only.
- **R7-2 / R8-2 / R12-2:** Positive confirmations — COMPLIANCE-mode PRIZE bonus is house-funded and never credits the agent; every player-balance-decrease path credits a SYSTEM account, never an operator; the refund-on-removal vector is structurally absent.
- **R9-3:** Credits page shows an always-empty seller "Inbox" tab to leaf STORE (`credits/page.tsx:83-90`); optionally gate on `order.fulfill`.
- **R10-2 / R11-2 / R11-3:** Scoped Prisma extension filters reads only (writes rely on guard+service, currently fully covered); game bet/win are two atomic idempotent transactions rather than one round transaction — both correct.

## How credits actually flow today

- **Mint (R2):** `SUPER_ADMIN` → `POST /credits/issue` → `CreditsService.issue` (`credits.service.ts:38-69`) posts a balanced double-entry: **DEBIT system `MINT` → CREDIT target operator account**, idempotency-keyed `issue:{caller}:{key}`, subtree-scoped target. Since the super admin is the tree root, it can mint directly into any agent's balance.
- **Down the tree (R5 inflow):** buyer calls `order.request_up`; the parent fulfills via `order.fulfill` (`orders.service.ts:144-214`) — which *mints* when the seller is SUPER_ADMIN, otherwise *transfers* — or the parent pushes `credit.transfer_down` (`credits.service.ts:72-100`): **DEBIT parent → CREDIT child**. ⇒ An agent's (STORE) balance rises **only** via its parent, ultimately rooted at a super-admin mint. A STORE token can invoke none of the operator-crediting legs itself.
- **Agent → player recharge (R7):** `POST /wallet/recharge` → `WalletService.recharge` (`wallet.service.ts:45-121`). **OPERATOR mode:** **DEBIT agent operator account → CREDIT player wallet** in `CREDIT` currency (`:76-77`), amounts strictly positive BigInt, overdraft blocked (`ledger.service.ts:290-299`). **COMPLIANCE mode:** **DEBIT agent `PLAY` → CREDIT player `PLAY`**, plus a separate house-funded **DEBIT system `PROMO` → CREDIT player `PRIZE`** bonus (`:84-109`) — the agent is never credited.
- **Player balance decreases (none refund the agent):** game bet → **DEBIT player → CREDIT system `REVENUE`** (`games.service.ts:285-286`); player-initiated redemption → approve **DEBIT player → CREDIT system `REDEMPTION_CLEARING`** (`redemptions.service.ts:244-245`), settle **DEBIT `REDEMPTION_CLEARING` → CREDIT `MINT`** (burn out of circulation, `:308-309`), cancel **`REDEMPTION_CLEARING` → player** (back to the player, never the agent, `:344-345`).
- **Removal / burn (R8): does not exist.** No agent-callable endpoint debits a player wallet; recharge is add-only and `zMinorPositive` (`money.ts:132`) blocks negative amounts; there is no `VOID/SINK/HOUSE/BURN` SystemAccount. The forbidden "refund to agent on removal" is therefore impossible — but so is the removal feature itself.

## Recommended changes (prioritized to fully meet R1–R8)

1. **Build the R8 burn capability end-to-end (closes R8-M1, R9-M2, R11-H2).** Add a `BURN`/`VOID` SystemAccount to `enums.ts:46-53`, `schema.prisma:203-210`, and the reconciliation `SYSTEM_SIGN` map. Add `POST /wallet/remove`: balanced `LedgerService.post()` with **player DEBIT → sink CREDIT, no operator leg**, idempotency-keyed, `@ScopeCheck` + in-service `isInSubtree`, gated by a new `player.remove` permission (or `player.recharge`). Add a unit test asserting agent balance unchanged, sink absorbs the amount, ledger nets zero. Surface a gated "Remove credits" button on `players/[id]/page.tsx`.
2. **Add the per-agent "credits sold to players" metric (closes R3-H1, R3-M3, R3-L1).** New reports endpoint: `GROUP BY operatorId` over RECHARGE DEBITs on operator accounts within the caller's subtree, uncapped, named `rechargedToPlayersMinor` (distinct from `margin.soldCents`). Render a per-agent table in the console and fix the broken CSV-export download wiring (`reports/page.tsx:63-75`).
3. **Close the COMPLIANCE-mode prize-bonus self-config hole (closes R12-M4).** Move `prizeBonusBps` behind `platform.settings`/`compliance.manage`, or make it a platform-level setting, or clamp the effective rate to a platform ceiling in `WalletService.recharge`. Add a floor/cap so PROMO cannot fund unbounded redeemable PRIZE.
4. **Strengthen R3a holdings visibility (closes R3-L2).** Add a balance column to the operators list (extend `NODE_SELECT` + balance) for an all-agents-at-a-glance view; implement the spec'd player-list "lifetime recharged" column.
5. **Restore the two-layer subtree invariant uniformly (closes R10-L3, R12-L4).** Add in-service `isInSubtree` backstops to `PlayersService.get/history/update/suspend/resetPassword` and `OperatorsService.update/setStatus/close`. Add a lint rule or test asserting every operator-write route declares `@ScopeCheck` or asserts subtree ownership.
6. **UX correctness polish.** Fix "one tier below" → "any tier below" copy (R1-2); conditional operators empty-state / hide nav for STORE (L7); gate the seller Inbox tab on `order.fulfill` (R9-3); clearer player-username 409 message or composite unique (L6).
7. **Document intent.** ADR for the unwired `ledger.adjust` permission (R4-1); note the mint idempotency contract — fresh key per logical mint (R2-1); confirm ADMIN-recharge is the intended scoped support path (L5, already spec'd).
---

## Implementation addendum (2026-06-16, branch `feat/agent-credit-removal-and-analytics`)

The recommendations were implemented in the same session. Mapping finding → change:

### R8 — Agent-initiated player credit removal as a BURN (M1, H2)
- New write-only system account **`SINK`** and ledger tx type **`CREDIT_REMOVAL`** (`packages/shared/src/enums.ts`, `packages/db/prisma/schema.prisma`, migration `20260616210000_agent_credit_removal`).
- New permission **`player.deduct`** — base set `[ADMIN, STORE]`, structural (not grantable), so a STORE can never confer or escalate it (`packages/shared/src/permissions.ts`).
- `WalletService.removeCredits` posts a single balanced `CREDIT_REMOVAL` txn: **player DEBIT → SINK CREDIT**. The agent account is never a leg, so a removal can never refund or inflate the agent. The player cannot be driven negative (ledger rejects it), so an agent can only remove up to the balance it funded. Targets the operator-funded currency (CREDIT / PLAY), never redeemable PRIZE. Idempotency-keyed, subtree-checked, audited (`wallet.remove`).
- `POST /wallet/remove` — `@RequirePermission("player.deduct")`, `@ScopeCheck` on `playerId`, money rate-limit, idempotency header.
- Reconciliation: `SINK` declared `non_negative` and added to settlement-sanity. The circulation identity (`Σ non-MINT == −MINT`) is preserved because the burn keeps total non-MINT constant.
- Tests: `wallet.integration.test.ts` asserts agent balance unchanged + SINK credited + ledger integrity, no-overdraft, idempotent replay, and cross-subtree rejection. `permissions.test.ts` covers `player.deduct`.

### R3 — Per-agent analytics: holdings + credits sold to players (H1, M3)
- `ReportsService.agentSales` aggregates, per operator in the caller's subtree: current **holdings** (live balance), **sold to players** (RECHARGE outflow), and **removed/burned** (CREDIT_REMOVAL), with a net column. No top-100 cap.
- `GET /reports/agent-sales` (+ `agent-sales` CSV export type) and an **Agent sales** table rendered in the console reports page.

### R9 — Console "remove credits" control (M2)
- `RemoveCreditsDialog` (burn-framed, reason required, capped at the player's balance) wired into the player detail page, gated on `player.deduct`.

### R12 — COMPLIANCE-mode prize-bonus self-escalation
- `SettingsService.updateNode` now rejects `prizeBonusBps` changes unless the caller holds `operator.set_pricing` (STORE does not) — closing the leaf-agent self-mint-via-PROMO vector.

### Known follow-ups (not in this change)
- PROMO account has no negative floor in COMPLIANCE mode (house-funded sweeps liability by design); add a configurable floor if desired.
- Per-agent prize-bonus configuration by an **upline** is not wired (operator schema is `.strict()`); add to `operators.update` if the product needs uplines to set a child's bonus.
