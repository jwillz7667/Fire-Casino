# 06 - Frontend: Console (back-office)

`apps/console` is the single back-office app. Super admin, every distributor tier, and stores/agents all log into the **same** app. What they see and can do is driven entirely by their principal's tier + permissions (`docs/04`) and their subtree scope. There is no separate "admin build" vs "vendor build" — one codebase, RBAC-gated.

Stack: Next.js 15 App Router, Tailwind + the design system in `packages/ui` (`docs/08`), server components for data fetching where possible, client components for interactive tables/forms. TanStack Query for client-side cache + optimistic updates on mutations. Socket.io client for live counters and queue badges. All money rendered through `fromMinor` with tabular figures.

---

## 1. Layout shell

```
┌────────────────────────────────────────────────────────┐
│ Topbar: logo · mode badge (OPERATOR/COMPLIANCE) ·       │
│         global search · balance pill · notifications ·  │
│         account menu                                    │
├──────────┬─────────────────────────────────────────────┤
│ Sidebar  │  Page content                               │
│ (nav,    │                                             │
│ scoped)  │                                             │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

- **Balance pill**: the operator's own credit balance(s), live via `balance.changed` on `operator:{selfId}`. Click opens a mini ledger drawer (last 20 entries).
- **Mode badge**: reads `PLATFORM_MODE`. In COMPLIANCE mode, redemption/KYC/geo nav items appear; in OPERATOR mode they're hidden or collapsed (redemptions still exist but simpler).
- **Notifications**: bell with unread count, fed by `Notification` + socket. Redemption queue and order inbox get their own badges in the sidebar.
- **Scope indicator**: under the logo, show the current node's display name and tier so a sub-distributor always knows "where they are" in the tree.

Sidebar items are filtered by permission. A store/agent sees a short list (Players, Recharge, Orders, Redemptions, Reports). A super admin sees everything.

---

## 2. Navigation map (by permission)

| Nav item | Route | Gate (permission) | Notes |
|---|---|---|---|
| Dashboard | `/` | always | KPIs scoped to subtree |
| Organization | `/org` | `operator.view_subtree` | tree / org chart |
| Operators | `/operators` | `operator.view_subtree` | list + manage children |
| Credits | `/credits` | `order.view` | issue + order inbox/outbox |
| Players | `/players` | `player.view` | scoped player list |
| Recharge | `/players` (action) | `wallet.recharge` | inline from player row/detail |
| Redemptions | `/redemptions` | `redemption.view` | approval queue |
| Reports | `/reports` | `report.view` | scoped reporting |
| Ledger health | `/ledger` | `report.ledger_health` | admin/finance only |
| Compliance | `/compliance` | `compliance.view` | COMPLIANCE mode; geo/KYC/AML |
| Audit | `/audit` | `audit.view` | append-only log viewer |
| Announcements | `/announcements` | `announcement.manage` | broadcast to subtree |
| Settings | `/settings` | `settings.manage` | platform + node settings |

Routes that load a node, player, order, or request always re-check scope server-side (`docs/04` §3). The frontend gate is convenience; the API is the real boundary.

---

## 3. Screens

### 3.1 Dashboard (`/`)
Scoped snapshot. All numbers are for the caller's subtree only.

- **KPI row**: Credits in circulation below me, Active players (subtree), Net recharges today, Pending redemptions (count + total), Pending orders (in/out).
- **Credit flow chart**: issued vs recharged vs redeemed over time (last 30d), pulled from ledger aggregates.
- **Activity feed**: recent ledger transactions in subtree (recharge, transfer, redemption) with actor, amount, time.
- **Attention list**: things needing action — redemptions awaiting my approval, orders awaiting my confirmation, AML flags (if compliance), low own-balance warning.

Super admin additionally gets: total minted, total revenue (house edge accrued to `REVENUE`), circulation identity check status (`docs/03` §8), settlement exposure (unpaid `CreditOrder` cash).

### 3.2 Organization / tree (`/org`)
- Interactive org chart of the caller's subtree (caller at root). Node card shows display name, tier, balance, child count, active/suspended status.
- Expand/collapse branches. Click a node → operator detail (3.4).
- Lazy-load deep branches via `GET /operators/:id/tree?depth=`.
- Toolbar: "Add operator" (if `operator.create_child`) opens the create form (3.3) pre-targeting the selected parent.
- Search/filter within subtree by name/tier/status.

### 3.3 Create operator (modal/flow)
Form fields: tier (only tiers strictly below caller's tier are selectable per `TIER_RANK`), display name, login username, temp password (generate button), optional buy/sell unit price cents (for margin reporting), optional settings (currency enablement, feature flags).

On submit: `POST /operators`. Show the new node in the tree, surface the temp credentials once with a copy button and a "they must change on first login" note. If caller lacks `operator.create_child`, the button isn't shown.

> Stores/agents cannot create operators. Only stores can create **players** (different screen, 3.6). The form enforces "one tier below" but the API is authoritative.

### 3.4 Operator detail (`/operators/:id`)
Tabs:
- **Overview**: balance, tier, parent, created, status, pricing. Actions (scoped): edit, suspend/unsuspend (cascades to subtree), transfer credits to this node (if direct child), close (requires zero balance + no children).
- **Children**: their direct children with quick balances.
- **Credit history**: ledger entries for this node's account (issues received, transfers in/out, recharges funded).
- **Orders**: credit orders where this node is buyer or seller.
- **Settings**: feature flags, enabled currencies, pricing overrides.

Transfer action opens a form: amount, optional memo, idempotency key auto-generated. Calls `POST /credits/transfer` (`docs/03` §4.2). Confirm dialog shows resulting balances.

### 3.5 Credits (`/credits`)
The credit distribution hub. Two halves:

**Issue (super admin / `order.issue` only)** — mint new credits into a direct child (or self for bootstrap). Form: target operator, quantity, currency. Calls the issue/mint flow (`docs/03` §4.1). Clearly labeled as the only place credits enter existence; gated hard.

**Orders** — the buy/sell credit workflow between a node and its parent/children (offline cash, recorded here).
- **Inbox** (orders where I'm the seller): a child requested credits from me. Columns: buyer, quantity, agreed cash price, payment method, proof, status, time. Actions: confirm (releases credits via transfer), reject. Confirming a fulfilled cash deal triggers the ledger transfer.
- **Outbox** (orders where I'm the buyer): credits I requested from my parent. Status tracking, upload payment proof, cancel if pending.
- **New order**: request credits from parent (quantity, attach proof of offline payment, note method). Calls `POST /credits/orders`.

Each order row links to the resulting ledger transaction once settled, so the credit movement and the paperwork are tied together. Cash settlement state (paid/unpaid) is tracked on the order + `Settlement`, separate from the credit movement (`docs/03` §3).

Live: `order.updated` updates rows in place; inbox badge increments on new `recharge.requested`/order events.

### 3.6 Players (`/players`)
Scoped player list (only players in the caller's subtree). Columns: username, owning agent, wallet balance(s), status, last active, lifetime recharged, lifetime redeemed.

- **Create player** (stores/agents, `player.create`): username, temp password, owning agent (defaults to self). Calls `POST /players`.
- **Row actions**: recharge (3.7), view detail, suspend, reset password.
- Filters: by agent, status, balance range, activity.

**Player detail**: wallet balances (PLAY/PRIZE in compliance mode, single CREDIT in operator mode), recharge history, gameplay history (sessions/rounds, read-only), redemption history, KYC status (compliance), responsible-gaming limits + self-exclusion status, notes/flags. Actions scoped: recharge, adjust (admin + reason, writes `AuditLog`), suspend.

### 3.7 Recharge (action, not a page)
From a player row or detail. Form: amount, currency, optional bonus (compliance mode shows PLAY purchase + PRIZE bonus split per promo), memo. Idempotency key auto-set. Calls `POST /wallet/recharge` (`docs/03` §4.3). Pre-check: agent must have sufficient own balance; show their balance and the post-recharge result before confirm. On success, player balance updates live via socket.

In compliance mode the UI frames it as "player buys PLAY credits, receives PRIZE bonus" and never as "buying redeemable credits directly" (`docs/02`/`03` compliance notes).

### 3.8 Redemptions (`/redemptions`)
Approval queue, the cashout side. Only requests routed to the caller per approval routing (`docs/04`).

- Queue table: player, owning agent, amount, requested time, age in queue, status, KYC status (compliance). Sort by age.
- Row → detail: player context, balance, redemption amount, KYC/AML state, history of this player's prior redemptions.
- Actions: **approve** (burns PRIZE/credit into clearing, `docs/03` §4.5), **reject** (with reason), and after approval, mark **paid** when the offline payout is done (records settlement, drains clearing). Each action confirmed, reasoned where rejecting, and written to audit.
- Compliance gates: if KYC not verified or AML flag open, approve is blocked with the reason surfaced (`KYC_REQUIRED` / AML hold).

Live: `redemption.queued` adds to the queue + badge; `redemption.updated` moves rows.

### 3.9 Reports (`/reports`)
Scoped reporting. Tabs/sections:
- **Credit flow**: issued, transferred, recharged, redeemed over a date range, by node.
- **Player activity**: recharges, redemptions, net, by player/agent.
- **Revenue**: house edge accrued (`REVENUE` account) by game/period — admin scope.
- **Margin**: buy vs sell unit price spread per node (from order `unitPriceCents`), the off-platform profit view (`docs/03` §3). Reporting only; not in the ledger.
- **Settlement**: outstanding cash owed up/down the chain (unpaid orders + redemptions).
- Export CSV. All queries scoped to subtree; a sub-distributor's "revenue" is its branch only.

### 3.10 Ledger health (`/ledger`) — admin/finance
Operational integrity dashboard surfacing the reconciliation jobs (`docs/03` §8):
- Zero-sum check (every transaction nets to 0) — pass/fail + last run.
- Cache vs derived balance drift (cached `balanceMinor` vs sum of entries) — list any mismatches.
- Snapshot continuity (`balanceAfterMinor` chain unbroken per account).
- Circulation identity (mint out = sum of operator + player balances + clearing).
- Settlement sanity (clearing account never negative; drains match payouts).
- System account balances (MINT, REVENUE, REDEMPTION_CLEARING, PROMO, ADJUSTMENT, ROUNDING) with expected-sign indicators.
- Manual "run reconciliation now" button (enqueues the job) and a transaction explorer (search by id/idempotency key, view all legs).

### 3.11 Compliance (`/compliance`) — COMPLIANCE mode
- **KYC queue**: submitted records, document preview (from R2, signed URL), approve/reject with reason → unblocks redemption. Writes audit.
- **Geo rules**: list `GeoRule` (allowed/blocked regions), toggle, see which players are region-blocked. Login + redemption enforce these.
- **AML flags**: open flags by severity, drill into the player + triggering activity, resolve/escalate. New flags arrive via `aml.flagged` on `admin:global`.
- **Responsible gaming**: view/override limits, process self-exclusion requests, see excluded players (blocked from play + recharge).
- **Age gate / promos**: AMoE promotion config (no-purchase entry), 21+ enforcement settings.

### 3.12 Audit (`/audit`)
Read-only, append-only log viewer (`AuditLog`). Filter by actor, action type, entity, date. Each row: who, what, when, before/after where relevant, IP/session. Not editable or deletable from the UI by anyone, including super admin. This is the compliance + dispute backstop.

### 3.13 Announcements (`/announcements`)
Compose announcements broadcast to the caller's subtree (players and/or operators). Schedule, target by tier/branch, publish. Pushes `announcement` socket event + writes `Announcement`/`Notification`.

### 3.14 Settings (`/settings`)
- **Node settings**: own display name, enabled currencies, feature flags, pricing defaults for children.
- **Platform settings** (super admin): `PLATFORM_MODE`, `CREDIT_MINOR_UNITS` (read-only after launch), default RTP bounds, redemption approval routing, KYC/geo enforcement toggles, session/JWT lifetimes. Changes write `AuditLog`. Mode/critical-money settings show a hard confirm and are flagged as the kind of change that needs a human decision, not a casual toggle.

---

## 4. Cross-cutting frontend behaviors

- **Money input**: a shared `<MoneyInput currency>` that takes human credits, converts to minor units before submit, and never does float math (`docs/03` money helper). Display via `<Money valueMinor currency>` with tabular figures.
- **Idempotency**: every mutating action generates a UUID idempotency key on form open and sends it; retry reuses the same key so a double-click or network retry can't double-spend. On `IDEMPOTENT_REPLAY` the UI treats it as success.
- **Scope errors**: an `OUT_OF_SCOPE` from the API renders a clean "not in your area" state, never a stack trace. Should be rare because nav is pre-scoped, but handled.
- **Optimistic + reconcile**: mutations update the cache optimistically, then the socket event confirms; on mismatch, refetch wins.
- **Confirmations**: any money movement (issue, transfer, recharge, approve, mark-paid) requires an explicit confirm dialog showing before/after balances.
- **Empty/permission states**: nav items the principal can't use aren't rendered; deep links the principal can't reach show a friendly forbidden state.
- **Audit-by-default**: admin overrides (adjustments, KYC decisions, setting changes) require a reason field that flows into `AuditLog`.

---

## 5. Component inventory (console-specific)

Built on `packages/ui` primitives (`docs/08`):
- `OrgChart` / `TreeNodeCard`
- `BalancePill`, `Money`, `MoneyInput`, `LedgerDrawer`
- `KpiStat`, `CreditFlowChart`, `ActivityFeed`, `AttentionList`
- `DataTable` (sortable, cursor-paginated, scoped fetch) with row-action menus
- `OperatorForm`, `PlayerForm`, `RechargeForm`, `TransferForm`, `IssueForm`, `OrderForm`
- `RedemptionQueue`, `RedemptionDetail`, `ApprovalActions`
- `KycReviewCard`, `GeoRuleTable`, `AmlFlagList`, `RgLimitEditor`
- `AuditLogTable`, `ReconciliationPanel`, `SystemAccountGrid`
- `ConfirmMoneyDialog` (the before/after confirm), `ReasonDialog`
- `ModeBadge`, `ScopeIndicator`, `NotificationBell`

These map cleanly onto the API in `docs/05`. Build the `DataTable` + `Money*` + `ConfirmMoneyDialog` + form primitives first; most screens are compositions of those.
