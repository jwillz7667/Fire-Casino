# 09 - Build Plan

A phased roadmap for building Aureus with Claude Code. Each phase has a goal, the work, and acceptance criteria (what "done" means before moving on). Build in this order. The ordering is deliberate: foundation and the money core come before anything user-facing, because everything depends on the ledger being correct.

> The single most important checkpoint is **Phase 7**: the full credit lifecycle integration test (`issue → transfer → recharge → play → redeem`) where the ledger nets to zero at every step. Nothing downstream matters if that doesn't hold.

Conventions for the whole build are in `CLAUDE.md`. The seven hard rules (BigInt money, ledger-only balance changes, idempotency, subtree scope, append-only audit, stubbed games, real compliance hooks) apply in every phase.

---

## Phase 0 — Monorepo scaffold
**Goal:** empty but wired workspace that builds and runs.

Work:
- pnpm + Turborepo. `apps/api` (NestJS), `apps/console` (Next.js 15), `apps/arcade` (Next.js 15 PWA), `packages/db`, `packages/shared`, `packages/ui`, `packages/config`.
- Shared TS config, ESLint/Prettier, env loading, `.env.example` (from `docs/01`).
- Turbo pipeline (build/dev/lint/test/typecheck). Railway + Vercel project config stubs.
- Two API processes share the image: `main.ts` (web) and `worker.ts` (BullMQ).

**Done when:** `pnpm dev` boots api + both frontends; `pnpm build`, `lint`, `typecheck` pass clean across the workspace; a health route returns 200.

---

## Phase 1 — Database + Prisma
**Goal:** the full schema exists and migrates.

Work:
- Implement the entire Prisma schema from `docs/02` in `packages/db` (all models, enums, indexes, materialized-path fields on Operator).
- First migration. Seed script: super admin user+operator (root, depth 0), all system accounts (MINT, REVENUE, REDEMPTION_CLEARING, PROMO, ADJUSTMENT, ROUNDING), default `PlatformSetting` (mode, minor units), a couple of demo `Game` rows.
- `packages/shared` money helpers (`toMinor`/`fromMinor`/`zMinor`, BigInt-safe, no floats) + shared enums + base zod schemas.

**Done when:** migration applies to a fresh Postgres; seed produces a working root + system accounts; money helpers have unit tests covering rounding and BigInt serialization.

---

## Phase 2 — Auth + principals
**Goal:** operators and players can authenticate, scoped correctly.

Work:
- JWT access (15m) + rotating refresh cookie with reuse detection (`docs/01`). Separate operator vs player guards keyed on `aud`.
- Login/refresh/logout/me, password change, operator TOTP enable/confirm (`docs/05` §1).
- `ScopeGuard` + the Prisma subtree middleware + the principal/scope plumbing (`docs/04` §3). RBAC permission checks wired (tier + permission matrix).

**Done when:** operator and player can log in and hit `/auth/me`; refresh rotates and reuse revokes the family; an operator request for a node outside its subtree returns `OUT_OF_SCOPE`; permission-gated routes reject the wrong tier.

---

## Phase 3 — Ledger core (the heart)
**Goal:** the double-entry ledger primitive, correct under concurrency.

Work:
- `LedgerService.post` exactly as specified in `docs/03` §3: idempotency check, `assertBalanced`, Serializable `$transaction`, `FOR UPDATE` lock ordered by account id, non-negative enforcement (except `allowNegative` system accounts), txn + entries + `balanceAfterMinor` snapshots, optimistic `version` guard, outbox write.
- `LedgerAccount`/`LedgerTransaction`/`LedgerEntry` access layer. Idempotency-key handling + `IDEMPOTENT_REPLAY` semantics.

**Done when:** unit + concurrency tests pass — every transaction nets to zero; two concurrent posts on the same account don't corrupt balances or go negative; replaying an idempotency key returns the original result and does not double-apply; cached balance equals the sum of entries after a randomized sequence of posts.

---

## Phase 4 — Operators + distribution tree
**Goal:** build and manage the tree.

Work:
- Create child operator (one tier below, in subtree), list/get/tree, update, suspend (cascade), close (zero balance + no children), the materialized-path queries (`docs/04`).
- Issue/mint flow (`docs/03` §4.1) and operator→child transfer (§4.2), both on top of `LedgerService`.

**Done when:** super admin can mint to a child and transfer down the chain; balances move via ledger only and reconcile; tier/scope rules hold (can't create a sibling or higher tier, can't act outside subtree); suspend cascades; close blocks on non-zero balance.

---

## Phase 5 — Credit orders (offline cash workflow)
**Goal:** the buy/sell credit paperwork between nodes.

Work:
- `CreditOrder` lifecycle: request from parent, inbox/outbox, confirm (triggers the transfer), reject, cancel, payment proof upload to R2, `Settlement` tracking of offline cash (`docs/05` §3, `docs/03` §3).
- Keep cash settlement state separate from the credit movement; link order ↔ resulting ledger txn.

**Done when:** a child can request credits, upload proof, and a parent can confirm, which performs the ledger transfer; margin (`unitPriceCents` spread) is recorded but never touches the ledger; order and its ledger transaction are linked; rejecting/cancelling leaves no credit movement.

---

## Phase 6 — Players + wallet + recharge
**Goal:** players exist and can be loaded.

Work:
- Create player (store/agent only), player list/detail (scoped), suspend, password reset.
- Recharge flow (`docs/03` §4.3): agent → player wallet, with the compliance-mode PLAY purchase + PRIZE bonus split. Recharge **request** path from the player side (creates the agent-facing request, `docs/07` §2.4).
- Wallet balance reads (single CREDIT or dual PLAY/PRIZE per mode).

**Done when:** an agent with balance can recharge a player and the player wallet reflects it via ledger; insufficient agent balance is rejected cleanly; compliance mode produces both PLAY and PRIZE legs correctly; a player recharge request lands in the agent's inbox.

---

## Phase 7 — Games (stubbed RGS) + the lifecycle test
**Goal:** server-authoritative gameplay on the placeholder RGS, and the end-to-end proof.

Work:
- `GameProvider` interface + `PlaceholderRgsProvider` honoring per-game RTP via tuned prize tables marked `demo:true` (`docs/05` RGS contract). `GameSession`/`GameRound`, provable-fairness seed scheme (server-seed hash, client seed, nonce).
- Server-authoritative play: bet debit + win credit against `REVENUE` (Option A or B from `docs/03` §4.4), idempotent, within game min/max, drawing from PLAY in compliance mode.
- **The integration test:** a full cycle — mint to operator → transfer down the chain → recharge a player → play several rounds → request and complete a redemption — asserting after **every** step that the ledger nets to zero, no account is wrongly negative, cached balances equal derived balances, and the circulation identity holds.

**Done when:** the placeholder games return server-decided outcomes that move balances through the ledger; RTP holds approximately over many simulated rounds; **the full-lifecycle test passes green**, including the zero-sum and circulation-identity assertions at each step. This is the gate for everything after.

---

## Phase 8 — Redemptions
**Goal:** the cashout workflow.

Work:
- `RedemptionRequest` lifecycle (`docs/03` §4.5): request places a hold (PRIZE/credit → clearing), approval routing per `docs/04`, approve, reject (releases hold), mark-paid (drains clearing, records settlement). Agent-funded vs upline-reimbursed model wired per config.
- Compliance gates: block approve on missing KYC or open AML flag.

**Done when:** a player can request a redemption that holds funds; the routed operator can approve/reject/mark-paid; rejecting releases the hold; the clearing account never goes negative and drains exactly on payout; KYC/AML gates block approval with the right error.

---

## Phase 9 — Compliance layer
**Goal:** the real hooks (providers stubbed) for COMPLIANCE mode.

Work:
- KYC submission + review queue (`KycRecord`, R2 docs), geo rules + region checks on login/redeem (`GeoRule`), AML flags (`AmlFlag`) + `admin:global` events, responsible-gaming limits (`ResponsibleGamingLimit`) enforced on play/recharge, self-exclusion (`SelfExclusion`) blocking play + recharge, age gate, AMoE promotions (`Promotion`).
- Hooks are real and enforced; external verification providers are stubbed behind interfaces.

**Done when:** in compliance mode a player can't redeem without verified KYC, can't act from a blocked region, can't exceed a set limit, and is fully blocked when self-excluded; AML flags surface to admins; flipping `PLATFORM_MODE` to OPERATOR cleanly bypasses the redeemable-currency paths without code changes.

---

## Phase 10 — Realtime + outbox relay
**Goal:** live updates everywhere.

Work:
- Outbox relay (poll/notify) turning `OutboxEvent` rows into Socket.io emissions (`docs/01` §5, `docs/05` §11). Room membership rules (player/operator/subtree/admin) validated against principal scope. Client reconnect reconciliation.

**Done when:** balance changes, order/recharge/redemption updates, AML flags, and announcements arrive live in the right rooms; a client can only subscribe to rooms in its scope; dropping and reconnecting a socket never leaves stale/incorrect state (refetch wins).

---

## Phase 11 — Console frontend
**Goal:** the back-office app (`docs/06`).

Work:
- Build `packages/ui` primitives first (`docs/08` §7): `DataTable`, `Money`/`MoneyInput`, `CoinMark`/`BalanceChip`, `ConfirmMoneyDialog`, forms. Both sub-themes wired.
- Screens in `docs/06`: dashboard, org/tree, operators + create/detail, credits (issue + order inbox/outbox), players + recharge, redemptions queue, reports, ledger health, compliance, audit, announcements, settings. All RBAC-scoped, money via `<Money>`, mutations idempotent + confirmed.

**Done when:** each tier logs in and sees only its scope; an admin can mint/transfer/recharge/approve through the UI with before/after confirms; the ledger-health page reflects the reconciliation jobs; no money is formatted outside `<Money>`; `OUT_OF_SCOPE` renders a clean state.

---

## Phase 12 — Arcade frontend
**Goal:** the player app (`docs/07`).

Work:
- Arcade sub-theme + player primitives (`BalanceChip` dual-balance, `GameTile`/`GameGrid`, `GameStage`/`BetControls`, `RechargeRequestForm`, `RedeemForm`, KYC + RG flows).
- Screens: login/age-gate, lobby, generic game screen (renders RGS outcome + fairness drawer), wallet/recharge-request, cashout/redeem, account/RG/self-exclusion, KYC, announcements. PWA installable, mobile-first, server-authoritative, idempotent actions.

**Done when:** a player logs in, sees dual PLAY/PRIZE balances (compliance) clearly differentiated, plays placeholder games with server-decided outcomes, requests a recharge that hits the agent inbox and lands live when fulfilled, and requests a redemption gated by KYC/region/limits. No card/checkout UI exists anywhere.

---

## Phase 13 — Reports, audit, reconciliation jobs
**Goal:** finance + integrity tooling complete.

Work:
- BullMQ scheduled reconciliation jobs (`docs/03` §8): zero-sum, cache-vs-derived, snapshot continuity, circulation identity, settlement sanity. Surface results to ledger-health.
- Reporting aggregates (credit flow, player activity, revenue, margin, settlement), CSV export, all scoped. Audit log viewer fed by `AuditLog`.

**Done when:** reconciliation jobs run on schedule and flag any drift; reports match ledger-derived numbers and respect scope; audit captures every privileged/money action and is read-only even for super admin.

---

## Phase 14 — Hardening + polish
**Goal:** production-readiness pass.

Work:
- Rate limits (`docs/01`), input validation coverage, error-code consistency, security review of scope isolation (the core boundary), idempotency coverage on every money mutation, observability (structured logs, request ids, metrics), seed/demo data for a clean walkthrough, the `/dev/styleguide` route, README/run docs.
- Load-sanity on the ledger under concurrency; backup/restore note for Postgres.

**Done when:** a fresh clone + env + migrate + seed yields a working demo of the full chain (admin → distributor → store → player → play → redeem); scope isolation survives a deliberate probe; the seven hard rules each have a test backing them; nothing logs secrets; the app is ready to hand to a human team for the legal/business decisions that sit on top (mode choice, licensing, payout operations).

---

## Milestone summary

| Milestone | Phases | Proves |
|---|---|---|
| **M1 Foundation** | 0-2 | builds, migrates, auth + scope work |
| **M2 Money core** | 3-7 | ledger is correct; full lifecycle nets to zero (the gate) |
| **M3 Workflows** | 8-10 | redemptions, compliance, realtime |
| **M4 Product** | 11-12 | both apps usable end to end |
| **M5 Ship-ready** | 13-14 | reporting, integrity, hardening |

Don't move past M2 until the Phase 7 lifecycle test is green. Everything else is built on it.
