# Console Completeness & Security Audit — Build-to-100% Plan

_Audited 2026-06-17 against `outline-docs/04–06` (RBAC, API spec, console spec) and security best practice, across the console frontend (`apps/console`), the API (`apps/api`), and the database (`packages/db`). Produced by a 14-dimension multi-agent audit with adversarial per-finding verification. 141 findings raised, 1 refuted, **140 kept**: 4 critical, 32 high, 44 medium, 49 low, 11 info (85 completeness, 55 security)._

> **Method note.** The synthesis stage of the automated run hit a session limit, so this report was assembled by hand from the verified finding data. **69 findings carry a high-confidence adversarial verdict** (`✓ verified`); the remaining **71 were cut off before their verifier ran** (`○ unverified`) — these are concentrated in the security dimensions (infra, validation, DB, realtime, compliance) and should be treated as "credible, pending a confirmation pass," not as proven. Every finding cites `file:line` so each is independently checkable. This audit complements the two prior ones (`docs/audit/2026-06-16-*`): credit-flow business rules (R1–R12, mostly fixed) and game-fairness/security foundations. Where a prior critical is re-verified as still open, it is flagged inline.

---

## 1. Executive summary

- **The foundations are genuinely strong; the console is where it falls short.** The money core (BigInt-everywhere double-entry ledger, atomic `SELECT … FOR UPDATE` postings, idempotency, reconciliation), the RBAC/subtree-isolation model (scope guard + scoped Prisma reads — **no IDOR found**), zod validation at every boundary, parameterized SQL, Argon2id + rotating hashed refresh tokens, and authenticated/scope-gated sockets are all correctly built. The problems are (a) **unfinished console screens**, (b) **frontend↔API contract drift that silently breaks or crashes whole pages**, and (c) **enforcement/hardening gaps layered on a sound base**.

- **"The console crashes" is real and has a systemic root cause: contract drift on render paths + zero error boundaries.** The console ships **no `error.tsx` / `global-error.tsx` anywhere**, so any render-time throw becomes an unrecoverable white-screen "Application error" instead of a clean state. At least two pages are confirmed to throw on healthy seeded data: the **Ledger-health** system-accounts panel (`humanize(undefined)` → `undefined.toLowerCase()`) and the **Reports → Credit-flow** tab (reads `.points`, API returns `buckets` → `TypeError` at render). The **Redemptions** crash you hit shares the same root cause (an unguarded list render with no boundary to catch it); see §5.

- **Several whole screens are effectively non-functional despite working backends.** **Reports** is ~15% usable (one non-spec tab renders; five spec'd tabs are dead "Export to view" placeholders; **CSV export downloads nothing**). **Ledger-health** is ~0% usable (every reconciliation check renders red FAIL, the page crashes, the tx-explorer is blank) — all pure frontend↔API shape mismatches over a fully-built backend. **Responsible-Gaming** management is entirely unwired. **Platform Settings** never loads persisted values and **can silently clobber `PLATFORM_MODE` / re-enable KYC-GEO toggles on save**.

- **Four CRITICAL security issues remain open — all carried over from the 2026-06-16 audit — and form a password-only admin-takeover chain.** (1) the production `superadmin` is still on the source-controlled default `ChangeMe!Dev123`; (2) MFA is **not enforced server-side** for admin tiers (an un-enrolled admin gets a fully-privileged token); (3) the forced-enrollment gate is **client-side only** (skip the SPA, call the API directly → `credit.mint` / `ledger.adjust` / `platform.settings`); (4) **geo-fencing is inert and fail-open** while the UI claims it is "enforced." Together: rotate-the-password-and-you-own-everything.

- **The compliance scaffolding is wired at the right points but most live controls are inert.** Geo never resolves a region (and a BLOCK wouldn't throw — fire-and-forget promise), **AML never creates a flag** (zero callers, so the redemption AML gate is vacuous), the **DEPOSIT responsible-gaming limit is silently bypassed** (amount never passed), there is **no age/21+ verification anywhere**, and **all four live game engines ignore `rtpBps`** so the RTP override is a no-op on real games (directly relevant to your win-rate request — see §6).

- **The biggest non-money hardening gaps:** no security headers/CSP on either the API or the privileged console (clickjackable back-office), the **global rate-limiter is never registered** (every read/list/report endpoint is unthrottled), no account lockout, a stored-XSS sink via an unvalidated KYC `documentUrl`, append-only audit/ledger immutability is **convention-only (no DB trigger/REVOKE)**, and there are **no DB constraints** backstopping zero-sum / non-negative balances.

- **Single most urgent (do today):** rotate the prod `superadmin` password + all `.env.production` secrets, enforce MFA server-side, and add the error boundaries + the four contract-drift fixes that stop the crashes. Everything else follows the phased roadmap in §7.

---

## 2. Completeness scorecard

Status derived from the findings. "Backend" = is the API/DB support present; "UI" = is the console screen built and correctly wired.

| Area | Status | UI | Backend | One-line |
|---|---|---|---|---|
| Dashboard (`/`) | 🟡 Partial ~60% | partial | partial | Circulation KPI blank + credit-flow chart never renders (contract drift); Activity feed unbuilt; missing pending-redemption/order-outbox KPIs and super-admin extras. |
| Organization tree (`/org`) | 🟡 Partial ~70% | partial | ok | Node cards omit balance; no lazy-load — deep branches (>depth 6) invisible. |
| Operators + detail (`/operators`) | 🟡 Partial ~65% | partial | ok | "Orders" tab is a dead placeholder; "Settings" tab handles pricing only (no feature flags / enabled currencies). |
| Credits & orders (`/credits`) | 🟡 Partial ~65% | partial | partial | Missing counterparty/proof/ledger-link columns; can't attach proof post-creation; **no live `order.updated`** (60s poll only). |
| Players list (`/players`) | 🟠 Partial ~50% | partial | partial | Missing 4/7 spec columns (owning agent, balances, lifetime recharged/redeemed) — list API returns none; 2/4 filters missing; **no reactivate**; no notes/flags. |
| Player detail | 🟡 Partial ~55% | partial | ok | Merged timeline exists but not separated into Play vs Credit; no round-level play history; owning agent shown as raw UUID; RG read-only counts. (See §6.) |
| Recharge (action) | 🟢 Mostly ~85% | ok | ok | Solid (idempotent, balance pre-check, before/after confirm); missing compliance-mode PLAY+PRIZE bonus-split preview. |
| Redemptions (`/redemptions`) | 🟢 Mostly ~80% | ok | ok | Strongest screen; KYC/AML gate at approve, full lifecycle. Crash you hit = unguarded render + no error boundary (§5); column/detail gaps. |
| Reports (`/reports`) | 🔴 Stub ~15% | broken | **ok** | 1 non-spec tab renders; 5 spec'd tabs are "Export to view" placeholders; **credit-flow tab crashes**; **CSV export downloads nothing**. |
| Ledger health (`/ledger`) | 🔴 Broken ~0% | broken | **ok** | Every check renders FAIL; system-accounts panel **crashes the page**; tx-explorer blank — pure shape mismatch over a complete backend. |
| Compliance (`/compliance`) | 🟠 Partial/Stub | partial | partly inert | KYC/Geo/AML/Promos screens partial; **RG tab is a dead-end**; AML can't drill-in or raise a flag; geo lacks blocked-players view; KYC has no doc preview. |
| Audit (`/audit`) | 🟡 Partial ~70% | partial | ok | Read works; missing date/actor/target filters and session/UA column. |
| Announcements (`/announcements`) | 🟠 Partial ~50% | partial | partial | Create/list works; no schedule/target/deactivate; **no realtime push or Notification fan-out** (client listens for an event the server never emits). |
| Settings (`/settings`) | 🔴 Partial/Broken | broken | ok | Platform panel **never loads persisted values**; **save can clobber `PLATFORM_MODE` and reset KYC/GEO toggles**; missing JWT/session lifetimes, routing, currencies, flags. |
| Shell / cross-cutting | 🟡 Partial ~75% | partial | partial | Solid primitives & idempotency; **no global search**; notification mark-read unwired (badge never clears); DataTable not sortable; no ActivityFeed; mode badge from build-time env not live setting; MFA gate client-only. |
| API endpoints | 🟢 Mostly ~85% | — | partial | Full route coverage + extras; gaps are stubs/contract drift: **R2 presigner is a dev stub** (KYC/proof uploads dead in prod), CSV contract mismatch, no global-search/branch-catalog API. |
| DB schema | 🟢 Complete | — | ok | Faithful superset of `docs/02`; integrity **backstops** missing (append-only/zero-sum/non-negative are app-only) — see §5 security. |

**Win-rate sliders (your request):** ❌ Not started — RTP is one global value per game, agents can't touch it, engines ignore it. **Per-player play/credit history (your request):** 🟡 Partial — merged timeline exists; needs separation, round-level detail, and superadmin de-emphasis. Both detailed in §6.

---

---

## 3. Findings — completeness (85)

### HIGH

**DASH-C2 — Dashboard Credit-flow chart never renders data (reads `points`, API returns `buckets`)**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.1: "Credit flow chart: issued vs recharged vs redeemed over time (last 30d), pulled from ledger aggregates." The chart should plot the /reports/credit-flow series.
- **Actual:** page.tsx passes `points={creditFlow.data?.points ?? []}` and CreditFlowChart guards `if (points.length === 0)`. But GET /reports/credit-flow returns `{ currency, granularity, from, to, buckets }` — there is no `points` key. So `data.points` is always undefined, the chart always receives [] and permanently renders the EmptyState "No credit flow yet", even when ledger activity exists.
- **Evidence:** `apps/console/src/app/(app)/page.tsx:32-36,115` · `apps/console/src/components/credit-flow-chart.tsx:19,31-33` · `apps/console/src/lib/types.ts:274-276` · `apps/api/src/reports/reports.service.ts:144-156`
- **Fix:** Map the API `buckets` array to the chart (rename CreditFlowReport.points -> buckets and update page.tsx, or rename the API key). Per-bucket field names already match (bucket/issuedMinor/transferredMinor/rechargedMinor/redeemedMinor). Add an integration check that the chart receives non-empty data after seed.

**CPR-C1 — Order tables omit counterparty (buyer/seller) identity column**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.5 inbox columns: buyer, quantity, agreed cash price, payment method, proof, status, time. The seller must see WHICH child requested credits before confirming a transfer.
- **Actual:** The orders DataTable renders only Quantity, Cash, Method, Status, Requested — no buyer (inbox) or seller (outbox) column. The order list API returns the raw CreditOrder with only buyerOperatorId/sellerOperatorId UUIDs and never joins the operator display name, so the column cannot even be populated client-side.
- **Evidence:** `apps/console/src/app/(app)/credits/page.tsx:42-53` · `apps/api/src/orders/orders.service.ts:87-105`
- **Fix:** Add a buyer/seller display-name column (role-dependent). Extend orders.service.list to include operator { select: { displayName, tier } } for the counterparty and expose it on the CreditOrder DTO.

**CPR-C6 — Player list missing owning-agent, balances, and lifetime totals columns**  
<sub>console · effort L · ✓ verified</sub>

- **Expected:** docs/06 §3.6: list columns = username, owning agent, wallet balance(s), status, last active, lifetime recharged, lifetime redeemed.
- **Actual:** The list shows only Player(username/displayName), Status, Last active, Joined. Owning agent, wallet balance(s), lifetime recharged, and lifetime redeemed are all absent — and the list API's PLAYER_SELECT returns none of them (no operator name, no wallets, no aggregates), so they cannot be shown without backend work.
- **Evidence:** `apps/console/src/app/(app)/players/page.tsx:57-71` · `apps/api/src/players/players.service.ts:64-74` · `apps/api/src/players/players.service.ts:125-143`
- **Fix:** Extend the list endpoint to include owning-operator displayName, wallet balances, and lifetime recharged/redeemed aggregates (scoped, paginated, indexed) and add the columns.

**CPR-C8 — No way to reactivate / unsuspend a player**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** Suspend is reversible; an operator must be able to reactivate a suspended player.
- **Actual:** Player detail offers Suspend only while ACTIVE; there is no Reactivate control when SUSPENDED. updatePlayerSchema has no status field and the controller exposes only /suspend (no /reactivate). A suspended player is permanently stuck from the console.
- **Evidence:** `apps/console/src/app/(app)/players/[id]/page.tsx:120-125` · `apps/api/src/players/players.controller.ts:77-83` · `packages/shared/src/schemas/players.ts:13-19`
- **Fix:** Add a reactivate endpoint (status -> ACTIVE, audited) and a Reactivate button shown when status === SUSPENDED.

**RRL-C1 — Five spec'd report tabs are dead "Export to view" placeholders despite working backends**  
<sub>reports · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.9 requires viewable Reports tabs for Credit flow, Player activity, Revenue, Margin, Settlement (CSV export in addition). Each should render its scoped data in-UI.
- **Actual:** Only the (non-spec'd) agent-sales tab renders a table. player-activity, revenue, margin, settlement, and redemptions all fall through to a single EmptyState 'Export to view' placeholder, even though ReportsService.playerActivity/revenue/margin/settlement/redemptionsReport are fully implemented and exposed via the controller. The data is fetched-capable but never displayed.
- **Evidence:** `apps/console/src/app/(app)/reports/page.tsx:182-193` · `apps/api/src/reports/reports.service.ts:190-426` · `apps/api/src/reports/reports.controller.ts:46-84`
- **Fix:** Render each tab with a table/summary bound to its existing endpoint (player-activity, revenue, margin, settlement, redemptions). Reuse the agent-sales table pattern; add useQuery hooks per tab gated by `enabled: tab===...`.

**RRL-C2 — CSV export never downloads a file — backend returns CSV synchronously, frontend discards it**  
<sub>reports · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.9 'Export CSV': clicking Export should deliver a CSV file for the selected report/range.
- **Actual:** ReportsService.exportCsv returns the CSV inline as {filename, csv} (synchronous). The frontend posts to /reports/export typed as {jobId?:string}, ignores the returned body entirely, and shows a misleading toast 'Export queued ... available shortly'. There is no Blob/createObjectURL/anchor download anywhere in the console, so no file is ever produced for any report. (This is the broken CSV wiring flagged in the prior audit, still unfixed.)
- **Evidence:** `apps/console/src/app/(app)/reports/page.tsx:80-92` · `apps/api/src/reports/reports.service.ts:429-500` · `apps/api/src/reports/reports.controller.ts:108-116`
- **Fix:** Take the returned {filename, csv}, build a text/csv Blob, and trigger a download (createObjectURL + anchor click). Update the mutation generic to {filename:string;csv:string} and drop the 'queued' toast.

**RRL-C3 — Credit-flow report tab crashes — backend returns `buckets`, UI reads `.points`**  
<sub>reports · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.9 Credit flow tab should chart issued/transferred/recharged/redeemed over the range.
- **Actual:** GET /reports/credit-flow returns { currency, granularity, from, to, buckets:[...] }, but the page passes creditFlow.data.points (undefined) into <CreditFlowChart>. CreditFlowChart does `for (const p of points)` / `points.length` on undefined, throwing TypeError at render. The frontend type CreditFlowReport declares `points` instead of `buckets`, masking the mismatch. The one spec'd tab the team thought was built is broken.
- **Evidence:** `apps/console/src/app/(app)/reports/page.tsx:130-137` · `apps/api/src/reports/reports.service.ts:144-156` · `apps/console/src/components/credit-flow-chart.tsx:20-33` · `apps/console/src/lib/types.ts:274-276`
- **Fix:** Rename the response field to `buckets` in the type and pass creditFlow.data.buckets (or change backend to emit `points`). One-field fix plus an undefined-guard in CreditFlowChart.

**RRL-C4 — Ledger-health page contract mismatch: every check renders FAIL and the page crashes on system accounts**  
<sub>reports · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.10: zero-sum/drift/snapshot/circulation/settlement checks shown pass/fail with last-run time, and a system-account grid (MINT, REVENUE, REDEMPTION_CLEARING, PROMO, ADJUSTMENT, ROUNDING) with expected-sign indicators.
- **Actual:** Frontend types/usage don't match the API. Checks: backend ReconCheck is {name, ok, detail} but UI reads c.key/c.label/c.passed → label is blank and c.passed is undefined → EVERY check renders the red XCircle + 'Fail' badge even on a healthy ledger. lastRunAt: backend sends `ranAt`, UI reads `health.data.lastRunAt` → 'Last run' never shows. System accounts: backend sends {systemKey,...} but UI reads a.account and calls humanize(a.account) = humanize(undefined) → undefined.toLowerCase() throws → the system-accounts panel crashes the whole page once seeded system accounts load (always, post-seed). The entire ledger-integrity dashboard is unusable.
- **Evidence:** `apps/console/src/app/(app)/ledger/page.tsx:96-119` · `apps/console/src/app/(app)/ledger/page.tsx:133-141` · `apps/console/src/lib/format.ts:60-65` · `apps/api/src/reconciliation/reconciliation.service.ts:7-11` · `apps/api/src/reconciliation/reconciliation.service.ts:86-102` · `apps/api/src/reports/reports.service.ts:503-509` · `apps/console/src/lib/types.ts:302-320`
- **Fix:** Align LedgerHealth/ReconciliationCheck/SystemAccountBalance types and the page to the real API (ranAt, checks[].name/ok, systemAccounts[].systemKey). Guard humanize against undefined. Add a Vitest/contract test so console types are derived from the API response shape.

**RRL-C6 — Transaction explorer renders blank metadata and blank account labels (shape mismatch)**  
<sub>reports · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.10: transaction explorer — search by id/idempotency key and view all legs (type, status, time, per-leg account + amount).
- **Actual:** GET /reports/ledger-health/transaction returns { transaction:{id,type,status,createdAt,memo,...}, legs:[{direction,amountMinor,currency,account:{ownerType,operatorId,playerId,systemKey}}] } (or null). The page reads a FLAT tx: tx.type/tx.status/tx.id/tx.createdAt/tx.memo (all undefined → empty StatusPills, blank id, formatDateTime(undefined)='—') and leg.accountLabel (undefined → blank — the backend provides an account object, not a label). Legs' direction/amount render, but the transaction header and every account name are blank.
- **Evidence:** `apps/console/src/app/(app)/ledger/page.tsx:171-190` · `apps/api/src/reconciliation/reconciliation.service.ts:105-154` · `apps/console/src/lib/types.ts:322-338`
- **Fix:** Map the response: read tx.transaction.* for header fields, and build a human account label from leg.account (systemKey, or operator/player id) since the API returns no accountLabel. Update LedgerTransaction/LedgerTxLeg types to the nested shape.

**CAS-CA1 — Responsible Gaming tab is a dead-end placeholder; no limit editor / self-exclusion / excluded-players UI anywhere**  
<sub>compliance · effort L · ✓ verified</sub>

- **Expected:** docs/06 §3.11 Responsible gaming: view/override deposit/loss/session limits, process self-exclusion requests, and see excluded players (blocked from play + recharge).
- **Actual:** The /compliance 'Responsible gaming' tab renders only an EmptyState linking to /players. The player profile shows a read-only ComplianceSummary (KYC status, self-excluded yes/no, open AML count, count of RG limits) with no controls. No console code calls POST /compliance/players/:id/rg-limits, /self-exclude, or GET .../rg-limits; there is no view of self-excluded players. The API + RgService are fully implemented but unused by the console.
- **Evidence:** `apps/console/src/app/(app)/compliance/page.tsx:42-54` · `apps/console/src/app/(app)/players/[id]/page.tsx:278-289` · `apps/api/src/compliance/rg.service.ts:35-103` · `apps/api/src/compliance/compliance.controller.ts:293-327`
- **Fix:** Build an RgLimitEditor (set/override limits by type+period) and a self-exclusion action on the player profile (or in the RG tab), wired to the existing compliance endpoints, plus a list view of currently self-excluded players in the RG tab.

**CAS-CA2 — Platform Settings panel never loads persisted values (response-shape mismatch); save can clobber PLATFORM_MODE and reset KYC/GEO enforcement**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.14: platform settings load current persisted values; mode/critical-money changes show a hard confirm and never change silently.
- **Actual:** GET /settings/platform returns { mode, settings: [{key,value,readOnly,updatedAt}] } but the console reads flat keys (data.PLATFORM_MODE, data.DEFAULT_GAME_RTP_BPS, data.KYC_ENFORCED, data.GEO_ENFORCED) which are all undefined, so the form always shows client-env/static defaults. mode and initialMode both default to the client NEXT_PUBLIC_PLATFORM_MODE constant, so modeChanged is false and Save writes the client-default mode to the DB with NO hard-confirm if it differs from the stored mode. KYC_ENFORCED/GEO_ENFORCED always re-send true regardless of stored state, silently re-enabling enforcement an admin may have disabled (and the admin can never see the real toggle state). api.get does a bare JSON.parse ... as T with no transform.
- **Evidence:** `apps/console/src/app/(app)/settings/page.tsx:33-39` · `apps/console/src/app/(app)/settings/page.tsx:124-149` · `apps/console/src/app/(app)/settings/page.tsx:172-177` · `apps/api/src/settings/settings.service.ts:37-61` · `apps/console/src/lib/api.ts:135`
- **Fix:** Map the API's { mode, settings:[{key,value}] } response into the panel state (or change the API to return flat keys), seed initialMode from the server mode, and reflect stored KYC/GEO/RTP/threshold values so saves don't overwrite unseen state. Confirm dialog must compare against the server-loaded mode.

**API-A1 — CSV export contract mismatch: API returns CSV synchronously, console expects a jobId and discards the file (Export button is dead UI)**  
<sub>reports · effort M · ✓ verified</sub>

- **Expected:** outline-docs/05 §9 (line 151): POST /reports/export enqueues a CSV/PDF export to R2 and returns a job id; docs/06 §3.9 expects a working 'Export CSV' that delivers a file.
- **Actual:** ReportsService.exportCsv returns { filename, csv } synchronously (the CSV body). The console mutation posts and types the response as { jobId?: string }, ignores the returned csv entirely, and onSuccess only shows a 'Export queued' toast — no file download, no job polling, no download link. The user clicks Export CSV and never gets a file.
- **Evidence:** `apps/api/src/reports/reports.service.ts:429` · `apps/api/src/reports/reports.service.ts:499` · `apps/console/src/app/(app)/reports/page.tsx:84` · `apps/console/src/app/(app)/reports/page.tsx:86` · `outline-docs/05-api-spec.md:151`
- **Fix:** Pick one contract end-to-end. Simplest: have the console treat the response as a file (set Content-Disposition / return the csv body and trigger a client download), drop the { jobId } typing. Or implement the spec'd async path (enqueue BullMQ job, write CSV/PDF to R2, return jobId, add a GET /reports/export/:jobId status+download). Today neither side works.

**API-A2 — Object storage (R2) presigner is a dev stub only — KYC document and payment-proof uploads are non-functional in production**  
<sub>infra · effort M · ✓ verified</sub>

- **Expected:** outline-docs/05 §8/§3 and docs/06 §3.11: KYC IDs and order/redemption payment proofs upload to R2 private buckets via presigned URLs; the upload must actually work in prod.
- **Actual:** StorageService.presignUpload returns hard-coded 'https://r2.stub.local/<bucket>/<key>?stub-upload=true' URLs. There is no real S3/R2 presigner anywhere (no @aws-sdk dependency, no env toggle to a real implementation). Every consumer — kyc.service.presignDoc, orders proof-url, redemptions presignProof — therefore hands the client a fake upload URL, so KYC document upload, order payment-proof upload, and redemption payout-proof upload all silently fail outside dev.
- **Evidence:** `apps/api/src/storage/storage.service.ts:22` · `apps/api/src/storage/storage.service.ts:25` · `apps/api/src/compliance/kyc.service.ts:140` · `apps/api/src/redemptions/redemptions.service.ts:374` · `apps/api/src/orders/orders.service.ts:26`
- **Fix:** Implement a real R2/S3 presigner (aws-sdk v3 getSignedUrl with PutObjectCommand) behind the existing StorageService interface, selected by env (keep the stub for tests/dev). Validate R2 credentials at boot. Without this, the compliance KYC flow and the offline-cash proof flows are inert in prod.

**RT-R1 — order.updated realtime event is never emitted — order workflow has no live push**  
<sub>realtime · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/05 §11 and docs/06 §3.5 (line 103: "Live: order.updated updates rows in place; inbox badge increments on new recharge.requested/order events") require an order.updated event { orderId, status } emitted to operator:{buyer} and operator:{seller} on every CreditOrder state change, written as an OutboxEvent in the same transaction as the status update. The console already wires a handler for it.
- **Actual:** The orders module writes no outbox events at all. Every status transition (REQUESTED, PAID, ISSUED, CANCELLED, AWAITING_PAYMENT) updates the row with no accompanying tx.outboxEvent.create, so order workflow changes never push to buyer or seller consoles — the order table and the sidebar order-inbox badge only update on manual refetch/reconnect. The console INVALIDATION map (socket.ts:24) listens for an event the server never sends.
- **Evidence:** `apps/api/src/orders/orders.service.ts:123-126` · `apps/api/src/orders/orders.service.ts:185-187` · `apps/api/src/orders/orders.service.ts:250-252` · `apps/api/src/orders/orders.service.ts:272` · `apps/console/src/lib/socket.ts:24` · `outline-docs/05-api-spec.md:235` · `outline-docs/06-frontend-console.md:103`
- **Fix:** In each order status transition, write an order.updated OutboxEvent { orderId, status } in the same prisma.$transaction as the creditOrder.update, with rooms [operator:{buyerId}, operator:{sellerId}]. Mirror the redemptions.service emit() pattern.

**CMPL-CR2 — AML detection is dead — no flag is ever created, redemption AML gate is vacuous**  
<sub>compliance · effort L · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.11: AML flags arrive via aml.flagged on admin:global from detection rules; an OPEN/ESCALATED flag blocks redemption (assertNoOpenAml). Operators triage by severity and resolve/escalate.
- **Actual:** AmlService.createFlag (the internal hook) has zero callers — no detection rule, job, reconciliation step, or seed ever raises a flag (only comments reference it). There is also no HTTP route for an operator to raise a flag manually; the console AML screen can only resolve existing flags. Consequently AmlFlag rows are never produced, assertNoOpenAml in checkRedeem always passes, and the AML queue is permanently empty. The AML control exists in shape only.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/aml.service.ts:92` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.service.ts:117` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.service.ts:90` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.controller.ts:178`
- **Fix:** Implement at least one detection rule that calls createFlag (e.g. on redemption request above a configurable threshold, rapid recharge→redeem velocity, or structuring patterns), invoked from redemptions/wallet flows or a BullMQ scan job. Add an operator 'raise flag' endpoint+UI for manual escalation. Add an integration test asserting an open flag blocks redemption.

**CMPL-CR5 — No console Responsible-Gaming management; RG tab is a dead-end, player detail is read-only**  
<sub>console · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.11: 'Responsible gaming: view/override limits, process self-exclusion requests, see excluded players.' §3.6 player detail: responsible-gaming limits + self-exclusion status with scoped actions. RgLimitEditor component listed in §5.
- **Actual:** The /compliance 'Responsible gaming' tab renders only an EmptyState linking to /players. The player detail page shows a read-only ComplianceSummary (KYC status, self-excluded Yes/No, open AML count, and just the COUNT of RG limits) with no actions to view individual limits, set/override a limit, or self-exclude — even though the API exposes POST /compliance/players/:id/rg-limits and /self-exclude (and GET .../rg-limits). There is no 'see excluded players' view and no RgLimitEditor. The entire RG operator capability is unwired on the frontend.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/console/src/app/(app)/compliance/page.tsx:53` · `/Users/willz/ai/Fire-Casino/apps/console/src/app/(app)/players/[id]/page.tsx:278` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.controller.ts:293` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.controller.ts:301` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.controller.ts:315`
- **Fix:** Build an RgLimitEditor on the player detail (list current limits, add/override per type+period, set/lift self-exclusion) wired to the existing routes, and an 'excluded players' list in the compliance RG tab. Gate actions on compliance.manage.

**CMPL-CR7 — No age / DOB / 21+ verification anywhere**  
<sub>compliance · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.11 'Age gate / promos': AMoE config and 21+ enforcement settings. A gaming platform must capture date of birth and enforce a minimum age.
- **Actual:** No date-of-birth, age, minimum-age, or 21+ concept exists in the schema, shared types, API, or either frontend. kycSubmit captures only idType/documentUrl/level (no DOB), the KYC decision records no age, and there is no age-gate setting or check at registration/login/play. The spec's '21+ enforcement settings' are entirely unbuilt.
- **Evidence:** `/Users/willz/ai/Fire-Casino/packages/shared/src/schemas/compliance.ts:29` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/kyc.service.ts:75` · `/Users/willz/ai/Fire-Casino/outline-docs/06-frontend-console.md:153`
- **Fix:** Add DOB capture (registration and/or KYC submit), a configurable minimum-age platform setting, and an age check in the compliance gate (and a self-attestation age gate at signup). Record the verified age outcome on KycRecord.


### MEDIUM

**DASH-C1 — Dashboard "Circulation below me" KPI is wired to a non-existent field and renders blank**  
<sub>console · effort S · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.1: KPI row leads with "Credits in circulation below me". The value must come from the /reports/overview aggregate (operator + player balances in subtree).
- **Actual:** page.tsx reads `data?.circulationBelowMinor`, but GET /reports/overview returns the field as `creditsInCirculationMinor`. There is no response key transformation (api.get does `JSON.parse(text) as T`, api.ts:135), so the value is always undefined. KpiStat then falls through to `<span>{value}</span>` with value also undefined, so once data loads the headline KPI shows an empty value (it only shows the loading dash "—" before the request resolves).
- **Evidence:** `apps/console/src/app/(app)/page.tsx:68-73` · `apps/console/src/lib/types.ts:257` · `apps/api/src/reports/reports.service.ts:79` · `packages/ui/src/surfaces.tsx:128-132` · `apps/console/src/lib/api.ts:135`
- **Fix:** Align the contract: rename the API field to `circulationBelowMinor` (matches /operators/:id/stats which already uses that name, operators.service.ts:359) or update the ReportsOverview type + page.tsx to read `creditsInCirculationMinor`. Add a shared zod schema for the overview response so this mismatch is caught at the boundary.

**DASH-C3 — Dashboard Activity feed is entirely missing (no endpoint, no component, dead type)**  
<sub>console · effort L · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.1: "Activity feed: recent ledger transactions in subtree (recharge, transfer, redemption) with actor, amount, time." Component inventory §5 lists `ActivityFeed`.
- **Actual:** The Dashboard renders only a KPI row, the (broken) credit-flow chart, and a "Needs your attention" attention list. There is no activity feed component on the page, no /reports/activity (or equivalent) endpoint in reports.controller.ts, and the `ActivityItem` type declared in types.ts:293 is never imported anywhere. The whole spec'd section is absent.
- **Evidence:** `apps/console/src/app/(app)/page.tsx:104-164` · `apps/console/src/lib/types.ts:293-300` · `apps/api/src/reports/reports.controller.ts:22-116`
- **Fix:** Add a scoped GET /reports/activity endpoint returning recent subtree ledger transactions (RECHARGE/TRANSFER/REDEEM* with actor, currency, amountMinor, at), build an ActivityFeed component, and render it on the dashboard. Wire socket `balance.changed`/`order.updated` to prepend live rows.

**DASH-C6 — Org tree node cards omit operator balance**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.2: "Node card shows display name, tier, balance, child count, active/suspended status."
- **Actual:** TreeNodeCard renders display name, tier, status and "N direct" child count but no balance. The OperatorTreeNode type carries no balance field, and getTree's NODE_SELECT does not include any ledger balance, so the data isn't even available to the card.
- **Evidence:** `apps/console/src/components/operators/tree-node-card.tsx:45-52` · `apps/console/src/lib/types.ts:47-49` · `apps/api/src/operators/operators.service.ts:49-60,171-186`
- **Fix:** Include each node's operator-account balance in the /operators/:id/tree payload (join ledger_accounts ownerType=OPERATOR) and render a BalanceChip/Money on TreeNodeCard.

**DASH-C8 — Operator detail "Orders" tab is a dead placeholder, not this node's orders**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.4: Orders tab = "credit orders where this node is buyer or seller."
- **Actual:** The Orders tab renders an EmptyState titled "Orders live on the Credits screen" with a link to /credits. /credits shows the logged-in caller's own inbox/outbox, not the orders of the operator being viewed. There is no order list filtered to this node, and the /orders endpoint is keyed to the caller (role=buyer/seller of self), so there is no backing query for an arbitrary descendant's orders.
- **Evidence:** `apps/console/src/app/(app)/operators/[id]/page.tsx:189-201`
- **Fix:** Add an orders list filtered to this operatorId (buyer or seller) — either an /orders query param scoped + ScopeChecked, or a dedicated /operators/:id/orders endpoint — and render it in the tab as a DataTable linking each row to its settled ledger transaction.

**DASH-C9 — Operator detail Settings tab and edit dialog handle only pricing — feature flags and enabled currencies missing**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.4 Settings tab: "feature flags, enabled currencies, pricing overrides." §3.3 create form also lists optional currency enablement / feature flags.
- **Actual:** The Settings tab shows only Buy price, Sell price, Depth, Created. The EditOperatorDialog edits only displayName + buy/sell cents. There is no UI to view or set feature flags or enabled currencies, even though the operator `settings` JSON column exists and update() persists a sanitized settings blob.
- **Evidence:** `apps/console/src/app/(app)/operators/[id]/page.tsx:202-219` · `apps/console/src/components/operators/edit-operator-dialog.tsx:64-75` · `apps/api/src/operators/operators.service.ts:188-211`
- **Fix:** Render the operator's feature flags + enabled currencies in the Settings tab and add corresponding fields to EditOperatorDialog, persisting through the existing settings blob (kept distinct from grants).

**CPR-C2 — Payment proof not displayed or linked on order rows**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.5 order columns include 'proof' so a confirming seller can inspect the uploaded payment evidence.
- **Actual:** proofUrl is captured at creation/mark-paid and stored (present on the CreditOrder type), but the credits table has no proof column or link; the value is never surfaced anywhere in the UI.
- **Evidence:** `apps/console/src/app/(app)/credits/page.tsx:42-53` · `apps/console/src/lib/types.ts:131`
- **Fix:** Add a proof cell that links/opens proofUrl (signed/preview) when present, '—' otherwise.

**CPR-C3 — Settled order rows do not link to the resulting ledger transaction**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.5: 'Each order row links to the resulting ledger transaction once settled, so the credit movement and the paperwork are tied together.'
- **Actual:** The backend sets issuedTxId on issue and the field exists on the DTO, but nothing in the console references it — there is no link from an ISSUED order to the ledger tx (the ledger tx explorer lives only on /ledger).
- **Evidence:** `apps/console/src/app/(app)/credits/page.tsx:42-108` · `apps/api/src/orders/orders.service.ts:185-188` · `apps/console/src/lib/types.ts:131`
- **Fix:** When status === ISSUED and issuedTxId is set, render a link to the ledger transaction view (e.g. /ledger?tx=) or open a tx drawer.

**CPR-C4 — Outbox cannot upload payment proof to an already-created order**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.5 outbox: 'Status tracking, upload payment proof, cancel if pending.' The buyer should be able to attach proof after submitting the request.
- **Actual:** The buyer's only outbox action is Cancel. Proof can be attached only at order-creation time (NewOrderDialog); there is no buyer-side proof/update action in OrderRowActions and no corresponding buyer endpoint on the orders controller (mark-paid is seller-only).
- **Evidence:** `apps/console/src/components/credits/order-row-actions.tsx:108-114` · `apps/api/src/orders/orders.controller.ts:31-113`
- **Fix:** Add a buyer 'Upload/attach proof' action for REQUESTED/AWAITING_PAYMENT orders, backed by a buyer-scoped order update endpoint that sets proofUrl/paymentMethod.

**CPR-C5 — Live order updates are a dead wire — API emits no order events**  
<sub>realtime · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.5: 'Live: order.updated updates rows in place; inbox badge increments on new recharge.requested/order events.'
- **Actual:** The console maps order.updated -> invalidate ['orders',...] and runs useRealtime at the shell, but the API never emits order.updated (zero hits in apps/api) and request() (new order) emits no outbox event at all. So order rows never update in place from a counterparty action; the inbox badge only refreshes via a 60s React Query poll, not live.
- **Evidence:** `apps/api/src/orders/orders.service.ts:60-85` · `apps/console/src/lib/socket.ts:21-31` · `apps/console/src/components/shell/sidebar.tsx:24-30`
- **Fix:** Emit outbox events (order.updated on every state transition, plus an event on request) targeting operator:{buyerId} and operator:{sellerId} rooms so the wired invalidation actually fires.

**CPR-C7 — Player list filters incomplete (no agent/balance-range/activity)**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.6: filters 'by agent, status, balance range, activity.'
- **Actual:** Only a status SegmentedControl and a username search are exposed. The agent filter is supported by the API (operatorId param) but never surfaced in the UI; balance-range and activity filters are unsupported in both listPlayersQuerySchema and the UI.
- **Evidence:** `apps/console/src/app/(app)/players/page.tsx:26-99` · `packages/shared/src/schemas/players.ts:21-27`
- **Fix:** Expose an agent picker (operatorId), add balance-range and last-active/activity filters to the schema + service + UI.

**CPR-C9 — Player notes/flags feature entirely missing**  
<sub>console · effort L · ✓ verified</sub>

- **Expected:** docs/06 §3.6 player detail includes 'notes/flags.'
- **Actual:** Player detail has no notes/flags panel; the Player model has no notes field; there is no API for player notes. The capability is unbuilt at every layer.
- **Evidence:** `apps/console/src/app/(app)/players/[id]/page.tsx:130-182` · `packages/db/prisma/schema.prisma:137-162`
- **Fix:** Add a PlayerNote model (append-only, authored, audited) + list/create endpoints + a Notes panel on player detail.

**CPR-C15 — No upward admin 'adjust' action — only recharge (debits agent) and burn-removal**  
<sub>console · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.6 player-detail actions include 'adjust (admin + reason, writes AuditLog)' — an admin correction that can move a balance either direction.
- **Actual:** The console offers recharge (debits the agent's balance) and remove-credits (burns to SINK). There is no ADJUSTMENT-account-based admin correction that can credit a player without taking it from the agent; the downward case is covered by remove, the upward correction is not.
- **Evidence:** `apps/console/src/app/(app)/players/[id]/page.tsx:102-113` · `apps/api/src/wallet/wallet.service.ts:135-184`
- **Fix:** Add an admin adjust action (ADJUSTMENT system account, reason-required, audited) supporting upward corrections.

**RRL-C7 — Redemptions queue missing owning-agent and KYC-status columns (KYC not even returned by the queue API)**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.8 queue columns: player, owning agent, amount, requested time, age in queue, status, KYC status (compliance).
- **Actual:** The queue table renders player, amount, method, status, age only. There is no 'owning agent' column (ownerOperatorId is returned but unused, and it's only an id with no name resolution) and no KYC-status column. The queue endpoint (RedemptionsService.queue) only includes player.username + operatorId — it does not return KYC status, so the column can't be added without backend support.
- **Evidence:** `apps/console/src/app/(app)/redemptions/page.tsx:48-59` · `apps/api/src/redemptions/redemptions.service.ts:190-207`
- **Fix:** Add owning-agent (resolve operator displayName) and KYC-status columns; extend the queue endpoint to include each player's kycStatus (join Kyc) so the compliance signal is visible before opening detail.

**RRL-C8 — Redemption detail omits player balance and prior-redemption history**  
<sub>console · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.8 detail: 'player context, balance, redemption amount, KYC/AML state, history of this player's prior redemptions.'
- **Actual:** The detail page shows amount, method/dates, payout ref, and a compliance panel, but the player's redeemable balance is only fetched/shown inside the Approve confirm dialog (enabled when dialog==='approve'), not on the page body, and there is no list of the player's prior redemptions. The get() endpoint returns compliance state but no prior-redemption history.
- **Evidence:** `apps/console/src/app/(app)/redemptions/[id]/page.tsx:49-54` · `apps/console/src/app/(app)/redemptions/[id]/page.tsx:143-211` · `apps/api/src/redemptions/redemptions.service.ts:209-222`
- **Fix:** Show the player's redeemable balance on the detail page (not just in the dialog) and add a prior-redemptions history list (reuse listMine-style query by playerId, or include it in get()).

**CAS-CA3 — KYC document preview has no view/download signed URL**  
<sub>compliance · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.11 KYC queue: document preview from R2 via a signed URL so reviewers can see the ID document before approving.
- **Actual:** The KYC queue links directly to the raw stored documentUrl (kyc.service.ts returns r.documentUrl as-is; the UI uses it as the href). StorageService only presigns UPLOAD (presignUpload) — there is no GET/download presign. For a private KYC bucket the reviewer's 'View' link will 403; the review workflow cannot reliably display the document. (StorageService is an acknowledged stub returning r2.stub.local URLs, but the missing download-presign code path is a real gap independent of the stub.)
- **Evidence:** `apps/console/src/components/compliance/kyc-queue.tsx:54-69` · `apps/api/src/compliance/kyc.service.ts:122-135` · `apps/api/src/storage/storage.service.ts:22-31`
- **Fix:** Add a presignDownload to StorageService and a GET endpoint (or include a freshly-signed view URL in the KYC queue payload) so the console fetches a short-lived signed URL for document preview instead of linking the raw stored URL.

**CAS-CA4 — Announcements compose form missing schedule, branch/tier targeting, and deactivate action**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.13: compose, schedule, target by tier/branch, and publish; manage (end) announcements.
- **Actual:** The compose form sends only { title, body, audience }; the API + createAnnouncementSchema support operatorScopePath (target by branch), startsAt and endsAt (scheduling), none of which have UI controls. The list shows Active/Ended state but has no row action to deactivate, despite DELETE /announcements/:id existing.
- **Evidence:** `apps/console/src/app/(app)/announcements/page.tsx:47-67` · `packages/shared/src/schemas/announcements.ts:10-20` · `apps/api/src/notifications/announcements.controller.ts:43-49`
- **Fix:** Add startsAt/endsAt date pickers, a branch/tier target selector (operatorScopePath), and a deactivate/end row action wired to DELETE /announcements/:id.

**CAS-CA5 — Announcement creation does not push realtime or fan out Notifications (client listens for an event the server never emits)**  
<sub>realtime · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.13: publishing 'Pushes announcement socket event + writes Announcement/Notification.'
- **Actual:** AnnouncementsService.create writes only the Announcement row — no OutboxEvent/socket emit and no per-recipient Notification rows. No 'announcement' emit exists anywhere in the API, yet the console socket map listens for an 'announcement' event to invalidate caches. Delivery is therefore poll-on-load/reconnect only; the realtime half is wired on the client but absent on the server.
- **Evidence:** `apps/api/src/notifications/announcements.service.ts:35-58` · `apps/console/src/lib/socket.ts:29`
- **Fix:** On create, write an OutboxEvent (type 'announcement', rooms scoped to the target subtree/audience) and fan out Notification rows for targeted recipients, matching the existing outbox pattern used by self-exclude and aml.flagged.

**CAS-CA6 — Audit log UI missing date-range, actor-identity, and target-id filters and the session column**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.12: filter by actor, action type, entity, and date; each row shows who/what/when, before/after, IP/session.
- **Actual:** The audit page exposes only actorType, action, and targetType filters. The API + auditQuerySchema support from/to (date range), actorId, and targetId — none surfaced in the UI (date filter is explicitly required by the spec). The detail drawer shows IP but not userAgent/session, although AuditLogRow includes userAgent and the DB stores it.
- **Evidence:** `apps/console/src/app/(app)/audit/page.tsx:60-75` · `apps/console/src/app/(app)/audit/page.tsx:92-108` · `packages/shared/src/schemas/reports.ts:46-57` · `apps/console/src/lib/types.ts:342-354`
- **Fix:** Add a from/to date-range filter (required by spec), actorId and targetId inputs, and render userAgent/session in the detail drawer.

**CAS-CA7 — AML flags have no drill-in to the player or triggering activity**  
<sub>compliance · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.11 AML: drill into the player + triggering activity, then resolve/escalate.
- **Actual:** The AML list shows ruleCode, truncated subject, severity, status; the resolve modal only offers a resolution + note. There is no link to the subject player's profile and no rendering of the flag's details JSON (the triggering activity), even though AmlFlag.details is populated by createFlag and returned by listFlags.
- **Evidence:** `apps/console/src/components/compliance/aml-flags.tsx:62-72` · `apps/console/src/components/compliance/aml-flags.tsx:100-132` · `apps/api/src/compliance/aml.service.ts:45-60` · `packages/db/prisma/schema.prisma:569-581`
- **Fix:** Add a flag detail drawer that links subjectId to the player/operator profile and renders the details JSON (triggering activity) before the resolve/escalate action.

**CAS-CA9 — Platform settings omit session/JWT lifetimes, redemption-approval routing, RTP bounds, and read-only CREDIT_MINOR_UNITS display**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.14 platform settings: PLATFORM_MODE, CREDIT_MINOR_UNITS (read-only), default RTP bounds, redemption approval routing, KYC/geo toggles, session/JWT lifetimes.
- **Actual:** The panel only edits PLATFORM_MODE, a single DEFAULT_GAME_RTP_BPS (not min/max bounds), REDEMPTION_KYC_THRESHOLD_MINOR, KYC_ENFORCED, GEO_ENFORCED. Missing: session/JWT lifetimes (also absent from updatePlatformSettingsSchema), redemption-approval routing, and a read-only CREDIT_MINOR_UNITS display (the API returns it readOnly but the UI never renders it).
- **Evidence:** `apps/console/src/app/(app)/settings/page.tsx:186-207` · `packages/shared/src/schemas/settings.ts:24-31` · `apps/api/src/settings/settings.service.ts:52-59`
- **Fix:** Add session/JWT lifetime fields (and matching schema keys), redemption-approval routing controls, RTP min/max bound fields, and a read-only CREDIT_MINOR_UNITS row.

**CAS-CA10 — Node settings omit enabled currencies, feature flags, and redemption-approval routing editor**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.14 node settings: display name, enabled currencies, feature flags, pricing defaults for children.
- **Actual:** The node panel edits only displayName, buy/sell prices, and prizeBonusBps. Missing: enabled currencies and feature flags. redemptionApproval routing is returned by getNode and supported by updateNodeSettingsSchema but has no UI editor. The prizeBonusBps field is shown to all settings.manage tiers though the server 403s tiers lacking operator.set_pricing (field shown but not permitted).
- **Evidence:** `apps/console/src/app/(app)/settings/page.tsx:96-119` · `packages/shared/src/schemas/settings.ts:34-41` · `apps/api/src/settings/settings.service.ts:98-114`
- **Fix:** Add enabled-currencies and feature-flag controls and a redemption-approval routing editor; hide/disable the prize-bonus field for tiers without operator.set_pricing.

**SHELL-C1 — Topbar global search is entirely missing**  
<sub>console · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §1 requires the topbar to include a global search alongside the mode badge, balance pill, notifications and account menu; §5 implies a search-driven console.
- **Actual:** The Topbar renders only ModeBadge, BalancePill, NotificationBell and AccountMenu — there is no search input, no command palette / GlobalSearch component, and no API search endpoint at all. Only per-page local filters exist (org subtree search, players username search, ledger transaction explorer). There is no cross-entity search reachable from the shell.
- **Evidence:** `apps/console/src/components/shell/topbar.tsx:11-24` · `apps/console/src/components/shell/app-shell.tsx:39-49` · `grep: no '@Get("search")' or /search in apps/api/src/**/*.controller.ts` · `grep: no GlobalSearch/command-palette component in apps/console/src`
- **Fix:** Add a debounced global search box in the topbar backed by a scoped GET /search?q= endpoint that returns operators/players/orders/redemptions within the caller's subtree, with keyboard (cmd-k) open and result-type grouping; route results to the existing detail pages.

**SHELL-C2 — Notification mark-read is built server-side but completely unwired in the bell**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §1: bell with unread count fed by Notification + socket; opening/reading notifications should clear the unread badge. The API already exposes POST /notifications/:id/read and /read-all and returns an authoritative unreadCount.
- **Actual:** NotificationBell never calls /notifications/:id/read or /read-all — opening the dropdown or clicking an item does not mark anything read, so the unread badge can never clear from the UI. It also ignores the API's unreadCount and instead derives unread from items.filter(readAt===null) over only the 20 fetched rows, so the count is wrong/capped when more than 20 are unread. The console NotificationRow/Page type drops the unreadCount field returned by the API.
- **Evidence:** `apps/console/src/components/shell/notification-bell.tsx:14-23` · `apps/console/src/components/shell/notification-bell.tsx:33-39` · `apps/api/src/notifications/notifications.controller.ts:24-34` · `apps/api/src/notifications/notifications.service.ts (list returns {items,nextCursor,unreadCount})` · `apps/console/src/lib/types.ts:370-378`
- **Fix:** Type the list response with unreadCount and drive the badge from it; call POST /notifications/read-all when the dropdown opens (or per-item /read on click) and optimistically clear, with a 'Mark all read' header action; keep the socket invalidation for live increments.

**SHELL-C4 — Dashboard ActivityFeed component/section is missing**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.2 requires an Activity feed (recent ledger transactions in subtree — recharge/transfer/redemption — with actor, amount, time) and §5 lists an ActivityFeed component.
- **Actual:** The dashboard renders KPI row, CreditFlowChart and a 'Needs your attention' list, but no activity feed of recent ledger movements. No ActivityFeed component exists anywhere in the codebase. (Overlaps the dashboard dimension.)
- **Evidence:** `apps/console/src/app/(app)/page.tsx:104-164` · `grep: no ActivityFeed in apps/console/src or packages/ui/src`
- **Fix:** Build an ActivityFeed component fed by a scoped recent-ledger endpoint and add it to the dashboard, rendering actor + Money + relative time per row.

**API-A3 — No signed-read endpoint for KYC document preview; queue returns raw stored URL**  
<sub>compliance · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.11 (line 149): KYC queue must let an operator preview the submitted document 'from R2, signed URL' before approve/reject.
- **Actual:** kyc.service.queue returns the raw stored documentUrl with no presigned-read generation, and there is no GET endpoint to mint a short-lived read URL for a private KYC object. With a real private R2 bucket the raw URL is not viewable; with the current stub it is fake. There is a presign-for-upload path but no presign-for-download path.
- **Evidence:** `apps/api/src/compliance/kyc.service.ts:130` · `apps/api/src/compliance/kyc.service.ts:138` · `apps/api/src/storage/storage.service.ts:22` · `outline-docs/06-frontend-console.md:149`
- **Fix:** Add a scoped GET /compliance/players/:id/kyc/doc-url (or include a signed read URL in the queue/decision payload) that presigns a short-TTL GET against the kyc bucket key, gated by compliance.manage + subtree scope.

**API-A6 — GET /players list lacks wallet balance and lifetime recharged/redeemed columns required by the players screen**  
<sub>api · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.6 (line 106): player list columns include 'wallet balance(s) ... lifetime recharged, lifetime redeemed'.
- **Actual:** PlayersService.list selects PLAYER_SELECT only (id, operatorId, username, displayName, phone, email, status, lastLoginAt, createdAt) — no wallet balances and no lifetime aggregates. The console players table consequently renders only Player/Status/Last active/Joined, dropping balance and lifetime columns from the spec.
- **Evidence:** `apps/api/src/players/players.service.ts:125` · `apps/api/src/players/players.service.ts:64` · `apps/console/src/app/(app)/players/page.tsx:57` · `outline-docs/06-frontend-console.md:106`
- **Fix:** Return wallet balance(s) and lifetime recharged/redeemed (aggregated per player, range-unbounded) in the list payload, or add a lightweight batched stats sub-query; then add the columns in the console table.

**DBSCH-DB1 — Missing indexes for cursor lists and subtree reports**  
<sub>db · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Cursor lists ordered by createdAt and date-ranged subtree ledger aggregations should be backed by composite indexes per the performance budget.
- **Actual:** CreditOrder, Player, Announcement and Notification lists order by createdAt without a createdAt index, and the ledger report aggregations over a subtree are unindexed.
- **Evidence:** `packages/db/prisma/schema.prisma:159-160` · `apps/api/src/reports/reports.service.ts:261-292`
- **Fix:** Add createdAt-aligned composite indexes on CreditOrder, Player, Announcement, ledger entries and Notification.

**AUTHZ-C1 — ledger.adjust orphan permission; manual adjustment unbuilt**  
<sub>rbac · effort L · ○ unverified (cut off by session limit)</sub>

- **Expected:** Every Permission wired to an endpoint.
- **Actual:** ledger.adjust defined, in BASE_MATRIX/GRANTABLE/SUPER_ADMIN_ONLY, unit-tested, but no controller or endpoint implements it.
- **Evidence:** `packages/shared/src/permissions.ts:140`
- **Fix:** Build a ledger.adjust endpoint or remove the permission.

**RT-R4 — announcement event and Notification fan-out unbuilt — announcements never push live or populate the bell**  
<sub>realtime · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.13 (line 159): creating an announcement "Pushes `announcement` socket event + writes Announcement/Notification". The console listens for the announcement event (socket.ts:29) and the notification bell is "fed by Notification + socket" (docs/06:26).
- **Actual:** AnnouncementsService.create only inserts the Announcement row and an audit entry — no OutboxEvent and no Notification rows are written. The announcement realtime event is emitted nowhere in the API, and no Notification fan-out is generated, so recipients never get a live push or a bell entry; they only see announcements on manual list fetch. (A self-documented decision in the service comment, but it diverges from the spec.)
- **Evidence:** `apps/api/src/notifications/announcements.service.ts:35-58` · `apps/console/src/lib/socket.ts:29` · `outline-docs/05-api-spec.md:241` · `outline-docs/06-frontend-console.md:159`
- **Fix:** On announcement create, in one transaction write an `announcement` OutboxEvent { id, title } scoped to the target rooms (and/or admin:global) plus Notification rows for the targeted audience within operatorScopePath, so the bell and live push work as spec'd.

**CMPL-CR9 — AML flags console omits spec'd severity/status filters and player drill-down**  
<sub>console · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.11: 'AML flags: open flags by severity, drill into the player + triggering activity, resolve/escalate.'
- **Actual:** The AML screen lists flags with a single hardcoded `?limit=50` query and resolve action only. The API (amlFlagsQuerySchema) supports severity, status, and subjectId filters that are never surfaced. The subject column shows `subjectType · subjectId.slice(0,8)` as plain text with no link to the player/operator and no view of triggering activity, so an operator cannot triage by severity/status or drill in.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/console/src/components/compliance/aml-flags.tsx:40` · `/Users/willz/ai/Fire-Casino/apps/console/src/components/compliance/aml-flags.tsx:64` · `/Users/willz/ai/Fire-Casino/packages/shared/src/schemas/compliance.ts:77`
- **Fix:** Add severity/status filter controls wired to the query params, link the subject to its player/operator detail, and render the flag details JSON (triggering activity) in the resolve modal.

**CMPL-CR10 — Promotions create form omits caps/window fields and has no lifecycle actions**  
<sub>console · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.11 promos config; createPromotionSchema supports maxRedemptions, perPlayerLimit, startsAt, endsAt; promotions have a status (ACTIVE/…) and per-player/total caps enforced server-side.
- **Actual:** The console create form only sends code, description, currency, grantMinor, isAmoe — maxRedemptions, perPlayerLimit, startsAt, endsAt are never set, so perPlayerLimit always defaults to 1 and total cap/validity window cannot be configured from the UI. The list shows no redemption-count or cap columns and offers no actions to pause/deactivate/end a promotion (no status-change route exists), so a promo cannot be turned off once created.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/console/src/components/compliance/promotions.tsx:50` · `/Users/willz/ai/Fire-Casino/packages/shared/src/schemas/compliance.ts:94` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/promotions.service.ts:88`
- **Fix:** Add perPlayerLimit/maxRedemptions/startsAt/endsAt inputs to the create form, show redemptions-used vs cap columns, and add a deactivate/end action backed by a promotion status-update endpoint.

**CMPL-CR11 — Geo rules console lacks 'region-blocked players' view and overstates enforcement**  
<sub>console · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.11: 'Geo rules: list GeoRule (allowed/blocked regions), toggle, see which players are region-blocked.'
- **Actual:** The geo screen lists/adds/removes rules but provides no view of which players are region-blocked (the platform stores no player region, so this is unbuildable as-is), and the panel text asserts rules are 'enforced at login and redemption' / 'Login + redemption enforce these' while no enforcement actually runs (see CR1).
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/console/src/components/compliance/geo-rules.tsx:89` · `/Users/willz/ai/Fire-Casino/outline-docs/06-frontend-console.md:150`
- **Fix:** Persist the player's last-seen region (resolved at login/play per CR1) to power a 'region-blocked players' view, and only claim enforcement once CR1/CR6 land.


### LOW

**DASH-C4 — Dashboard KPI row omits pending-redemptions total and pending-orders outbox**  
<sub>console · effort S · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.1 KPI row: "Pending redemptions (count + total)" and "Pending orders (in/out)".
- **Actual:** The dashboard shows only the redemption count (no total amount) and only the inbox tile labeled "Pending orders (in)" — there is no outbox tile. The API already returns `pendingRedemptions.totalMinor` and `pendingOrders.outbox`, so the data is fetched but discarded.
- **Evidence:** `apps/console/src/app/(app)/page.tsx:80-85` · `apps/console/src/lib/types.ts:261-263` · `apps/api/src/reports/reports.service.ts:82-86`
- **Fix:** Add the pending-redemptions total (e.g. as KPI hint or second value) and an "Pending orders (out)" tile reading `pendingOrders.outbox`.

**DASH-C5 — Super-admin dashboard extras incomplete: circulation-identity status and settlement exposure missing**  
<sub>console · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.1: "Super admin additionally gets: total minted, total revenue, circulation identity check status (docs/03 §8), settlement exposure (unpaid CreditOrder cash)."
- **Actual:** The super-admin block renders only "Total minted" and "House revenue". The /reports/overview service already computes a `reconciliation` block (the circulation-identity / zero-sum checks) but the ReportsOverview type omits it and the dashboard never renders it. Settlement exposure (unpaid order/redemption cash) is not part of the overview payload at all and is not surfaced on the dashboard (it only lives on the separate /reports settlement view).
- **Evidence:** `apps/console/src/app/(app)/page.tsx:88-102` · `apps/console/src/lib/types.ts:256-264` · `apps/api/src/reports/reports.service.ts:91-110` · `apps/api/src/reports/reports.service.ts:393-426`
- **Fix:** Add `reconciliation` to ReportsOverview and render a pass/fail circulation-identity indicator; include a settlement-exposure figure (unpaid order + redemption cents) in the overview payload and render it as a super-admin KPI linking to /reports settlement.

**DASH-C7 — Org chart has no lazy-loading; deep branches beyond depth 6 are invisible**  
<sub>console · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.2: "Lazy-load deep branches via GET /operators/:id/tree?depth=."
- **Actual:** org/page.tsx fetches the entire subtree once at `?depth=6` and renders client-side expand/collapse over that static blob. The API clamps depth to max 10. Any node deeper than 6 levels below the caller is never fetched and cannot be expanded into — there is no on-demand fetch when expanding a node. For deep distribution trees this both omits data and pulls a large eager payload.
- **Evidence:** `apps/console/src/app/(app)/org/page.tsx:34-37,69-89` · `apps/api/src/operators/operators.controller.ts:76-82`
- **Fix:** Fetch a shallow tree initially and lazy-fetch children via GET /operators/:id/tree?depth=1 (or a children endpoint) on first expand, caching per node.

**DASH-C10 — Create-operator form omits optional currency enablement and feature flags**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.3: create form fields include "optional settings (currency enablement, feature flags)."
- **Actual:** CreateOperatorDialog collects tier, display name, username, temp password (with generate), and optional buy/sell cents only. There are no controls for currency enablement or feature flags, so a new node can only be configured for those after creation (and currently not at all, per C9).
- **Evidence:** `apps/console/src/components/operators/create-operator-dialog.tsx:131-187`
- **Fix:** Add optional currency-enablement and feature-flag inputs that feed createOperatorSchema.settings.

**DASH-C11 — Operators list lacks balance/child-count columns and any status/tier filter or search**  
<sub>console · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §2 (Operators = "list + manage children") and §3.2 emphasis on balances and search/filter by name/tier/status across the subtree.
- **Actual:** The operators list table shows Operator/Tier/Status/Depth/Created only, with a single children/subtree segmented control. There is no balance column, no child-count, no text search, and no status or tier filter on the list page (search exists only on the Org page).
- **Evidence:** `apps/console/src/app/(app)/operators/page.tsx:33-39,58-65`
- **Fix:** Add a balance column (needs balances in the list payload) and add search + status/tier filters wired to the list query params.

**DASH-C12 — Operator detail Overview tab omits parent linkage spec'd in §3.4**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.4 Overview: "balance, tier, parent, created, status, pricing."
- **Actual:** Overview tab shows balance + 3 subtree KpiStats. Tier/status are in the header and pricing/created are split to the Settings tab, but the parent is never surfaced as a value or navigable link — only the raw materialized path string appears in the header subtitle.
- **Evidence:** `apps/console/src/app/(app)/operators/[id]/page.tsx:123-131,253-282`
- **Fix:** Surface the parent operator (name + link to /operators/:parentId) on the Overview tab.

**CPR-C10 — Owning agent rendered as raw UUID on player detail**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** Owning agent shown as a human-readable name and linked to the operator detail.
- **Actual:** Profile panel renders 'Owning agent' = p.operatorId as a truncated mono UUID with no name and no link to /operators/:id.
- **Evidence:** `apps/console/src/app/(app)/players/[id]/page.tsx:159`
- **Fix:** Return owning-operator displayName on PlayerDetail and render it as a link to the operator detail.

**CPR-C12 — Player detail histories merged into one feed; no per-type tabs/filters or round drill-down**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.6 player detail: distinct recharge history, gameplay history (sessions/rounds, read-only), redemption history.
- **Actual:** All three are merged into a single Activity timeline with no per-type filtering/tabs; sessions show only totals (totalBet/totalWin) with no round-level drill-down. Content is present and read-only, but not separable per the spec.
- **Evidence:** `apps/console/src/app/(app)/players/[id]/page.tsx:147-150` · `apps/console/src/app/(app)/players/[id]/page.tsx:215-247`
- **Fix:** Add type filters/tabs to the timeline (recharge / gameplay / redemptions) and a session->rounds drill-down.

**CPR-C13 — RG limits and self-exclusion shown only as counts on player detail**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.6: 'responsible-gaming limits + self-exclusion status.'
- **Actual:** ComplianceSummary renders 'RG limits: <count>' and 'Self-excluded: Yes/No' but does not show the actual limit type/period/value or the self-exclusion-until date, even though PlayerComplianceState already carries rgLimits values and selfExclusionUntil.
- **Evidence:** `apps/console/src/app/(app)/players/[id]/page.tsx:278-289` · `apps/console/src/lib/types.ts:187-196`
- **Fix:** Render the actual rgLimits (type/period/value) and selfExclusionUntil from the already-available state.

**CPR-C14 — Recharge lacks compliance-mode PLAY+PRIZE bonus-split preview and player post-balance**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §3.7: in compliance mode the form 'shows PLAY purchase + PRIZE bonus split per promo' and the spec wants the post-recharge result shown before confirm.
- **Actual:** The dialog shows only a generic note that a PRIZE bonus applies; the confirm dialog shows only the agent's balance delta, never the player's resulting PLAY + PRIZE split (the bonus is computed server-side and not previewed).
- **Evidence:** `apps/console/src/components/players/recharge-dialog.tsx:122-149`
- **Fix:** Compute/preview the PRIZE bonus split client-side (or via a preview endpoint) and add the player's resulting PLAY/PRIZE balances to the confirm deltas.

**RRL-C5 — Ledger system-account grid omits the required expected-sign indicators**  
<sub>reports · effort S · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.10: system account balances shown 'with expected-sign indicators' (e.g., MINT non-positive, REDEMPTION_CLEARING non-negative).
- **Actual:** The backend already returns expectedSign and a per-account ok verdict (SYSTEM_SIGN map + okForSign), but the ledger page only renders account name + currency + balance — no sign expectation and no pass/fail badge. The frontend SystemAccountBalance type even lacks the `ok` field.
- **Evidence:** `apps/api/src/reconciliation/reconciliation.service.ts:40-102` · `apps/console/src/app/(app)/ledger/page.tsx:133-145` · `apps/console/src/lib/types.ts:309-314`
- **Fix:** Render expectedSign + ok per system account (e.g., a small badge: 'expects ≤0', green/red on ok). Add `ok` to the type.

**RRL-C9 — 'Run reconciliation now' runs synchronously instead of enqueuing the job**  
<sub>reports · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.10: manual button 'enqueues the job'; the BullMQ reconciliation queue/worker already exists (reconciliation.processor.ts).
- **Actual:** POST /reports/ledger-health/run just calls reports.ledgerHealth() (which runs reconciliation.runAll() inline and returns the snapshot). It does not add a job to the reconciliation queue, and the result isn't written to RECON_LAST_KEY. The frontend expects {jobId?:string} and ignores the body, then refetches health (which is broken per C4). Functionally the checks do run, but not via the queue and the cached last-run isn't updated.
- **Evidence:** `apps/api/src/reports/reports.controller.ts:100-106` · `apps/api/src/reports/reports.service.ts:503-509` · `apps/api/src/reconciliation/reconciliation.processor.ts:26-82`
- **Fix:** Either enqueue the BullMQ job (queue.add(JOB_NAME)) and return its id, or keep synchronous but also persist the result to RECON_LAST_KEY so lastRun/cache stays consistent with the scheduled worker.

**RRL-C10 — Transaction explorer gives no 'not found' feedback**  
<sub>reports · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Searching a non-existent id/key should tell the user nothing was found.
- **Actual:** lookupTransaction returns null when no match; the mutation onSuccess sets tx=null and clears txError, so the UI silently shows nothing — indistinguishable from 'not searched yet'.
- **Evidence:** `apps/console/src/app/(app)/ledger/page.tsx:66-69` · `apps/api/src/reconciliation/reconciliation.service.ts:124`
- **Fix:** When the lookup resolves to null, set a 'No transaction found' message instead of clearing state silently.

**RRL-C11 — Approve button stays enabled when compliance gates are visibly failing**  
<sub>console · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.8: 'if KYC not verified or AML flag open, approve is blocked with the reason surfaced.'
- **Actual:** The detail page shows a warning banner when KYC!=VERIFIED or open AML>0, but the Approve button remains clickable; blocking relies entirely on the server (checkRedeem) returning an error that surfaces as a toast. Server enforcement is correct, but the UI does not proactively disable/guard the action.
- **Evidence:** `apps/console/src/app/(app)/redemptions/[id]/page.tsx:119-130` · `apps/console/src/app/(app)/redemptions/[id]/page.tsx:187-191` · `apps/api/src/redemptions/redemptions.service.ts:232-234`
- **Fix:** Disable Approve (with tooltip) when data.compliance.kycStatus!=='VERIFIED' or openAmlFlags>0 or selfExcluded, keeping server enforcement as the backstop.

**CAS-CA8 — Geo rules screen lacks the blocked-players view and an inline toggle**  
<sub>compliance · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.11 Geo rules: list rules, toggle, and see which players are region-blocked.
- **Actual:** The geo component supports list / add (modal) / delete only. There is no way to see which players are currently region-blocked, and changing a rule's allow/block requires delete + re-add rather than a toggle.
- **Evidence:** `apps/console/src/components/compliance/geo-rules.tsx:75-114` · `apps/api/src/compliance/compliance.controller.ts:83-111`
- **Fix:** Add an inline ALLOW/BLOCK toggle on each rule and a 'region-blocked players' view (or a count/list per region) so reviewers can see enforcement impact.

**CAS-CA11 — KYC/AML read queries gated on compliance.manage instead of compliance.view**  
<sub>rbac · effort S · ✓ verified</sub>

- **Expected:** Read access on the compliance screens should follow compliance.view (the tab gate), consistent with the geo/promotions panels.
- **Actual:** KycQueue and AmlFlags enable their list query with `enabled: canManage` (compliance.manage), while the tab is gated on compliance.view and geo/promotions correctly enable on compliance.view. A pure view-only compliance role would see empty KYC/AML lists. Not currently exploitable because the permission matrix grants compliance.view and compliance.manage to the same tiers (SUPER_ADMIN/ADMIN), but it is a latent inconsistency.
- **Evidence:** `apps/console/src/components/compliance/kyc-queue.tsx:25-28` · `apps/console/src/components/compliance/aml-flags.tsx:40-43` · `packages/shared/src/permissions.ts:138-139`
- **Fix:** Gate the list fetches on compliance.view and keep the approve/resolve actions gated on compliance.manage.

**CAS-CA12 — No hard confirm on critical-money platform settings other than mode**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.14: 'Mode/critical-money settings show a hard confirm.'
- **Actual:** Only a mode change triggers the ConfirmDialog (attemptSave checks modeChanged). Changes to DEFAULT_GAME_RTP_BPS and REDEMPTION_KYC_THRESHOLD_MINOR (critical-money settings) save with no confirmation.
- **Evidence:** `apps/console/src/app/(app)/settings/page.tsx:172-177` · `apps/console/src/app/(app)/settings/page.tsx:215-224`
- **Fix:** Trigger the hard-confirm dialog when RTP or the KYC redemption threshold change, not just on mode change.

**SHELL-C3 — Shared DataTable is not sortable**  
<sub>console · effort M · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §5 lists 'DataTable (sortable, cursor-paginated, scoped fetch)'; §3.8 redemptions queue must 'Sort by age', §3.6 players list implies sortable columns.
- **Actual:** The DataTable Column interface exposes only key/header/render/align/numeric/className — no sort flag, no sort indicator, no onSort callback — and no console page implements column sorting (a repo-wide grep for sort/sortBy/onSort in console pages returns nothing). Lists render in server default order with no client or server sort affordance.
- **Evidence:** `packages/ui/src/data-table.tsx:8-16` · `packages/ui/src/data-table.tsx:44-123` · `grep: no sort/sortBy/onSort usage under apps/console/src/app or components`
- **Fix:** Add a sortable column option to DataTable (header click → sort state) wired to a sort query param the list endpoints honor; at minimum implement 'sort by age' on the redemptions queue per §3.8.

**SHELL-C5 — Mode-conditional navigation is not implemented**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §1: in COMPLIANCE mode the redemption/KYC/geo nav items appear; in OPERATOR mode they are hidden or collapsed (redemptions simpler).
- **Actual:** nav-config gates Redemptions and Compliance purely on permissions (redemption.view / compliance.view) and never references PLATFORM_MODE, so the sidebar does not change shape with mode. Works only because permissions happen to align with mode; the spec's mode-driven nav behavior is not actually implemented.
- **Evidence:** `apps/console/src/components/shell/nav-config.ts:31-44` · `apps/console/src/components/shell/sidebar.tsx:41`
- **Fix:** Add a mode predicate to NAV_ITEMS (using the live mode from S1) so compliance/KYC/geo items collapse in OPERATOR mode and the redemptions surface simplifies, per §1.

**API-A4 — GET /operators/:id/stats is partial — missing GGR and redemptions rollups**  
<sub>reports · effort S · ✓ verified (severity adjusted)</sub>

- **Expected:** outline-docs/05 §2 (line 44): operator stats = 'active players, credits in circulation below this node, GGR, redemptions'.
- **Actual:** OperatorsService.getStats returns only operatorCount, activePlayers, and circulationBelowMinor. GGR (gross gaming revenue / house edge) and redemption rollups for the node's subtree are not computed or returned.
- **Evidence:** `apps/api/src/operators/operators.service.ts:337` · `apps/api/src/operators/operators.service.ts:356` · `outline-docs/05-api-spec.md:44`
- **Fix:** Extend getStats to add subtree GGR (sum GAME_BET debits minus GAME_WIN credits, as in ReportsService.revenue) and redemption totals (count + amount by status), reusing the existing scoped aggregate patterns.

**API-A5 — Redemption approval queue omits KYC status the console needs to gate approvals**  
<sub>api · effort S · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §3.8 (lines 122-125): queue shows 'KYC status (compliance)' as a column and the UI must surface KYC/AML state so approve can be blocked with a reason.
- **Actual:** RedemptionsService.queue returns the request DTO plus playerUsername and ownerOperatorId only — no KYC status, no open-AML-flag indicator. The console queue therefore cannot render the KYC column or pre-warn that approve will be blocked without N extra per-row fetches.
- **Evidence:** `apps/api/src/redemptions/redemptions.service.ts:191` · `apps/api/src/redemptions/redemptions.service.ts:203` · `outline-docs/06-frontend-console.md:122`
- **Fix:** Enrich each queue item with the player's kyc.status (and an open-AML-flag boolean) via an include/join, so the console can show the column and disable approve when KYC is not VERIFIED.

**API-A7 — No global search API; topbar global search is unbuilt end-to-end**  
<sub>console · effort L · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §1 (line 14): topbar includes a 'global search' across the console (operators/players/orders).
- **Actual:** There is no /search controller or unified search service in the API, and the console shell has no global-search component wired. Only GET /players supports a username ?q= filter; operators and orders have no text search. The spec'd global search exists in neither layer.
- **Evidence:** `apps/api/src/players/players.service.ts:129` · `outline-docs/06-frontend-console.md:14`
- **Fix:** Add a scoped GET /search?q= that fans out (subtree operators by displayName/username, players by username, orders by id) and a topbar search box, or explicitly drop the feature from the spec.

**API-A8 — GET /operators list has no name/tier/status filter for the org-chart subtree search**  
<sub>api · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.2 (line 72): 'Search/filter within subtree by name/tier/status' on the organization screen.
- **Actual:** listOperatorsQuerySchema exposes only parentId, scope, cursor, limit — no q (name), tier, or status filter — and OperatorsService.list/listChildren implement no such filtering. Any org search must be client-side over already-loaded nodes, which breaks for large/lazy-loaded subtrees.
- **Evidence:** `packages/shared/src/schemas/operators.ts:48` · `apps/api/src/operators/operators.service.ts:337` · `outline-docs/06-frontend-console.md:72`
- **Fix:** Add q/tier/status to listOperatorsQuerySchema and apply them in the scoped list query (contains on displayName/username, tier enum, status enum).

**API-A9 — Report export supports CSV only (no PDF) and is synchronous (no R2 job), deviating from spec**  
<sub>reports · effort M · ✓ verified</sub>

- **Expected:** outline-docs/05 §9 (line 151): export enqueues CSV/PDF to R2 and returns a job id.
- **Actual:** exportReportSchema.format is z.enum(['csv']) only and exportCsv builds CSV inline; there is no PDF rendering and no R2-backed async job. (Separate from the A1 console mismatch — this is the missing PDF/async-job capability itself.)
- **Evidence:** `packages/shared/src/schemas/reports.ts:37` · `apps/api/src/reports/reports.service.ts:429` · `outline-docs/05-api-spec.md:151`
- **Fix:** If PDF/async export is required, add format 'pdf', enqueue a worker job that writes to R2, and return a jobId with a status/download endpoint. Otherwise narrow the spec to synchronous CSV to remove the discrepancy.

**API-A10 — GET /games catalog is not filtered by the player's branch allow-list**  
<sub>api · effort M · ✓ verified</sub>

- **Expected:** outline-docs/05 §6 (line 99): catalog is 'filtered by what the player's branch allows'.
- **Actual:** GamesService.listCatalog filters only by status=ACTIVE and optional supported currency; there is no per-branch/per-operator game enablement model or filter. Every active game is visible to every player regardless of branch.
- **Evidence:** `apps/api/src/games/games.service.ts:54` · `outline-docs/05-api-spec.md:99`
- **Fix:** If branch-level catalog gating is a requirement, add a branch/game allow-list (model + scoped filter); otherwise document that the catalog is platform-wide and remove the branch-filter wording from the spec.

**API-A11 — Announcement targeting supports branch path only, not per-tier targeting**  
<sub>console · effort S · ✓ verified</sub>

- **Expected:** docs/06 §3.13 (line 159): announcements can 'target by tier/branch'.
- **Actual:** createAnnouncementSchema supports audience (players/operators) + operatorScopePath (branch) + startsAt/endsAt (scheduling) but has no tier selector, so 'all distributors only' style tier targeting is not expressible.
- **Evidence:** `packages/shared/src/schemas/announcements.ts:8` · `outline-docs/06-frontend-console.md:159`
- **Fix:** Add an optional targetTiers (array of operator tiers) to createAnnouncementSchema and honor it in AnnouncementsService.create / list resolution.

**DBSCH-DB3 — Cents fields are Int while quantities are BigInt**  
<sub>db · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** A total derived from a BigInt quantity should not silently overflow a 32-bit integer.
- **Actual:** CreditOrder totalCents and unitPriceCents, Operator price fields and Settlement netCents are Int while quantityMinor is BigInt, so a very large mint overflows.
- **Evidence:** `packages/db/prisma/schema.prisma:294-298`
- **Fix:** Promote totalCents and netCents to BigInt or clamp the order quantity.

**VAL-C1 — Console frontend env read without zod validation, contradicting the stated convention**  
<sub>console · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Per CLAUDE.md ('zod everywhere a boundary is crossed (HTTP, sockets, jobs, env)') and the backend env.ts comment that 'Frontend (NEXT_PUBLIC_*) vars are validated in the apps', the console should validate its NEXT_PUBLIC_* config with a zod schema and fail fast on malformed values.
- **Actual:** apps/console/src/lib/env.ts simply reads process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000' with no zod schema and no URL validation; a misconfigured/non-URL value silently flows into every API call's base URL.
- **Evidence:** `apps/console/src/lib/env.ts:3-4` · `packages/shared/src/env.ts:5-7`
- **Fix:** Add a small zod schema (z.string().url()) for NEXT_PUBLIC_API_URL parsed once at module load, throwing a clear build/boot error on invalid config; mirror in the arcade app.

**RT-R5 — player.created and session.round events are never emitted**  
<sub>realtime · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/05 §11 lists player.created { playerId } to operator:{agentId} (multi-seat agents) and session.round { sessionId, nonce, winMinor } to player:{id} (multi-device sync of bet results).
- **Actual:** Neither event is emitted anywhere: players.service writes no outbox events, and games.service returns round results from the bet call without writing a session.round OutboxEvent. The console maps both events (socket.ts:29-30) but the server never sends them. These are secondary (the spec calls player.created "mostly for multi-seat agents" and session.round is also returned synchronously by the bet call), so impact is low.
- **Evidence:** `apps/api/src/games/games.service.ts:254` · `apps/console/src/lib/socket.ts:30` · `outline-docs/05-api-spec.md:237` · `outline-docs/05-api-spec.md:242`
- **Fix:** Emit player.created on player creation (rooms [operator:{agentId}]) and session.round on each settled bet (rooms [player:{id}]) as OutboxEvents inside the existing transactions, for multi-seat/multi-device sync.

**CMPL-CR12 — KYC verify cannot set verification level from the console**  
<sub>console · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** kycDecisionSchema accepts an optional level on VERIFIED so an operator can grant a higher KYC tier; docs reference KYC levels (L1–L3).
- **Actual:** The KYC queue verify action posts only { decision, reason } and never sends level, so verifying always keeps the submitted level — an operator cannot upgrade a player's KYC tier on approval despite the API supporting it.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/console/src/components/compliance/kyc-queue.tsx:31` · `/Users/willz/ai/Fire-Casino/packages/shared/src/schemas/compliance.ts:36`
- **Fix:** Add an optional level selector to the verify dialog and pass it through to /kyc/decision.

**CMPL-CR13 — KYC decision is a bare status flip with no screening evidence recorded**  
<sub>compliance · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Per hard rule #7 the KYC provider may be a stub, but a verified record should carry some screening result/provider reference for audit (the provider field exists).
- **Actual:** KycService.decision sets status VERIFIED/REJECTED and stamps verifiedAt/rejectedReason but performs no document analysis, sanctions/PEP screening, liveness, or DOB check, and stores no screening result object beyond the manual decision. This is consistent with the 'provider is a stub' rule, but there is no recorded screening evidence (or a stub screening result) to back a verification, which weakens the audit/compliance trail.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/kyc.service.ts:75` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/kyc.service.ts:43`
- **Fix:** Have the KYC provider stub return a structured screening result (read from config) and persist it on the record at submit/decision time, so VERIFIED carries evidence even while the real provider is stubbed.


### INFO

**CAS-CA14 — Compliance screen not gated by PLATFORM_MODE**  
<sub>compliance · effort S · ✓ verified</sub>

- **Expected:** docs/06 §2 + §3.11 label Compliance as a COMPLIANCE-mode surface.
- **Actual:** The Compliance nav item and page show whenever the principal has compliance.view, regardless of PLATFORM_MODE; isComplianceMode exists in lib/platform.ts but is not used for the nav/page gate. Likely intentional since compliance hooks run in both modes (hard rule #7), so flagged as info.
- **Evidence:** `apps/console/src/components/shell/nav-config.ts:40` · `apps/console/src/lib/platform.ts:12-15` · `apps/console/src/app/(app)/compliance/page.tsx:16-20`
- **Fix:** Either gate/badge the Compliance surface by COMPLIANCE mode per the spec, or update the spec to reflect that compliance is always available; decide explicitly.

**SHELL-S4 — Optimistic mutation updates are not implemented (reconcile-only)**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §4: mutations update the cache optimistically, then the socket event confirms; on mismatch, refetch wins.
- **Actual:** Mutations use invalidateQueries on success plus broad socket-driven invalidation (the 'refetch wins' half), but no mutation implements onMutate optimistic cache updates. Behavior is correct but momentarily shows stale data until refetch; the optimistic half of the spec is absent.
- **Evidence:** `apps/console/src/lib/socket.ts:21-38` · `apps/console/src/lib/query.tsx:22-26` · `apps/console/src/components/credits/order-row-actions.tsx:26-29`
- **Fix:** If snappier UX is desired, add onMutate optimistic updates for balance/queue mutations with rollback onError, keeping the existing socket/refetch reconciliation as the source of truth.

**API-A12 — Game-catalog admin API (POST/PATCH/status /games) has no console screen**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** A game.configure-gated management surface to create/update/hide catalog games (API is built, so a UI is implied).
- **Actual:** POST /games, PATCH /games/:id, POST /games/:id/status exist and are permission-gated, but the console has no /games route and no game references in its API client or nav (docs/06 §2 has no Games nav item). Catalog management is API-only with no operator UI; games are currently seeded via DB migrations (see project memory).
- **Evidence:** `apps/api/src/games/games.controller.ts:32` · `apps/api/src/games/games.controller.ts:42` · `apps/api/src/games/games.controller.ts:53` · `outline-docs/06-frontend-console.md:35`
- **Fix:** Either add a game-catalog admin screen to the console (list + create/edit/status, RTP-override gated) or confirm catalog stays migration-managed and mark these endpoints as internal/ops-only.

**DBSCH-DB2 — No referential actions on any relation**  
<sub>db · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Delete behavior should be explicit for financial and audited soft-delete relations where hard deletes must be prevented.
- **Actual:** Zero onDelete or onUpdate clauses in the schema; all relations use Prisma defaults, restrict for required and set null for optional. Undocumented.
- **Evidence:** `packages/db/prisma/schema.prisma:265-270`
- **Fix:** Add explicit restrict-on-delete to financial and audited relations.

**DBSEC-D12 — Migrations are forward-only and idempotent; Postgres 15+ dependency undocumented**  
<sub>db · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Migrations should be forward-only and safe to re-run; version dependencies should be documented.
- **Actual:** Enum additions use ADD VALUE IF NOT EXISTS and catalog/data migrations use ON CONFLICT DO NOTHING / guarded UPDATE, so re-runs are safe; there are no down-migrations (standard Prisma). The ledger-account unique index relies on NULLS NOT DISTINCT, which requires PostgreSQL 15+ — a deployment-version prerequisite that is only noted in an inline SQL comment, not in the deploy docs.
- **Evidence:** `packages/db/prisma/migrations/20260616210000_agent_credit_removal/migration.sql (ADD VALUE IF NOT EXISTS)` · `packages/db/prisma/migrations/20260616120000_seed_royal_ascendant_game/migration.sql (ON CONFLICT DO NOTHING)` · `packages/db/prisma/migrations/20260614053716_init/migration.sql:511-516 (NULLS NOT DISTINCT, PG15+)`
- **Fix:** Document the PostgreSQL >= 15 requirement in the deploy/README, and assert the server version at boot or in CI.

---

## 4. Findings — security & hardening (55)

### CRITICAL

**INFRA-S1 — Seeded superadmin live on hardcoded source-controlled password ChangeMe!Dev123**  
<sub>auth · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** No default/weak credentials in production. Admin bootstrap secrets must come from env and never be defaulted; seed credentials must be dev-only or force a rotation on first login.
- **Actual:** The seed creates a `superadmin` user (full SUPER_ADMIN, i.e. credit.mint / ledger.adjust / platform.settings) with password `process.env.SEED_PASSWORD ?? "ChangeMe!Dev123"`. The fallback is committed to source and is printed at the end of the seed. Per the project memory note (live-preview-and-seed) the production superadmin is still on this default. There is no first-login forced rotation and no NODE_ENV gate preventing the default in prod.
- **Evidence:** `packages/db/prisma/seed.ts:42` · `packages/db/prisma/seed.ts:157` · `packages/db/prisma/seed.ts:376`
- **Fix:** Rotate the production superadmin password and all .env.production secrets now. Make SEED_PASSWORD mandatory (throw if unset) and refuse to seed admin accounts when NODE_ENV=production unless an explicit one-time strong secret is provided; set a `mustChangePassword` flag forcing rotation on first login.

**INFRA-S2 — MFA not enforced server-side for admin tiers (login succeeds without MFA)**  
<sub>auth · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Tiers that require MFA (SUPER_ADMIN, ADMIN per tierRequiresMfa) must not be able to authenticate or perform privileged actions without a confirmed second factor — enforcement on the server, not the client.
- **Actual:** operatorLogin only verifies a TOTP when `user.mfaEnabled` is already true; an admin who never enrolled (mfaEnabled=false) logs in with password only and receives a full access token. `requiresMfaEnrollment = tierRequiresMfa(tier) && !mfaEnabled` is computed solely to return to the client; grep shows it is never read by any guard. AccessTokenGuard does not block or step-up requests for un-enrolled admins. This is the prior audit's 'MFA client-side only' finding, still open.
- **Evidence:** `apps/api/src/auth/auth.service.ts:91` · `apps/api/src/auth/auth.service.ts:445` · `apps/api/src/common/auth/access-token.guard.ts:75`
- **Fix:** Enforce server-side: if tierRequiresMfa(tier) && !mfaEnabled, refuse to issue a normal session (issue only an enrollment-scoped token usable solely for mfa/enable+confirm), and add a guard that rejects privileged routes when the principal's tier requires MFA but it is not enabled. Require TOTP at login for all MFA-required tiers.

**FE-S1 — Forced MFA enrollment is a client-side-only gate; the UI is the sole guard**  
<sub>auth · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** An admin tier that requires MFA (tierRequiresMfa) but has not enrolled must be unable to perform privileged actions until enrolled — enforcement at the server (deny privileged routes for unenrolled admins / issue only an enrollment-scoped session).
- **Actual:** AppShell renders <MfaGate/> purely on principal.requiresMfaEnrollment (a response boolean). The access token minted at login is already fully privileged. The API PermissionGuard checks only can(tier,settings,perm) and never mfaEnabled/enrollment; auth.service.ts only challenges TOTP if mfaEnabled is already true. Skipping the SPA and calling the API with the login token bypasses the gate entirely (credit.mint, ledger.adjust, platform.settings). Re-verified from the prior audit: STILL OPEN.
- **Evidence:** `apps/console/src/components/shell/app-shell.tsx:35-37` · `apps/api/src/auth/auth.service.ts:91` · `apps/api/src/auth/auth.service.ts:445` · `apps/api/src/common/auth/permission.guard.ts:28-40`
- **Fix:** Enforce server-side: when tierRequiresMfa(tier) && !mfaEnabled, mint only an enrollment-scoped session and have PermissionGuard (or AccessTokenGuard) deny @RequirePermission routes for unenrolled admins. Keep the console MfaGate as UX only.

**CMPL-CR1 — Geo/region enforcement is completely inert and fail-open**  
<sub>compliance · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.11 and the geo-rules UI state regions are 'enforced at login and redemption'; a BLOCK GeoRule must throw RegionBlockedError. The compliance gate is designed to resolve the request region (from IP) and pass it to checkLogin/checkDeposit/checkPlay/checkRedeem.
- **Actual:** No code anywhere resolves a region from the request IP (no geoip / cf-ipcountry / x-country lookup). Every gate caller omits region: wallet.service checkDeposit, games.service checkPlay (x2), redemptions.service checkRedeem (x2). checkLogin is never called at all (auth.service has only a 'wired in Phase 9' comment). assertRegionAllowed early-returns when region is undefined, so it is always undefined. Worse, even if a region were passed, applyRegionRule is invoked as a fire-and-forget `void this.applyRegionRule(region)` — the promise (and its RegionBlockedError) is never awaited, so a BLOCK rule would not block. The geo control is non-functional in every path while the UI asserts it is enforced.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.service.ts:178` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.service.ts:183` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.service.ts:94` · `/Users/willz/ai/Fire-Casino/apps/api/src/auth/auth.service.ts:139` · `/Users/willz/ai/Fire-Casino/apps/api/src/wallet/wallet.service.ts:64` · `/Users/willz/ai/Fire-Casino/apps/api/src/games/games.service.ts:137` · `/Users/willz/ai/Fire-Casino/apps/api/src/redemptions/redemptions.service.ts:84` · `/Users/willz/ai/Fire-Casino/apps/console/src/components/compliance/geo-rules.tsx:89`
- **Fix:** Resolve the client region at the HTTP boundary (CF-IPCountry header or a geoip lookup of req.ip), thread it into a GateContext passed to checkLogin/checkDeposit/checkPlay/checkRedeem, make assertRegionAllowed await applyRegionRule (drop the `void`), and wire checkLogin into player login. Gate behaviour on the GEO_ENFORCED setting (see CR6). Until then, the geo-rules UI must not claim enforcement.


### HIGH

**SHELL-S2 — MFA enrollment gate is client-only; API does not enforce requiresMfaEnrollment**  
<sub>auth · effort M · ✓ verified</sub>

- **Expected:** An MFA-required tier must be forced to enroll before performing privileged actions, enforced server-side (the shell's MfaGate is only a convenience).
- **Actual:** AppShell blocks the UI when principal.requiresMfaEnrollment is true, but the access-token guard's loadPrincipal never checks requiresMfaEnrollment / tierRequiresMfa, and login only demands a TOTP when mfaEnabled is already true. So an MFA-required operator who has not enrolled still receives a valid access token and can call privileged endpoints directly, bypassing the cosmetic client gate. Re-verification of the prior security audit's MFA-client-side-only critical — still open and the shell relies on it.
- **Evidence:** `apps/console/src/components/shell/app-shell.tsx:35-37` · `apps/api/src/common/auth/access-token.guard.ts:75-97` · `apps/api/src/auth/auth.service.ts:91-92` · `apps/api/src/auth/auth.service.ts:445`
- **Fix:** Enforce MFA server-side: either block token issuance/refresh for MFA-required-but-unenrolled operators except the enrollment endpoints, or add a guard that rejects all privileged routes with MFA_ENROLLMENT_REQUIRED until mfaEnabled is true; carry the flag on the principal.

**AUTHZ-S1 — AML flag list leaks whole tree when no subjectId**  
<sub>compliance · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** AND a subtree predicate by default (rule 4).
- **Actual:** Subtree filtered only when subjectId set; else returns every AML flag tree-wide. AmlFlag unscoped; compliance.manage grantable. Prior audit open.
- **Evidence:** `apps/api/src/compliance/aml.service.ts:44`
- **Fix:** Add ownerPath and AND subtree predicate in listFlags.

**INFRA-S3 — No server-side account lockout / brute-force protection**  
<sub>auth · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Per-account failed-login lockout or exponential backoff (e.g. lock after N failures) in addition to rate limits, resistant to IP rotation; protection also applied to the TOTP step.
- **Actual:** There are no lockout fields in the schema (no failedLoginAttempts/lockedUntil) and no counter logic in AuthService — failed logins are only written to the audit log. The only brute-force control is the per-IP login throttle of 10/min, which keys on `ip:<ip>` (throttler.config.ts:30-36) and is trivially bypassed by rotating source IPs, enabling credential stuffing and (combined with S2) password-only admin takeover.
- **Evidence:** `apps/api/src/auth/auth.service.ts:75` · `apps/api/src/common/throttler/throttler.config.ts:14` · `packages/db/prisma/schema.prisma:35`
- **Fix:** Add a Redis-backed per-identifier failure counter with progressive lockout (and a separate counter for the TOTP step), independent of IP. Record lockout events to the audit log and surface a generic error to avoid user enumeration.

**INFRA-S4 — No security-headers / helmet middleware**  
<sub>infra · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Standard hardening headers on every response (HSTS, X-Content-Type-Options, X-Frame-Options/frame-ancestors, Referrer-Policy, a CSP appropriate for an API, no X-Powered-By).
- **Actual:** bootstrap() configures only cookie-parser and CORS; there is no helmet (or @fastify/helmet) call and no header middleware anywhere. `helmet` is not a dependency (grep of apps/api/package.json returns none). Responses ship with Express defaults including X-Powered-By and no HSTS.
- **Evidence:** `apps/api/src/main.ts:21` · `apps/api/src/main.ts:23` · `apps/api/package.json:1`
- **Fix:** Add helmet with HSTS (in prod), noSniff, frameguard/deny, referrerPolicy, and disable x-powered-by; set an API-appropriate Content-Security-Policy. Apply via app.use in main.ts.

**INFRA-S5 — Global rate limiting not enabled — most endpoints are unthrottled**  
<sub>infra · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** A global per-IP/per-principal rate limit on all routes, with stricter overrides on auth and money routes (docs/01 §6).
- **Actual:** ThrottlerModule is configured with a default throttler (60/min) but ThrottlerGuard is NOT registered as an APP_GUARD — app.module providers list only SensitiveFieldsInterceptor, and auth.module registers only AccessTokenGuard/PermissionGuard/ScopeGuard globally. Throttling is applied only on controllers that explicitly add `@UseGuards(ThrottlerGuard)` (auth, orders, credits, wallet, redemptions, compliance). All other endpoints — operators/players lists, reports, settings, games catalog, audit, notifications, /me — have no rate limit, enabling scraping/enumeration and resource-exhaustion DoS.
- **Evidence:** `apps/api/src/app.module.ts:71` · `apps/api/src/auth/auth.module.ts:26` · `apps/api/src/common/throttler/throttler.config.ts:24`
- **Fix:** Register ThrottlerGuard as a global APP_GUARD so the default throttler covers all routes, keep the @Throttle(AUTH_RATE_LIMIT/MONEY_RATE_LIMIT) overrides, and add @SkipThrottle on health probes if needed.

**FE-S2 — Stored XSS: unvalidated documentUrl rendered into <a href> for privileged reviewers**  
<sub>compliance · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Any URL rendered into an href must be protocol-allowlisted (http/https only); input schemas must reject javascript:/data: schemes.
- **Actual:** kyc-queue.tsx renders <a href={k.documentUrl}> directly. kycSubmitSchema.documentUrl is z.string().url().max(500), and z.url() accepts javascript:/data: URLs (the WHATWG URL parser treats 'javascript:alert(1)' as valid). React 19 does not block javascript: hrefs in production (dev-only warning). Per the prior audit KYC submit is ungated, so a lower-privileged operator/player can plant a javascript: URL that executes in a compliance/super-admin reviewer's session on click — and there is no CSP to contain it (see S3).
- **Evidence:** `apps/console/src/components/compliance/kyc-queue.tsx:58-65` · `packages/shared/src/schemas/compliance.ts:31`
- **Fix:** Validate the protocol before rendering (allow only http/https; otherwise render plain text). Tighten the zod schema to reject non-http(s) schemes (e.g. refine on new URL(v).protocol). Add the KYC-submit permission gate noted in the prior audit.

**FE-S3 — No security headers / CSP / clickjacking protection on the privileged console**  
<sub>infra · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** A privileged back-office should set frame-ancestors 'none' / X-Frame-Options DENY, a strict CSP, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, and HSTS — via next.config headers() or vercel.json.
- **Actual:** next.config.ts sets only reactStrictMode/transpilePackages/eslint; vercel.json has no headers block; there is no middleware.ts. Grep-confirmed zero CSP/X-Frame-Options anywhere. The RBAC money console is therefore clickjackable (UI-redress a super-admin into mint/approve clicks) and has no CSP to contain any XSS (e.g. S2). Prior audit rated this MEDIUM combined console+arcade; re-verified STILL OPEN and elevated for the privileged console surface.
- **Evidence:** `apps/console/next.config.ts:1-15` · `apps/console/vercel.json:1-7`
- **Fix:** Add an async headers() (or vercel.json headers) for all routes: CSP with frame-ancestors 'none' + nonce/strict-dynamic, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, a restrictive Permissions-Policy, and HSTS.

**DBSEC-D1 — AuditLog and ledger immutability is convention-only — no DB-level append-only enforcement**  
<sub>db · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Hard rule #5 ('audit log is append-only; no deletes, no updates') and docs/03 §6/§14 + docs/02:522 ('Entries and transactions are never updated or deleted') demand immutable audit_logs, ledger_entries and ledger_transactions. For a compliance/legal posture this should be enforced at the database (BEFORE UPDATE/DELETE trigger raising an exception, and/or REVOKE UPDATE,DELETE from the runtime role), not just by app convention.
- **Actual:** audit_logs, ledger_entries, ledger_transactions are created as ordinary tables with full UPDATE/DELETE privileges for the app role; no trigger, rule, REVOKE or CHECK exists in any migration. AuditService exposes only record() and there is no update/delete code path today, but the un-extended prismaSystem client can update or delete any of these rows, so a single future careless call, a compromised process, or a bug silently rewrites the compliance/financial history with no DB-level stop.
- **Evidence:** `packages/db/prisma/schema.prisma:603-621` · `packages/db/prisma/schema.prisma:219-285` · `apps/api/src/audit/audit.service.ts:30-52` · `packages/db/prisma/migrations/20260614053716_init/migration.sql:191-203,404-418 (plain tables, no triggers/grants)`
- **Fix:** Add a forward migration installing BEFORE UPDATE OR DELETE triggers on audit_logs, ledger_entries and ledger_transactions that RAISE EXCEPTION, and/or run the runtime app under a role with REVOKE UPDATE, DELETE on those tables. Keep corrections as new ADJUSTMENT/REVERSAL rows (already the design).

**DBSEC-D2 — No DB constraint against negative balances or unbalanced transactions; invariants are app-only**  
<sub>db · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Hard rule #2: every transaction nets to zero per currency and only allow-listed system accounts may go negative. Best practice is a DB backstop: a partial CHECK (balanceMinor >= 0 for OPERATOR/PLAYER owners) and a deferred constraint trigger asserting SUM of signed entries per (transactionId, currency) = 0 at COMMIT.
- **Actual:** Zero-sum is enforced only by assertBalanced() in JS and non-negative only by the next<0n check in applyLegs(); there are no CHECK constraints or constraint triggers on ledger_accounts/ledger_entries. Any write that bypasses LedgerService (raw SQL, a future service, or a bug) can mint money or drive an owner balance negative and stay undetected until the next 5-minute reconciliation sweep — and reconciliation only logs a warning, it does not block.
- **Evidence:** `apps/api/src/ledger/ledger.service.ts:290-299` · `apps/api/src/ledger/ledger.service.ts:84-89 (assertBalanced app-side)` · `packages/db/prisma/schema.prisma:175-285 (no CHECK/constraints)` · `apps/api/src/reconciliation/reconciliation.processor.ts:28,72-82 (detect-only, every 5 min)`
- **Fix:** Add a partial CHECK constraint on ledger_accounts (balanceMinor >= 0 WHERE ownerType IN ('OPERATOR','PLAYER')) and a DEFERRABLE INITIALLY DEFERRED constraint trigger summing entries per transaction+currency to zero. Keep system-account negativity allow-listed via the trigger's exemption.

**DBSEC-D3 — credit_orders.totalCents computed with JS float / BigInt-to-Number, violating hard rule #1**  
<sub>api · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Hard rule #1: money is integer minor units in BigInt, never floats, never number. All money math via packages/shared/money.ts. Order totals feed settlement.netCents (real money owed off-platform) and must be exact.
- **Actual:** orders.service.ts:58 computes `Number(input.quantityMinor / MINOR) * unitPriceCents` — BigInt floor-division truncates fractional credits before pricing, then a Number cast plus float multiplication produces totalCents (Int), so fractional-credit quantities under-price and large quantities lose precision/overflow. redemptions.service.ts:467 similarly casts a money product to Number. The ledger itself is unaffected (it moves quantityMinor in BigInt), but inter-operator amounts owed are wrong.
- **Evidence:** `apps/api/src/orders/orders.service.ts:58` · `apps/api/src/orders/orders.service.ts:60-75 (stored into creditOrder.totalCents)` · `apps/api/src/redemptions/redemptions.service.ts:467` · `packages/db/prisma/schema.prisma:298-300 (totalCents/unitPriceCents Int)`
- **Fix:** Compute in BigInt: totalCentsMinor = (quantityMinor * BigInt(unitPriceCents)) / MINOR with an explicit rounding policy; validate the result is within Int range before any Number cast, or widen the column. Never do `Number(bigint) * n` on money.

**DBSEC-D4 — Operator subtree query (path LIKE 'prefix.%') is not index-served under default collation**  
<sub>db · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** The dimension requires an index for every scoped query; docs/02:607 calls the operator subtree (path LIKE) 'the single most common query in the system'. A plain btree on text only serves LIKE 'x%' when created with text_pattern_ops or under the C locale.
- **Actual:** operators_path_idx is a plain btree on path. The subtree filter in the scoped client and in services uses Prisma startsWith → SQL `path LIKE 'x.%'`, which a default-collation (e.g. en_US.UTF-8) btree cannot use, so every scoped list/aggregate/subtree read falls back to a sequential scan that degrades as the tree grows — both a scalability hit and a tenant-isolation hot path.
- **Evidence:** `packages/db/src/scoped-client.ts:35-37` · `apps/api/src/operators/operators.service.ts:179,341,395` · `packages/db/prisma/schema.prisma:113 (@@index([path]))` · `packages/db/prisma/migrations/20260614053716_init/migration.sql:488 (plain btree)`
- **Fix:** Add CREATE INDEX operators_path_pattern_idx ON operators (path text_pattern_ops) (or migrate path to ltree / a generated prefix column). Verify with EXPLAIN that subtree reads use the index.

**RT-R2 — No rate limiting on socket events; subscribe amplifies to unbounded DB lookups**  
<sub>realtime · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/01 §6 requires per-IP and per-principal rate limiting. The WebSocket message channel should be flood-protected so an authenticated client cannot drive unbounded server work; subscribe (which performs a DB query per descendant-operator room) must be throttled.
- **Actual:** The throttler is HTTP-only — getTracker reads req.ip / req.principal off the HTTP request and the ThrottlerGuard is never applied to the gateway. The subscribe handler accepts up to 50 rooms per message and calls system.operator.findUnique for every non-self operator room (mayJoin), with no cap on how many subscribe messages a socket may send. Any authenticated principal (including the lowest-tier operator) can loop subscribe with 50 arbitrary operator UUIDs and force ~50 DB lookups per message at an unbounded rate — a cheap amplification DoS against Postgres.
- **Evidence:** `apps/api/src/realtime/realtime.gateway.ts:107-128` · `apps/api/src/realtime/realtime.gateway.ts:164-176` · `apps/api/src/common/throttler/throttler.config.ts:30-37` · `outline-docs/01-system-architecture.md:132`
- **Fix:** Add a per-socket token-bucket (e.g. Redis-backed counter keyed on principal id) limiting subscribe/unsubscribe messages per minute and total joined rooms per connection; batch the descendant-operator authorization into a single `findMany({ where: { id: { in: ids } } })` + isInSubtree check instead of N findUnique calls; disconnect on sustained abuse.

**CMPL-CR3 — DEPOSIT responsible-gaming limit is silently bypassed (amount never passed)**  
<sub>compliance · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** checkDeposit enforces the player's DEPOSIT RG limit over its rolling period (assertRgLimit('DEPOSIT', amount)) per docs/03 §4.3 / hard rule #7.
- **Actual:** wallet.recharge calls `this.compliance.checkDeposit(player.id)` with no amountMinor. checkDeposit only runs assertRgLimit when opts.amountMinor is defined, so the DEPOSIT branch never executes. A player (or agent on their behalf) can recharge past a configured DEPOSIT limit unrestricted. WAGER/LOSS/SESSION_TIME limits work (betMinor is passed at placeBet), making this the lone broken RG dimension.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/api/src/wallet/wallet.service.ts:64` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.service.ts:52` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.service.ts:58`
- **Fix:** Pass `{ amountMinor: input.amountMinor, region }` to checkDeposit in wallet.recharge. Add a unit/integration test that a DEPOSIT limit blocks an over-limit recharge.

**CMPL-CR4 — Live game engines ignore req.rtpBps — RTP override is a no-op on all real games**  
<sub>compliance · effort L · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/05 §6: an operator with game.rtp_override can tune a game's RTP within bounds; the engine must honour the configured rtpBps. games.service enforces an 80–100% band and audits the change as a privileged action.
- **Actual:** Only PlaceholderRgsProvider reads req.rtpBps. All four production engines (phoenix, royal, dragon, wheel) call spin(rng) and pay bps(betMinor, totalWinBps) with the RTP baked into their math tables — req.rtpBps is never referenced. So games.service.updateGame checks the rtp_override permission, validates the 8000–10000 band, persists game.rtpBps and writes an audit row, but for every engine-backed (live) game the change has zero effect on payout. Operators get false assurance they are controlling house edge.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/api/src/games/engines/phoenix/phoenix.provider.ts:19` · `/Users/willz/ai/Fire-Casino/apps/api/src/games/engines/royal/royal.provider.ts:20` · `/Users/willz/ai/Fire-Casino/apps/api/src/games/engines/dragon/dragon.provider.ts:20` · `/Users/willz/ai/Fire-Casino/apps/api/src/games/engines/wheel/wheel.provider.ts:20` · `/Users/willz/ai/Fire-Casino/apps/api/src/games/rgs/placeholder.provider.ts:58` · `/Users/willz/ai/Fire-Casino/apps/api/src/games/games.service.ts:86`
- **Fix:** Either make engines scale outcomes to req.rtpBps (e.g. precompute paytables per target RTP, or blend a miss-rate to hit the target) so the override is real, or — if engine RTP is fixed by certified math — surface rtpBps as read-only for engine games and remove the misleading override affordance/band for them. Add a simulation test asserting realized RTP tracks the configured value.

**CMPL-CR6 — Settings enforcement toggles are inert; KYC threshold & default RTP changes never reach runtime**  
<sub>compliance · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/06 §3.14: platform settings include default RTP bounds and KYC/geo enforcement toggles; changing them changes posture. The settings page exposes 'Enforce KYC at redemption' and 'Enforce geo rules at login & redemption' toggles plus REDEMPTION_KYC_THRESHOLD_MINOR and DEFAULT_GAME_RTP_BPS.
- **Actual:** KYC_ENFORCED and GEO_ENFORCED are persisted to PlatformSetting and shown as toggles, but NO enforcement code reads them — geo never checks GEO_ENFORCED (and is dead anyway, CR1) and KYC enforcement keys only off the numeric threshold, never a boolean. Additionally, REDEMPTION_KYC_THRESHOLD_MINOR and DEFAULT_GAME_RTP_BPS are written to the PlatformSetting table, but ComplianceService.assertKycForAmount reads this.env (boot-time) and engines ignore RTP entirely (CR4) — so changing these via the console has no runtime effect. The settings surface is misleading.
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/console/src/app/(app)/settings/page.tsx:205` · `/Users/willz/ai/Fire-Casino/apps/api/src/settings/settings.service.ts:56` · `/Users/willz/ai/Fire-Casino/apps/api/src/settings/settings.service.ts:171` · `/Users/willz/ai/Fire-Casino/apps/api/src/compliance/compliance.service.ts:128`
- **Fix:** Load platform settings from PlatformSetting (with cache + invalidation) into a settings provider the compliance/games services consult at request time, and make assertKycForAmount/assertRegionAllowed honour KYC_ENFORCED/GEO_ENFORCED. Otherwise remove the toggles. Add tests that flipping a setting changes enforcement without a restart.


### MEDIUM

**SHELL-S1 — Platform mode is read from build-time env, not the live setting it claims to change**  
<sub>console · effort M · ✓ verified</sub>

- **Expected:** docs/06 §1: the mode badge 'reads PLATFORM_MODE' and mode drives nav + money framing (PLAY/PRIZE vs single CREDIT); §3.14 lets a super admin change PLATFORM_MODE via Settings with a hard confirm. The live, authoritative mode should govern the running UI.
- **Actual:** lib/platform.ts derives PLATFORM_MODE, isComplianceMode, OPERATOR/REDEEMABLE/WALLET currencies from process.env.NEXT_PUBLIC_PLATFORM_MODE, which is inlined at build time. The Settings screen reads data.PLATFORM_MODE from the API and PUTs changes, but those changes never propagate to the running console — the topbar ModeBadge, money framing and wallet currencies stay on the build-time value until a redeploy. /auth/me principal carries no platform mode. The compliance legal-posture framing can silently diverge from the configured mode.
- **Evidence:** `apps/console/src/lib/platform.ts:12-19` · `apps/console/src/components/shell/topbar.tsx:6,15` · `apps/console/src/app/(app)/settings/page.tsx:124-154`
- **Fix:** Source the live platform mode from the API (e.g. include it in /auth/me or a /settings/platform bootstrap) and provide it via context to the shell, money framing and nav; treat NEXT_PUBLIC_PLATFORM_MODE only as an initial fallback, or make the Settings toggle clearly deploy-time-only with a banner.

**AUTHZ-F2 — Two-layer subtree backstop missing in players/operators/credits services**  
<sub>rbac · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** In-service isInSubtree plus ScopeGuard (rule 4).
- **Actual:** players.service get/history/update/suspend/resetPassword, operators.service get/getTree/update/setStatus/close/balances/stats/ledger and credits.issue act by-id via the un-scoped system client+findUnique (extension skips findUnique), no isInSubtree; only the ScopeGuard guards them, so a dropped ScopeCheck = cross-subtree IDOR. Prior audit open.
- **Evidence:** `apps/api/src/players/players.service.ts:146` · `apps/api/src/operators/operators.service.ts:191` · `apps/api/src/operators/credits.service.ts:45`
- **Fix:** Add assertPlayerInSubtree/assertOperatorInSubtree to all by-id methods.

**VAL-S1 — No security-headers middleware (helmet) on the API**  
<sub>api · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** API responses should carry hardening headers (HSTS, X-Content-Type-Options: nosniff, X-Frame-Options/frame-ancestors, Referrer-Policy, and a minimal CSP) via helmet, per defense-in-depth on a public Railway-hosted boundary.
- **Actual:** main.ts wires only cookie-parser and CORS; no helmet (or equivalent) is installed and helmet is not a dependency in apps/api/package.json. Responses ship with Express defaults (X-Powered-By present, no HSTS, no nosniff). Risk is reduced because the API serves JSON only, but the headers are still absent.
- **Evidence:** `apps/api/src/main.ts:21-26` · `apps/api/package.json (no helmet dependency)`
- **Fix:** Add helmet (app.use(helmet())) in main.ts, disable X-Powered-By (app.disable('x-powered-by')), and set HSTS when COOKIE_SECURE/prod. Keep CSP minimal since the API is JSON-only.

**VAL-S2 — File-upload presign validates only filename, not MIME type or size; proof docs land in the assets bucket**  
<sub>compliance · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Presign requests for KYC documents and credit/redemption payment proofs should validate content type (allowed MIME whitelist) and a max size, and the presigned URL should carry Content-Type/Content-Length conditions so the eventual R2 upload is constrained. Financial/identity documents should target a private bucket.
- **Actual:** presignKycDocSchema and presignProofSchema only constrain filename (z.string().min(1).max(N)); there is no contentType or maxSize field. StorageService.presignUpload (a stub) returns an unconstrained upload URL keyed by a sanitized filename, so when a real R2 presigner is wired there is no MIME/size enforcement (arbitrary type, unbounded size = cost/DoS and content-type confusion). Credit-order and redemption proofs are written to the assets bucket (R2_BUCKET_ASSETS) rather than the private kyc bucket; if that bucket is public-read (game assets are served from public R2), financial proof images become world-readable by URL (UUID-prefixed key mitigates enumeration but not exposure).
- **Evidence:** `packages/shared/src/schemas/compliance.ts:49-51` · `packages/shared/src/schemas/orders.ts:34-36` · `apps/api/src/storage/storage.service.ts:22-31` · `apps/api/src/orders/orders.service.ts:231-232` · `apps/api/src/redemptions/redemptions.service.ts:373-374`
- **Fix:** Add contentType (MIME whitelist e.g. image/jpeg,image/png,application/pdf) and a max byte size to both presign schemas; pass them into presignUpload so the real R2 presigned PUT includes Content-Type and content-length-range conditions. Route payment-proof uploads to a private bucket (or confirm the assets bucket is private) and serve them only via short-lived signed GET URLs.

**INFRA-S6 — No production-mode env hardening — cookies/CORS fail open to insecure defaults**  
<sub>infra · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** When NODE_ENV=production the boot-time env validation should require secure transport/session config (COOKIE_SECURE=true, a real COOKIE_DOMAIN/SAMESITE, non-localhost ALLOWED_ORIGINS) and reject obviously weak/default JWT secrets, failing fast.
- **Actual:** envSchema defaults COOKIE_SECURE=false, COOKIE_SAMESITE=lax, COOKIE_DOMAIN=localhost, and ALLOWED_ORIGINS to localhost. There is no superRefine/refine tying these to NODE_ENV, so a prod deploy that forgets to set them silently issues non-Secure cookies and trusts localhost origins. JWT secrets are only length-checked (min 16); the example/default value is not rejected.
- **Evidence:** `packages/shared/src/env.ts:31` · `packages/shared/src/env.ts:47` · `packages/shared/src/env.ts:26`
- **Fix:** Add a superRefine: when NODE_ENV==='production' require COOKIE_SECURE=true, a non-localhost COOKIE_DOMAIN/ALLOWED_ORIGINS, COOKIE_SAMESITE in {none,strict}, and reject known-default JWT secrets. Fail boot if violated.

**INFRA-S7 — TOTP/MFA secret stored in plaintext despite schema comment claiming encryption**  
<sub>auth · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** MFA shared secrets should be encrypted at rest (envelope/app-level encryption) so a DB read alone cannot mint valid TOTP codes — as the schema comment asserts.
- **Actual:** schema.prisma:36 documents `mfaSecret String? // TOTP, encrypted at rest`, but mfaEnable writes the raw generated secret directly (`data: { mfaSecret: secret }`) and login/confirm read it back verbatim for authenticator.check. No encryption layer exists; the comment is misleading. A DB compromise yields all admin second factors.
- **Evidence:** `apps/api/src/auth/auth.service.ts:295` · `apps/api/src/auth/auth.service.ts:93` · `packages/db/prisma/schema.prisma:36`
- **Fix:** Encrypt mfaSecret with an app-managed key (e.g. AES-256-GCM via a KMS/env key) on write and decrypt on verify, or store it in a dedicated secrets store. Update or honor the schema comment.

**DBSEC-D5 — Missing createdAt indexes for cursor-paginated lists (credit_orders, aml_flags)**  
<sub>db · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Every cursor-paginated list ordered by createdAt should hit a composite index covering the filter + sort key (dimension explicitly: 'createdAt cursors').
- **Actual:** credit_orders is listed with orderBy createdAt desc + id cursor but is indexed only on buyerOperatorId, sellerOperatorId and status — so the operator-filtered list returns rows then sorts them in memory (seq-scan/sort risk at volume). aml_flags is indexed on (subjectType,subjectId) and (status,severity) but typical AML queues sort by createdAt with no createdAt index.
- **Evidence:** `apps/api/src/orders/orders.service.ts:94-98` · `packages/db/prisma/schema.prisma:311-313 (no createdAt index)` · `packages/db/prisma/schema.prisma:581-582 (aml_flags indexes)`
- **Fix:** Add composite indexes credit_orders(buyerOperatorId, createdAt) and (sellerOperatorId, createdAt), and aml_flags(status, createdAt) (or (createdAt)). Match each list's WHERE+ORDER BY.

**DBSEC-D6 — Scoped Prisma extension filters READS only; writes and most tenant models rely on service checks**  
<sub>db · effort L · ○ unverified (cut off by session limit)</sub>

- **Expected:** Hard rule #4: subtree isolation enforced at the query layer. Defense-in-depth implies the scoped client should also constrain write operations (update/updateMany/delete/deleteMany/upsert) and cover all tenant-scoped models, so a handler that forgets the ScopeGuard still cannot cross branches.
- **Actual:** createScopedPrisma injects a filter only for findFirst/findFirstOrThrow/findMany/count/aggregate/groupBy on exactly five models (operator, player, ledgerAccount, gameSession, redemptionRequest). All write ops are unscoped (documented at scoped-client.ts:80-82), and creditOrder, kycRecord, amlFlag, gameRound, refreshToken, notification, settlement and auditLog reads are unscoped entirely — their cross-tenant safety depends wholly on the controller ScopeGuard plus correct service where-clauses. No scoped-model updateMany/deleteMany currently runs through the scoped client (so no active leak), but the trusted surface is large and one careless scoped-client updateMany/deleteMany would cross subtrees with no DB-level stop.
- **Evidence:** `packages/db/src/scoped-client.ts:19-28,80-93` · `packages/db/src/scoped-client.ts:28 (ScopedModel set of 5)` · `apps/api/src/audit/audit.controller.ts:59-79 (auditLog read on system client, manual actorId filter)`
- **Fix:** Extend the extension to inject the same subtree path filter into update/updateMany/delete/deleteMany where-clauses on scoped models, and add the remaining tenant-scoped models to the scoped set; keep system writes on prismaSystem explicitly.

**DBSEC-D7 — Single high-privilege DB credential, no enforced TLS or least-privilege runtime role**  
<sub>infra · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Production DB access should use a least-privilege runtime role (DML only, no DDL/DROP/TRUNCATE, and — paired with D1 — no UPDATE/DELETE on audit/ledger tables) separate from the migration role, over an enforced TLS connection (sslmode=require).
- **Actual:** One DATABASE_URL drives prismaSystem for both runtime queries and `prisma migrate deploy`, so the runtime app role can run arbitrary DDL. env.ts validates DATABASE_URL only as `z.string().url()` and never asserts sslmode=require; no sslmode/ssl/rejectUnauthorized appears anywhere in the codebase, so a misconfigured host can connect in plaintext.
- **Evidence:** `packages/shared/src/env.ts:22` · `packages/db/src/index.ts:11 (single PrismaClient on DATABASE_URL)` · `apps/api/src/prisma/prisma.module.ts:36-44 (same client for system + scoped)`
- **Fix:** Refine the env schema to require sslmode=require in production (or append it), and provision a least-priv runtime DB role distinct from the migrations role. Document both in the deploy config.

**DBSEC-D8 — Seed ships a weak default password and echoes it; no forced rotation (prior audit, still open)**  
<sub>auth · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Seed must not provision privileged accounts with a guessable shared password, and superadmin should be forced to rotate on first login (prior security-fairness audit critical #1).
- **Actual:** seed.ts:42 defaults SEED_PASSWORD to 'ChangeMe!Dev123', applies it to superadmin and all demo principals, and prints it to the log at seed.ts:376. No real secret is committed (it is a configurable default, so 'no secrets in schema/seed' is technically met), but any environment seeded without SEED_PASSWORD set — and per project memory the production superadmin — runs on this known credential with no first-login rotation, an account-takeover path. Re-verified: still present and unchanged in seed.
- **Evidence:** `packages/db/prisma/seed.ts:42` · `packages/db/prisma/seed.ts:108,142 (applied to superadmin + players)` · `packages/db/prisma/seed.ts:373-377 (printed)`
- **Fix:** Require SEED_PASSWORD (throw when unset outside development), drop the literal default, and force a password change on first superadmin login. Rotate the live superadmin credential now.

**RT-R3 — Socket principal loaded once at connect — token expiry and account revocation not enforced for the connection lifetime**  
<sub>realtime · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** A long-lived socket should not outlive the authorization it was opened with: an expired access token, a logged-out/rotated session, or a deactivated/suspended/self-excluded principal should stop receiving live events. REST re-validates on every call within the 15m TTL; the socket path should provide equivalent freshness.
- **Actual:** handleConnection loads the principal exactly once and never re-checks it. The 15m JWT TTL (JWT_ACCESS_TTL) is verified only at handshake; once connected, the socket persists indefinitely (console uses reconnection:Infinity, reconnectionAttempts:Infinity) and is never re-authenticated. loadPrincipal also performs no session-revocation check (sessionId is read from the token but never compared against a live Session/refresh family — same as REST), so a logged-out or deactivated operator/player keeps receiving balance.changed, redemption.updated, aml.flagged, etc. on their open socket until they happen to disconnect.
- **Evidence:** `apps/api/src/realtime/realtime.gateway.ts:88-105` · `apps/api/src/realtime/realtime.service.ts:50-94` · `apps/api/src/auth/token.service.ts:41-43` · `apps/console/src/lib/socket.ts:67-70`
- **Fix:** Add a Socket.io middleware/interval that re-verifies the token expiry and re-loads the principal (or checks a Redis revocation set keyed by sessionId) periodically and on each reconnect, disconnecting on expiry/revocation/status change; and introduce server-side session-revocation tracking shared by REST and sockets.

**CMPL-CR8 — Provably-fair has no published paytable/verifier — only the raw RNG draw is checkable**  
<sub>compliance · effort L · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/05 §10 / docs/07 §2.3: a player can recompute every round from the revealed serverSeed and verify nothing changed — i.e. verify the OUTCOME, not just the random draw.
- **Actual:** The commit/reveal and HMAC stream are correctly implemented and the FairnessDrawer shows serverSeedHash/clientSeed/nonce and reveals the seed. But for the real engines the win mapping (reel strips, symbol weights, paytables, free-spin math) lives server-side and is not published, and there is no verifier tool or documented algorithm. A player can reproduce the uniform stream but cannot independently confirm that the stream maps to the payout they received, so 'provably fair' is only partially substantiated (the placeholder embeds r/multBps in its outcome; the engines do not expose enough to verify).
- **Evidence:** `/Users/willz/ai/Fire-Casino/apps/api/src/games/rgs/fairness.ts:37` · `/Users/willz/ai/Fire-Casino/apps/arcade/src/components/game/FairnessDrawer.tsx:41` · `/Users/willz/ai/Fire-Casino/apps/api/src/games/engines/phoenix/math.ts:11`
- **Fix:** Publish each engine's paytable/weights (or a versioned config hash committed alongside serverSeedHash) and ship a client-side or documented verifier that recomputes the outcome from (serverSeed, clientSeed, nonce, config). Link it from the FairnessDrawer.


### LOW

**CPR-S1 — Order proofUrl accepts arbitrary external URLs**  
<sub>api · effort S · ✓ verified</sub>

- **Expected:** Payment-proof references should be constrained to uploaded R2 assets so a stored proof link can be safely rendered.
- **Actual:** createOrderSchema/markOrderPaidSchema accept any url() and the service stores it verbatim. The frontend always uses the presign flow, but the API does not enforce that proofUrl points at the platform asset bucket — an operator could submit an arbitrary external URL that later gets rendered/linked as 'proof' (phishing / SSRF-if-previewed risk once C2 is built).
- **Evidence:** `packages/shared/src/schemas/orders.ts:5-19` · `apps/api/src/orders/orders.service.ts:71` · `apps/api/src/orders/orders.service.ts:129-130`
- **Fix:** Validate proofUrl against the configured R2 asset origin/key prefix (or accept a storage key and resolve server-side), and use signed-URL previews rather than rendering raw user-supplied URLs.

**RRL-S1 — On-demand reconciliation runs full-ledger window-function scans with no dedicated rate limit**  
<sub>reports · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Expensive integrity sweeps should be backpressure-aware / queued and not directly invocable in an unbounded loop (CLAUDE scalability rules).
- **Actual:** POST /reports/ledger-health/run executes reconciliation.runAll() synchronously — including snapshotContinuity's UNBOUNDED-PRECEDING window over the entire ledger_entries table and cacheVsDerived's full group-by — on each click, gated only by report.ledger_health (admin/ADMIN) and the global throttler. On a large ledger, repeated clicks are a self-inflicted DoS / DB pressure vector.
- **Evidence:** `apps/api/src/reports/reports.controller.ts:100-106` · `apps/api/src/reconciliation/reconciliation.service.ts:196-218` · `apps/api/src/reconciliation/reconciliation.service.ts:175-193`
- **Fix:** Route the manual run through the BullMQ queue (dedupe by jobId) and/or add a short per-actor cooldown; return the cached RECON_LAST_KEY result between runs.

**RRL-S2 — Settlement report items are not explicitly re-scoped to the caller's subtree**  
<sub>reports · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** CLAUDE hard rule #4 / docs/04: every operator query is scoped to the caller's subtree; never return rows referencing nodes outside it.
- **Actual:** settlement() queries Settlement with OR:[{operatorId in subtreeIds},{counterpartyId in subtreeIds}] and returns ALL matched rows as `items`. The receivable/payable TOTALS guard with idSet.has(r.operatorId), but the returned `items` list is not re-filtered — a counterparty-matched row can reference an operatorId outside the caller's subtree. In current data shapes this is unlikely to leak (descendant counterparties' sellers are in-subtree; player counterparties aren't in idSet), but the items list relies on data shape rather than an explicit subtree filter. report.view is ALL_TIERS, so any tier can call GET /reports/settlement.
- **Evidence:** `apps/api/src/reports/reports.service.ts:393-425` · `packages/shared/src/permissions.ts:143`
- **Fix:** Filter returned items to rows where operatorId ∈ subtreeIds (mirror the totals guard), or build the query so both ends are constrained to the subtree.

**CAS-CA13 — KYC submit accepts an arbitrary player-supplied documentUrl not constrained to the R2 bucket**  
<sub>compliance · effort S · ✓ verified</sub>

- **Expected:** KYC document references should be confined to the platform's private KYC storage to ensure integrity of reviewed evidence.
- **Actual:** kycSubmitSchema accepts documentUrl as any z.string().url(); the value is stored verbatim and surfaced to reviewers as a link. A player could store an external/arbitrary URL as their 'KYC document'. The admin link uses rel='noopener noreferrer' so tab-nabbing is mitigated, but evidence integrity is not enforced.
- **Evidence:** `packages/shared/src/schemas/compliance.ts:31-35` · `apps/api/src/compliance/kyc.service.ts:43-62` · `apps/console/src/components/compliance/kyc-queue.tsx:57-65`
- **Fix:** Drive submission through the presign flow only — accept an R2 object key (or validate the URL host/prefix matches the KYC bucket) rather than an arbitrary URL.

**VAL-S3 — Idempotency-Key header is presence-checked but not length/format bounded**  
<sub>api · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** The Idempotency-Key header (required on every money mutation) should be bounded in length and ideally character-set, since it is persisted and used as a uniqueness key.
- **Actual:** IdempotencyKey decorator only verifies the header is present and non-empty, then trims and returns it; an attacker can submit an arbitrarily long value that flows into the namespaced key the service stores.
- **Evidence:** `apps/api/src/common/auth/idempotency.decorator.ts:8-16`
- **Fix:** Validate the key with a small zod schema (e.g. min 8, max 200, restricted charset) in the decorator and reject anything outside it with VALIDATION_ERROR.

**VAL-S4 — Latent cookie-based access-token auth fallback with no CSRF defense**  
<sub>auth · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Mutating endpoints should authenticate only via a mechanism not auto-attached by the browser (Bearer header), or carry CSRF protection if cookie-borne credentials are accepted.
- **Actual:** AccessTokenGuard.extractToken falls back to req.cookies?.fc_access when no Authorization header is present, but no code ever sets an fc_access cookie (only fc_refresh is issued). The fallback is currently inert/dead code, but if a future change starts issuing fc_access as a cookie, all money mutations would become CSRF-able (no CSRF token; COOKIE_SAMESITE can be 'none' in the cross-site Vercel/Railway prod setup).
- **Evidence:** `apps/api/src/common/auth/access-token.guard.ts:67-73` · `apps/api/src/auth/cookies.ts:4` · `apps/api/src/auth/auth.controller.ts:48`
- **Fix:** Remove the fc_access cookie fallback (rely on Bearer only), or if cookie access tokens are intended, add CSRF protection (double-submit token or require a custom header) before enabling them.

**VAL-S5 — JWT signing-secret minimum length too low for HS256**  
<sub>auth · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** HS256 signing secrets should be at least 256 bits (32 bytes) of entropy; the env schema should enforce a floor that reflects that.
- **Actual:** envSchema sets JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to z.string().min(16); a 16-character ASCII secret is ~128 bits, below the recommended 256-bit floor for HMAC signing keys.
- **Evidence:** `packages/shared/src/env.ts:26-27`
- **Fix:** Raise the minimum to .min(32) (or validate base64/hex 32-byte input) and document generating secrets with a CSPRNG.

**INFRA-S8 — mfa/confirm endpoint has no rate limit (TOTP guessing)**  
<sub>auth · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Endpoints that verify a TOTP code should be throttled/locked to prevent brute-forcing the 6-digit space.
- **Actual:** operator/mfa/confirm (and password/change) carry no @UseGuards(ThrottlerGuard)/@Throttle, and ThrottlerGuard is not global (see S5), so an authenticated operator session can submit unlimited TOTP guesses against authenticator.check during enrollment confirmation.
- **Evidence:** `apps/api/src/auth/auth.controller.ts:111` · `apps/api/src/auth/auth.controller.ts:95`
- **Fix:** Add a strict @Throttle to mfa/confirm (and password/change), or rely on the global guard from S5, plus a small per-user attempt counter on the TOTP check.

**FE-S4 — Cookie-auth routes CSRF-reachable under SameSite=None (no CSRF token / Origin allowlist)**  
<sub>auth · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Cookie-bearing state-changing routes should carry a CSRF defense (double-submit token or Origin/Referer allowlist) when SameSite=None is required for cross-site deployment.
- **Actual:** fc_refresh is httpOnly + path /api/v1/auth; in the cross-site prod deployment COOKIE_SAMESITE=none, so POST /auth/refresh and /auth/logout send the cookie cross-site with no CSRF token or Origin check. Impact is limited: forced logout is an annoyance, forced refresh rotates the victim's token but the new access token is CORS-protected and unreadable by the attacker; main app mutations are Bearer-protected (token is not a cookie) so they are CSRF-safe. Prior audit LOW — re-verified open.
- **Evidence:** `apps/api/src/auth/cookies.ts:15-27` · `apps/api/src/auth/auth.controller.ts:70-92` · `packages/shared/src/env.ts:39`
- **Fix:** Add an Origin/Referer allowlist (or double-submit CSRF token) to /auth/refresh and /auth/logout; keep SameSite=Lax when API and frontends can share a registrable domain.

**FE-S5 — Client-side presign upload has no MIME/size/extension validation**  
<sub>console · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** File uploads should be gated by an allowlist of content-types, a max size, and an extension check on the client, with the authoritative constraint enforced by the server presigner (forced content-type + key + size).
- **Actual:** uploadViaPresign PUTs any file to the presigned URL using file.type || 'application/octet-stream' with no client-side size cap, MIME allowlist, or extension check. If the server presigner does not pin content-type/size and R2 serves user content with an attacker-chosen type, an uploaded text/html 'proof'/'document' becomes stored XSS/drive-by when later opened (ties to S2).
- **Evidence:** `apps/console/src/lib/upload.ts:9-18`
- **Fix:** Validate type/size/extension client-side before requesting a presign; ensure the server presigner forces content-type and a max object size and serves with Content-Disposition: attachment.

**FE-S6 — Public, unauthenticated dev styleguide route shipped in the app**  
<sub>console · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Dev-only routes should not be reachable in production builds.
- **Actual:** app/dev/styleguide/page.tsx sits outside the (app) route group, so it is not wrapped by AppShell and requires no auth. It renders only demo UI with mock data (no live data/actions), so the leak is limited to revealing the component/design inventory.
- **Evidence:** `apps/console/src/app/dev/styleguide/page.tsx`
- **Fix:** Exclude the dev route from production (env guard / notFound() in prod, or move it to a Storybook outside the deployed app).

**FE-S7 — No error boundaries (error.tsx/global-error.tsx) — ungraceful crash handling**  
<sub>console · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** App-Router error boundaries (error.tsx + global-error.tsx) for graceful, non-leaking failure handling.
- **Actual:** No error.tsx, global-error.tsx, or not-found.tsx anywhere under app/. A render/runtime error white-screens the route with the default Next handler. In production this shows a generic message (no stack/PII leak — the 'does not leak' requirement holds), but there is no controlled messaging or recovery.
- **Evidence:** `apps/console/src/app/(app)/layout.tsx:1-7` · `apps/console/src/app/layout.tsx:18-27`
- **Fix:** Add app/(app)/error.tsx and app/global-error.tsx that render the design-system error state and a reset action; never render error.message/stack to users.

**FE-S8 — Build-time ESLint disabled (ignoreDuringBuilds)**  
<sub>infra · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Security-relevant lint rules should gate the deployable build, or the separate CI lint check must be a required status check.
- **Actual:** next.config.ts sets eslint.ignoreDuringBuilds: true, so lint regressions can deploy on Vercel if the external CI lint gate is not enforced as required. Prior audit LOW — re-verified open.
- **Evidence:** `apps/console/next.config.ts:9-12`
- **Fix:** Make the turbo lint check a required status check on the Vercel/GitHub deploy, or re-enable build-time lint.

**DBSEC-D9 — onDelete SET NULL on ledger account owners orphans funded accounts; missing FKs on some references**  
<sub>db · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Money-bearing rows should never be silently detached from their owner; reference columns should carry FKs so the DB can guarantee referential integrity. Owner FKs should be RESTRICT like the rest of the schema.
- **Actual:** ledger_accounts.operatorId and playerId use ON DELETE SET NULL, so a hard-deleted operator/player leaves a balance-bearing, ownerless ledger account (breaks circulation-identity attribution; the app soft-deletes via status, so risk is latent). RefreshToken.playerId and GameRound.betTxId/winTxId have no FK constraint at all.
- **Evidence:** `packages/db/prisma/migrations/20260614053716_init/migration.sql:636-639 (SET NULL)` · `packages/db/prisma/schema.prisma:54-73 (RefreshToken: userId FK only, playerId bare)` · `packages/db/prisma/schema.prisma:404-419 (GameRound.betTxId/winTxId bare strings)`
- **Fix:** Change ledger_accounts owner FKs to ON DELETE RESTRICT; add FKs for refresh_tokens.playerId and game_rounds.betTxId/winTxId (or document the intentional omission).

**DBSEC-D10 — Cursor pagination orders by non-unique createdAt with an id cursor — unstable pages**  
<sub>db · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Cursor pagination should order by a unique/total ordering (e.g. createdAt, id) so rows are never skipped or duplicated across pages — important for audit/report integrity.
- **Actual:** Several lists order by createdAt only while using id as the cursor (Prisma cursor+skip); rows sharing a createdAt timestamp can be dropped or repeated across page boundaries.
- **Evidence:** `apps/api/src/audit/audit.controller.ts:60-63` · `apps/api/src/orders/orders.service.ts:96-98` · `apps/api/src/operators/operators.service.ts:315-317`
- **Fix:** Order by [createdAt desc, id desc] and place the cursor on both columns; ensure a supporting composite index exists.

**DBSEC-D11 — Int overflow risk on LedgerAccount.version and *Cents fiat fields**  
<sub>db · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Counters and money-derived fields that grow unbounded should use BigInt to avoid int4 overflow halting writes.
- **Actual:** LedgerAccount.version is Int and is incremented once per posting per account; the busiest system accounts (MINT/REVENUE) could reach int4 max (2,147,483,647) over the platform's lifetime, after which every posting on that account fails with 'integer out of range' — a latent ledger stall. credit_orders.totalCents/unitPriceCents and settlements.netCents are Int (cap ~$21.4M) and can overflow on large orders/settlements.
- **Evidence:** `packages/db/prisma/schema.prisma:185 (version Int)` · `apps/api/src/ledger/ledger.service.ts:320-325 (per-posting increment)` · `packages/db/prisma/schema.prisma:298-300,331 (totalCents/unitPriceCents/netCents Int)`
- **Fix:** Widen version to BigInt; widen the cents fields to BigInt (or validate ranges at the boundary).

**RT-R6 — Outbox observability and retention gaps: no SENT cleanup, no lag metric, FAILED rows parked silently**  
<sub>realtime · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** docs/01 §11 calls for tracking outbox lag and failed money/realtime events; an at-least-once relay needs bounded table growth and visibility into stuck/failed deliveries.
- **Actual:** outbox_events rows are never deleted or archived after being marked SENT, so the table grows unbounded with every balance/redemption/recharge event. FAILED events (after 5 attempts) are parked with no DLQ, alert, or metric, and there is no outbox-lag/depth metric exposed. Redis pub/sub is non-persistent, so if a web node's relay subscriber is momentarily disconnected when the relay publishes, that message is lost for its clients while the row is still marked SENT — mitigated only by client reconnect-refetch (spec-accepted), but invisible without metrics.
- **Evidence:** `apps/api/src/realtime/outbox-relay.service.ts:111-128` · `apps/api/src/realtime/outbox-relay.service.ts:135-143` · `packages/db/prisma/schema.prisma:627-639` · `outline-docs/01-system-architecture.md:232`
- **Fix:** Add a periodic prune of SENT rows older than a retention window; expose outbox PENDING-depth/oldest-PENDING-age and FAILED-count metrics; alert/DLQ on FAILED so stuck deliveries are visible.

**RT-R7 — Gateway CORS origins resolved at import time before env load; dead in-process emit() path**  
<sub>realtime · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Socket CORS should be locked to the configured ALLOWED_ORIGINS (docs/01 §10/§5 'Sockets same'), and the realtime delivery path should be single and well-defined.
- **Actual:** The @WebSocketGateway decorator calls corsOrigins() at module-import time, which reads process.env.ALLOWED_ORIGINS before main.ts runs loadDotenv() in bootstrap(); the comment claiming dotenv is loaded first is incorrect for .env-based dev, where it silently falls back to localhost defaults. In production env vars come from the platform so it fails closed (blocks, not opens) — low impact, but fragile. Separately, gateway.emit() (the non-.local cluster emit) has no callers: all delivery flows through the outbox relay → Redis → per-node .local emit, so emit() is dead code that, if ever wired alongside the relay, would double-deliver.
- **Evidence:** `apps/api/src/realtime/realtime.gateway.ts:31-38` · `apps/api/src/realtime/realtime.gateway.ts:53` · `apps/api/src/realtime/realtime.gateway.ts:146-149` · `apps/api/src/main.ts:11-14`
- **Fix:** Resolve socket CORS at runtime from validated env (e.g. via the IoAdapter's createIOServer options using env.ALLOWED_ORIGINS) rather than a decorator-time process.env read; remove the unused gateway.emit() or document it as relay-only.


### INFO

**SHELL-S3 — Credit-moving order 'Issue' action omits the client idempotency key**  
<sub>console · effort S · ✓ verified (severity adjusted)</sub>

- **Expected:** docs/06 §4 and hard rule #3: every mutating/credit-moving action generates a UUID idempotency key on form open and sends it (Idempotency-Key header), reused on retry, with IDEMPOTENT_REPLAY treated as success.
- **Actual:** OrderRowActions.issue posts /orders/:id/issue — which posts the ledger transfer that releases credits — without an idempotencyKey, unlike every other money dialog (transfer/recharge/remove/issue/approve/settle all pass one). Risk is low only because the API self-protects via a status guard (PAID→ISSUED, returns early if already ISSUED) and a deterministic ledger key 'order:${id}:issue'; but the client convention is violated and a generic replay would not be surfaced as IDEMPOTENT_REPLAY.
- **Evidence:** `apps/console/src/components/credits/order-row-actions.tsx:39-40` · `apps/api/src/orders/orders.service.ts (issue: idempotencyKey `order:${id}:issue`, status guard)`
- **Fix:** Pass a useIdempotencyKey(dialog==='issue') value as the Idempotency-Key when posting /orders/:id/issue, matching the other money dialogs.

**VAL-S6 — Route id/param values are not format-validated (cuid/uuid)**  
<sub>api · effort M · ○ unverified (cut off by session limit)</sub>

- **Expected:** Path params used as entity identifiers should be format-validated (e.g. a cuid/uuid pipe or zod) so malformed input is rejected at the boundary rather than reaching the data layer.
- **Actual:** Many controllers accept @Param('id') id: string (and @Param('region'), @Param('code')) raw and pass them straight into Prisma where:{id}. Prisma fully parameterizes these so there is no SQL-injection exposure; impact is limited to malformed IDs producing a NOT_FOUND. The operatorId that reaches reports.service.ts dynamic SQL is also bound via Prisma.sql parameterization, so it is safe.
- **Evidence:** `apps/api/src/operators/operators.controller.ts:72` · `apps/api/src/operators/operators.controller.ts:79` · `apps/api/src/players/players.controller.ts:51` · `apps/api/src/redemptions/redemptions.controller.ts:93` · `apps/api/src/reports/reports.service.ts:195`
- **Fix:** Apply a lightweight id-format pipe (zod cuid/uuid) on path params for consistency and to fail fast; low priority given Prisma parameterization already blocks injection.

**INFRA-S9 — Argon2id parameters at OWASP floor; refresh token hashed with bare SHA-256**  
<sub>auth · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Password KDF cost tuned above the bare minimum for privileged accounts; refresh-token hashing keyed (HMAC) where feasible.
- **Actual:** PasswordService uses Argon2id at memoryCost=19456 KiB, timeCost=2, parallelism=1 — exactly the OWASP minimum, with no higher profile for admin tiers. Refresh tokens are hashed with unkeyed SHA-256 (token.service.ts:16-18); acceptable given 48 bytes of entropy but a keyed HMAC would defend better against a DB-only leak. Both are reasonable, noted for completeness only.
- **Evidence:** `apps/api/src/auth/password.service.ts:11` · `apps/api/src/auth/token.service.ts:16` · `apps/api/src/auth/token.service.ts:47`
- **Fix:** Consider raising Argon2 memory/time (e.g. 47104 KiB / t=3) for the platform's threat model and switching refresh-token hashing to HMAC-SHA256 with a server pepper. Low priority.

**FE-I1 — Access token in-memory + httpOnly refresh cookie (correct, XSS-resistant pattern)**  
<sub>auth · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Access token not in localStorage/sessionStorage; refresh token httpOnly; token sent as Bearer.
- **Actual:** Confirmed: accessToken lives in a module variable and is attached as Authorization: Bearer; no localStorage/sessionStorage usage anywhere in the console (grep-confirmed). Refresh is httpOnly + path-scoped. Realtime uses a separate short-lived minted token, not the main JWT. This is the recommended pattern — no action beyond keeping it.
- **Evidence:** `apps/console/src/lib/api.ts:35-43` · `apps/console/src/lib/api.ts:108-128` · `apps/console/src/lib/socket.ts:55-70`
- **Fix:** Keep as-is; do not move the token to web storage.

**FE-I2 — Client permission gating is convenience-only; server is authoritative (except S1)**  
<sub>rbac · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** Client-side permission/nav gating must be UX-only over an authoritative server RBAC + subtree-scope layer.
- **Actual:** Pages use hasPermission()/ForbiddenState and the sidebar filters by permission; the API enforces deny-by-default RBAC (PermissionGuard) and subtree scope (verified solid in the prior audit). No console route relies on the UI as the sole authZ guard — the one exception is MFA enrollment (see S1).
- **Evidence:** `apps/console/src/lib/permissions.ts:1-20` · `apps/console/src/app/(app)/operators/page.tsx:23-41` · `apps/api/src/common/auth/permission.guard.ts:28-40`
- **Fix:** No change; ensure new privileged buttons always have a matching server guard.

**FE-I3 — No XSS sinks and no secrets in NEXT_PUBLIC_* (confirmed clean)**  
<sub>console · effort S · ○ unverified (cut off by session limit)</sub>

- **Expected:** No dangerouslySetInnerHTML/innerHTML/eval with untrusted data; no secrets in NEXT_PUBLIC_*; external links use rel=noopener.
- **Actual:** Grep-confirmed: zero dangerouslySetInnerHTML/innerHTML/eval/new Function in the console. NEXT_PUBLIC_* is only NEXT_PUBLIC_API_URL (public origin) and NEXT_PUBLIC_PLATFORM_MODE (mode flag) — no secrets. The single target=_blank link carries rel="noopener noreferrer". The remaining sink is the documentUrl href in S2.
- **Evidence:** `apps/console/src/lib/env.ts:1-4` · `apps/console/src/lib/platform.ts:13` · `apps/console/src/components/compliance/kyc-queue.tsx:61`
- **Fix:** No change; preserve these properties in review.

---

## 5. The Redemptions crash & the systemic "white-screen" class

You reported the **Redemptions tab crashes the superadmin console**. I traced it; here is the precise picture (the auto-mode classifier correctly blocked me from authenticating against production to capture the live stack trace, so the *exact* throwing line on that specific page needs one local repro — but the **crash class and its fix are confirmed in code**):

1. **No error boundaries exist.** There is no `error.tsx` or `global-error.tsx` anywhere under `apps/console/src/app`. In the Next.js App Router that means *any* exception thrown during a route's render is uncaught → the framework shows the generic **"Application error: a client-side exception has occurred"** white screen. Every page is one bad field away from this.

2. **List screens bypass the app's own `QueryBoundary`.** The Redemptions list uses `useCursorList` and never reads `list.error`; a failing `/redemptions/queue` is swallowed, and a render-path throw has nothing to catch it.

3. **Confirmed sibling crashers from the same root cause (contract drift):** the **Ledger-health** system-accounts panel calls `humanize(a.account)` where the API field is `systemKey` → `humanize(undefined)` → `undefined.toLowerCase()` **throws and crashes the page** on any seeded system account; the **Reports → Credit-flow** tab reads `creditFlow.data.points` but the API returns `buckets` → iterating `undefined` **throws at render**. These are RRL-C3 / RRL-C4 below.

**Fix (covered in P0):** (a) add `app/(app)/error.tsx` + `app/global-error.tsx` so a thrown render degrades to a ret[r]y-able panel, not a white screen; (b) route every list/detail screen's fetch + render through `QueryBoundary`; (c) harden `<Money>` against non-numeric input (guard the `BigInt(valueMinor)`); (d) fix the four confirmed contract-drift mismatches (Ledger checks/accounts/tx, Reports credit-flow, Dashboard credit-flow + circulation KPI). After (a)+(c) alone, the Redemptions tab can no longer "crash the app" — worst case it shows a clean error panel — and (d) removes the actual throws.

---

## 6. Your two new product requirements

These were not in the original spec the audit measured against, so they appear here explicitly with current-state grounding and a build outline. Both are saved to project memory.

### 7.1 Agent-console game win-rate sliders (adjust player win rates)

**Current state — effectively not started for agents:**
- RTP is a **single global** `Game.rtpBps` per game (`schema.prisma model Game`, default 9400). There is no per-agent and no per-player RTP.
- Changing it requires `game.configure` **and** `game.rtp_override`; **STORE (agent) tier holds neither** in the base matrix — so agents cannot tune win rates at all today.
- **All four live engines (phoenix/royal/dragon/wheel) ignore `rtpBps`** (finding CMPL-CR4): the override only affects the placeholder provider, so even where it is permitted it is a no-op on real games.

**Build outline (substantial, gated, audited):**
1. **Make RTP real in the engines first** (CR4) — precompute paytables per target RTP, or blend a miss-rate to hit a target; add a simulation test asserting realized RTP tracks the configured value. *Without this, sliders are theatre.*
2. **Data model:** add a scoped override table, e.g. `GameRtpOverride { gameId, operatorId, playerId?, rtpBps, setByUserId, createdAt }` (operator-level and optional per-player), with the resolution order **player → owning-agent → game default**, all within the agent's subtree. Bound to a platform min/max band.
3. **API:** `GET/PUT /games/:code/rtp` (agent-scoped) + per-player variant under `/players/:id/rtp`; `@RequirePermission` a new `game.rtp_agent` granted to STORE, `@ScopeCheck`, idempotent, **audited on every change**, band-clamped server-side.
4. **Engine plumbing:** resolve the effective `rtpBps` at `placeBet` from override→default and pass it into the (now RTP-aware) engine.
5. **Console:** a "Win rates" screen in the agent console with a slider per game (and optional per-player drill-in), showing current effective RTP, the allowed band, and a confirm + audit-reason on change.

> ⚠️ **Legal/compliance flag (per CLAUDE.md "stop and flag if it changes the legal/compliance posture").** Letting an agent tune *individual players'* win rates is legally sensitive in many jurisdictions and interacts with the provably-fair claims. I will build it as you asked — bounded, audited, permission-gated — but please confirm the jurisdictional posture with counsel, and decide whether per-player (vs per-agent-only) overrides are in scope. This is a decision only you can make.

### 7.2 Full per-player play history + credit history (for every player under that agent)

**Current state — partially there:**
- `GET /players/:id/history` already merges **credit** (ledger entries), **play** (game *sessions*, with `totalBetMinor`/`totalWinMinor`), and **redemptions** into one timeline, rendered by `HistoryTimeline` on the player detail page. Subtree scope already guarantees an agent only sees its own players.
- Gaps: it is **one merged feed**, not separated **Play** vs **Credit** views; play is **session-level only** (no per-spin/round detail, though the `GameRound` model exists); and the same view is shown to superadmin.

**Build outline:**
1. **Separate the views:** dedicated **Credit history** (ledger: recharges, removals, bets, wins, redemptions with running balance) and **Play history** (sessions → expandable to **round-level** detail) tabs on the player detail page.
2. **Round-level endpoint:** `GET /players/:id/rounds` (and/or `/sessions/:id/rounds`) returning per-round bet/win/outcome/RNG-proof, cursor-paginated, indexed on `(playerId, createdAt)`.
3. **Reachability:** ensure every player created under the agent is listed and linkable (the Players-list column/filters gaps in §3 feed this).
4. **Superadmin de-emphasis (your call):** hide or collapse the deep per-player history for SUPER_ADMIN (they work at aggregate level), keeping it front-and-centre for agents.

---

---

## 7. Remediation roadmap (build to 100%)

Phased in dependency order. Tags reference the finding ids in §3/§4. Effort: S ≤½d, M ≤2d, L ≤1wk, XL >1wk.

### P0 — Stop the bleeding: criticals + crashes (this week)
- **Rotate the production `superadmin` password and every `.env.production` secret now.** Make `SEED_PASSWORD` mandatory (throw if unset), refuse admin seeding when `NODE_ENV=production` without an explicit strong secret, and set a `mustChangePassword` flag forcing first-login rotation. — *INFRA-S1 / AUTH* · S
- **Enforce MFA server-side.** When `tierRequiresMfa(tier) && !mfaEnabled`, issue only an enrollment-scoped token; add a guard that rejects `@RequirePermission` routes until enrolled; require TOTP at login for MFA tiers. Keep the console `MfaGate` as UX only. — *INFRA-S2, FE-S1/S2* · M
- **Make geo enforcement real and fail-closed.** Resolve region at the HTTP boundary (`CF-IPCountry`/geoip of `req.ip`), thread a `GateContext` into `checkLogin/checkDeposit/checkPlay/checkRedeem`, **`await applyRegionRule` (drop the `void`)**, wire `checkLogin` into player login, gate on `GEO_ENFORCED`. — *CMPL-CR1* · M
- **Add error boundaries + universal async boundary.** `app/(app)/error.tsx` + `app/global-error.tsx`; route every list/detail screen's fetch+render through `QueryBoundary`; guard `<Money>`'s `BigInt(valueMinor)`. This alone makes the Redemptions tab (and every page) degrade to a clean panel instead of a white screen. — *§5, FE error-boundary* · M
- **Fix the four confirmed contract-drift crashers/blanks.** Ledger-health types (`ranAt`, `checks[].name/ok`, `systemAccounts[].systemKey`, nested tx) + guard `humanize(undefined)`; Reports & Dashboard credit-flow (`buckets` not `points`); Dashboard circulation KPI field name. — *RRL-C3/C4/C6, DASH-C2/…* · M
- **Fix the Platform Settings panel.** Map `{mode, settings:[{key,value}]}` into state, seed `initialMode` from server, reflect stored KYC/GEO/RTP/threshold so saves can't clobber `PLATFORM_MODE` or silently re-enable toggles; hard-confirm against the *server* mode. — *CAS-CA2* · S

### P1 — Security hardening foundations (API · infra · DB)
- **Security headers everywhere.** `helmet` on the API (HSTS, noSniff, frameguard DENY, referrer-policy, disable `x-powered-by`); CSP + `frame-ancestors 'none'` + nosniff + Referrer-Policy + HSTS on the console via `next.config headers()`/`vercel.json`. — *INFRA-S4, FE-S3* · S/M
- **Turn on global rate limiting.** Register `ThrottlerGuard` as an `APP_GUARD` (keep per-route `@Throttle` overrides; `@SkipThrottle` health). Add a per-socket token bucket for `subscribe`/`unsubscribe` and batch the descendant-room auth into one `findMany`. — *INFRA-S5, RT-R2* · S/M
- **Account lockout.** Redis-backed per-identifier failure counter with progressive lockout + a separate TOTP-step counter, independent of IP; audit lockouts; generic errors to avoid enumeration. — *INFRA-S3* · M
- **Kill the stored-XSS sink.** Protocol-allowlist any URL rendered into `href` (http/https only), tighten `documentUrl` zod to reject `javascript:`/`data:`, and gate KYC submit with a permission. — *FE-S2, VAL* · S
- **DB-level integrity backstops.** Forward migration adding `BEFORE UPDATE/DELETE` triggers (or `REVOKE UPDATE,DELETE`) on `audit_logs`/`ledger_entries`/`ledger_transactions`; partial `CHECK (balanceMinor >= 0)` for OPERATOR/PLAYER + a deferred zero-sum constraint trigger; `operators(path text_pattern_ops)` index for subtree `LIKE`; run the app under a least-privilege DB role with enforced TLS. — *DBSEC-D1/D2/D4 + D5–D12* · M each
- **Fix the float money bug.** Compute `credit_orders.totalCents` and the redemption payable in BigInt with an explicit rounding policy; never `Number(bigint) * n` on money. — *DBSEC-D3* · S
- **Real object storage.** Implement an R2/S3 presigner (aws-sdk v3) behind `StorageService`, env-selected (keep the stub for tests); validate MIME/size; add a signed-read endpoint for KYC document preview; validate creds at boot. — *API-A2, VAL* · M
- **Misc hardening.** Encrypt the MFA TOTP secret at rest; fail-closed prod env (`COOKIE_SECURE/SAMESITE/ALLOWED_ORIGINS`); bound the `Idempotency-Key` header; remove the public dev styleguide route and the never-issued `fc_access` cookie fallback; validate console env with zod; raise the JWT-secret floor. — *INFRA/VAL/FE* · S/M

### P2 — Complete the broken & stub screens
- **Reports** — render all five spec tabs (player-activity, revenue, margin, settlement) bound to their existing endpoints; fix CSV to build a Blob + anchor download (or implement the async R2 job). — *RRL-A1/C1/C2* · M
- **Ledger health** — full type alignment, expected-sign indicators, working tx explorer, and "run reconciliation" enqueues the BullMQ job. — *RRL-C4/C6* · M
- **Dashboard** — Activity feed (endpoint + component), pending-redemption/order-outbox KPIs, super-admin extras (circulation identity, settlement exposure, total minted/revenue). — *DASH* · M/L
- **Organization** — balance on node cards; lazy-load deep branches. **Operator detail** — real Orders tab; Settings tab for feature flags + enabled currencies. — *DASH* · M
- **Credits** — counterparty (buyer/seller) display-name + proof + ledger-tx-link columns; attach proof to an existing order. — *CPR/API* · M
- **Players** — list columns (owning agent, balances, lifetime recharged/redeemed) + balance-range/activity filters + agent filter; **reactivate** endpoint + button; notes/flags (DB+API+UI). — *CPR* · L
- **Shell** — global search (component + API), wire notification mark-read/read-all + authoritative unread count, sortable `DataTable`, drive mode badge/currencies from the *live* platform setting. — *SHELL* · M
- **Audit / Announcements / Settings** — date+actor+target filters and session/UA column; schedule/target/deactivate + Notification fan-out; remaining platform-setting fields (JWT/session lifetimes, redemption routing, currencies, flags, read-only `CREDIT_MINOR_UNITS`). — *CAS* · M

### P3 — Compliance & realtime completeness
- **Realtime events** — emit `order.updated` (in the same tx as each order transition), plus `announcement`, `player.created`, `session.round`; add socket re-validation against the access-token TTL / deactivation. — *RT-R1, RT-R*  · M
- **AML** — at least one detection rule calling `createFlag` (threshold, velocity, structuring) + a manual "raise flag" endpoint/UI; integration test that an open flag blocks redemption. — *CMPL-CR2* · L
- **Responsible gaming** — pass `amountMinor` to `checkDeposit`; build the `RgLimitEditor` + self-exclusion action + excluded-players list, wired to existing routes. — *CMPL-CR3/CR5, CAS-CA1* · S+L
- **Settings → runtime** — a settings provider (cache + invalidation) so KYC/GEO/RTP/threshold changes apply without a restart and enforcement honours the toggles. — *CMPL-CR6* · M
- **Age/21+** — DOB capture (signup/KYC), min-age platform setting, age check in the gate. — *CMPL-CR7* · M
- **Compliance UI depth** — geo blocked-players view + inline toggle, AML drill-in to player/triggering activity, KYC doc preview, promotions fields. Publish a paytable/verifier so provably-fair covers the win mapping, not just the RNG draw. — *CAS/CMPL* · M/L

### P4 — Your new features
- **Make RTP real in the engines (prerequisite).** Precompute paytables per target RTP (or blend miss-rate); simulation test that realized RTP tracks the configured value. — *CMPL-CR4* · L
- **Agent win-rate sliders.** `GameRtpOverride` model (operator + optional per-player, banded), agent/per-player RTP API (`game.rtp_agent` permission, `@ScopeCheck`, audited, idempotent), engine resolution player→agent→default, and the agent-console "Win rates" slider screen. **(Legal sign-off required — see §6.1.)** — *§6.1* · L/XL
- **Separated per-player history.** Distinct Credit-history and Play-history tabs; round-level endpoint (`/players/:id/rounds`) with RNG proof; superadmin de-emphasis. — *§6.2* · M

### P5 — Tests, observability, polish
- The test suite in §9; outbox SENT cleanup + lag/FAILED alerting; remaining low/info findings (copy fixes, empty-state polish, optimistic updates).

---

## 8. Security hardening checklist

**Auth & session** — [ ] rotate prod superadmin + secrets · [ ] mandatory `SEED_PASSWORD` + prod seed gate + `mustChangePassword` · [ ] MFA enforced server-side (enrollment-scoped token + guard) · [ ] account lockout (per-identifier, IP-rotation-resistant) + TOTP-step throttle · [ ] TOTP secret encrypted at rest · [ ] JWT secret floor raised · [ ] refresh rotation + reuse-detection (already ✓).

**Transport & headers** — [ ] helmet on API (HSTS/noSniff/frameguard/referrer, no `x-powered-by`) · [ ] console CSP + `frame-ancestors 'none'` + nosniff + Referrer-Policy + HSTS · [ ] CORS allowlist fail-closed in prod · [ ] cookies httpOnly+secure+sameSite (already ✓, make prod fail-closed).

**Authz & tenancy** — [ ] `@RequirePermission` + `@ScopeCheck` on every privileged route (already broadly ✓; close any gap from AUTHZ) · [ ] in-service `isInSubtree` backstops on by-id writes · [ ] scoped-write coverage (today scoped client filters READs only) · [ ] AML list AND a subtree predicate.

**Input/output** — [ ] zod at every boundary (already ✓) · [ ] protocol-allowlist URLs in hrefs · [ ] upload MIME/size validation + private buckets + signed reads · [ ] bound `Idempotency-Key` · [ ] console env via zod.

**Rate limiting** — [ ] global `ThrottlerGuard` · [ ] socket token-bucket + room caps · [ ] stricter auth/money overrides (already ✓).

**Database integrity** — [ ] append-only triggers/REVOKE on audit + ledger tables · [ ] non-negative + zero-sum CHECK/constraint triggers · [ ] subtree `text_pattern_ops` index · [ ] least-priv DB role + TLS · [ ] no float money math (fix order/redemption totals).

**Compliance controls live** — [ ] geo resolves+enforces (fail-closed) · [ ] AML detection creates flags · [ ] DEPOSIT RG limit enforced · [ ] settings toggles read at runtime · [ ] age/21+ gate.

**Realtime** — [ ] socket principal re-validation vs token TTL/deactivation · [ ] rate limiting · [ ] outbox retention + FAILED alerting.

---

## 9. Testing & verification plan

- **Unit** — money/BigInt helpers (✓ extend), permission matrix per tier, scope `isInSubtree`, RTP-to-realized-RTP simulation per engine, lockout counter, settings-provider cache/invalidation.
- **Integration (real DB + HTTP)** — full `issue → transfer → recharge → play → redeem` cycle asserting the ledger nets to zero (✓ keep); idempotency replay returns the first result; **append-only** (UPDATE/DELETE on audit/ledger tables raises); negative-balance + zero-sum DB constraints reject bad writes; **MFA**: un-enrolled admin token is rejected on privileged routes; **geo** BLOCK throws; **AML** open flag blocks redemption; **DEPOSIT RG** limit blocks an over-limit recharge; agent RTP override changes realized payout within band; agent cannot read/act outside its subtree (per resource).
- **Contract tests** — generate console types from the API response shapes (or a shared zod) so the Reports/Ledger/Settings/Dashboard drift class **cannot regress**; a smoke test that every nav route renders against seeded data without throwing.
- **E2E (Playwright)** — superadmin and agent log in (with MFA), visit every nav route (no white screen), run one money action each (recharge, approve redemption, issue), export a CSV (file downloads), set an agent win-rate slider, view a player's play+credit history.
- **Per-phase gate** — P0 done when all 16 nav routes render on seed with no console error and the takeover chain is closed; later phases gated by the scorecard area flipping to 🟢 with its tests green.

---

## 10. Definition of done ("100% complete & hardened")

1. Every screen in the §2 scorecard is 🟢: built, wired to live data, no contract drift, no placeholder/dead control, graceful error + empty + forbidden states.
2. Zero unhandled render crashes: error boundaries in place; every route renders on seeded data; the contract-test + smoke-test suite is green in CI.
3. The four criticals are closed and stay closed by tests (rotated secrets, server-side MFA, live geo, no default creds path).
4. The §8 checklist is fully ticked; `helmet`/CSP, global throttling, lockout, DB-level append-only + balance constraints all present.
5. Compliance controls are live, not inert (geo, AML, RG-deposit, age, runtime settings) with tests proving enforcement.
6. Your two features shipped: agent win-rate sliders (RTP real in engines, bounded/audited/gated, **with legal sign-off**) and separated per-player play+credit history with round-level detail.
7. CI runs lint + typecheck + the unit/integration/contract/e2e suites on every PR; coverage ≥80% on `domain` and `features/*/service`.

---

## 11. Appendix — method & verification status

- **14 audit dimensions** (findings): Dashboard/Org/Operators (12), Credits/Players/Recharge (16), Redemptions/Reports/Ledger (13), Compliance/Audit/Announce/Settings (14), Shell & cross-cutting (9), API endpoints (12), DB schema (3), Authz & scope (3), Validation/injection (7), Infra hardening (9), Console frontend security (11), DB integrity (12), Realtime/sockets (7), Compliance & RGS (13).
- **Verification:** 52 confirmed + 17 adjusted at high confidence; **71 unverified** (verifier cut off by the session limit) — concentrated in the security dimensions. Unverified ≠ wrong; they are credible and cite evidence, but should get a confirmation pass before being treated as proven. Re-running `Workflow` with `resumeFromRunId` after the limit resets will fill these in from cache + the missing verifiers.
- **Live reproduction** of the Redemptions crash against production was intentionally **not performed** — the harness blocked authenticating against shared prod infra with default creds (correctly). The crash *class* and fix are confirmed from code (§5).
- This document supersedes nothing; it complements `docs/audit/2026-06-16-superadmin-agent-portal-audit.md` (credit rules) and `docs/audit/2026-06-16-security-fairness-audit.md` (game fairness / security foundations).
