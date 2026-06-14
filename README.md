# Aureus

A credit-based gaming platform. The operator issues credits and sells them down a distribution tree; players buy credits from a local store/agent, play arcade games, and redeem winnings back up the chain. Every dollar of real money moves **off-platform** (cash, wire, crypto, Cash App, whatever the operators arrange), so the system never touches a card or debit processor. The actual games are out of scope and stubbed behind a clean contract.

"Aureus" is a placeholder codename (a Roman gold coin). Rename freely.

---

## 1. What we're building

Three deployable surfaces over one backend:

| Surface | App | Who uses it | What it does |
|---|---|---|---|
| **Console** | `apps/console` | Super admin, admins, distributors, sub-distributors, stores/agents | Manage the distribution tree, issue and transfer credits, create and recharge players, approve redemptions, run reports, configure games and compliance |
| **Arcade** | `apps/arcade` | Players | Log in, see balance, browse the game lobby (placeholder games), play, request a recharge from their agent, request a redemption |
| **API** | `apps/api` | The two apps above | NestJS backend: REST + Socket.io + background workers |

The console serves every operator tier from the same app, gated by role and subtree scope. A "distributor" is just an operator whose view is scoped to its own branch of the tree. This mirrors how these platforms actually run: one back-office terminal, different permission scopes.

---

## 2. The business model (read this carefully, the whole design hangs on it)

```
            ┌──────────────────────────────┐
            │   SUPER ADMIN (platform)     │  mints credits, owns everything
            └──────────────┬───────────────┘
                           │ issues credits (paid offline)
            ┌──────────────▼───────────────┐
            │      MASTER DISTRIBUTOR       │  optional tier
            └──────────────┬───────────────┘
                           │ transfers credits down (paid offline)
            ┌──────────────▼───────────────┐
            │        DISTRIBUTOR            │
            └──────────────┬───────────────┘
                           │
            ┌──────────────▼───────────────┐
            │   SUB-DISTRIBUTOR (optional)  │
            └──────────────┬───────────────┘
                           │
            ┌──────────────▼───────────────┐
            │       STORE / AGENT          │  deals directly with players
            └──────────────┬───────────────┘
                           │ recharges player wallet (player pays cash)
            ┌──────────────▼───────────────┐
            │          PLAYER              │  plays games, requests redeem
            └──────────────────────────────┘
```

Credits cascade **down**. Winnings/redemptions settle **up**. The key facts:

- **One credit is one credit everywhere in the ledger.** Transferring 1000 credits down moves exactly 1000 credits. Nobody marks up the *credit count*.
- **Profit lives in the cash price, not the ledger.** A distributor buys credits at, say, $0.008 each and sells them to an agent at $0.010 each. That spread is the distributor's margin, and it changes hands **off-platform**. The platform records the agreed unit price on each order so reports can show margin, but the ledger only moves raw credit units. This separation keeps the money model clean and auditable.
- **No payment processor.** When an operator buys credits, they pay their upline by whatever offline method they arranged. The system records a `CreditOrder` with the amount, agreed unit price, payment method, reference, and proof, and the upline marks it paid before credits are issued. Same idea when a player buys credits from an agent: the player hands over cash, the agent recharges their wallet.
- **Redemption is the reverse.** A player asks to cash out. Their agent (or an upline, depending on config) approves it, the player's prize balance is burned, a payable is recorded, and the agent pays the player cash off-platform, then marks it settled.

### Two operating modes

Set by `PLATFORM_MODE` (a `PlatformSetting`). The ledger supports both; pick per deployment.

- **`OPERATOR` mode** — one fungible `CREDIT`. Players play with credits and redeem credits. Simplest. This is the classic fish-table model.
- **`COMPLIANCE` mode** — dual currency. `PLAY` credits (entertainment, never redeemable) plus `PRIZE` credits (the redeemable "sweeps" currency, granted as a bonus on recharge and through an alternative no-purchase method). Players play with either; only `PRIZE` redeems. This is the US sweepstakes posture that lets the activity argue it is not gambling. It comes with mandatory KYC, geo rules, and an alternative method of entry.

Everything downstream (schema, ledger, API) is written so flipping the mode does not require a rewrite. See `docs/03` for the money flows in each mode.

---

## 3. Glossary

- **Operator** — any non-player node in the tree (super admin through store/agent). Holds a credit balance, can have children.
- **Tier** — an operator's level: `SUPER_ADMIN`, `ADMIN`, `MASTER_DISTRIBUTOR`, `DISTRIBUTOR`, `SUB_DISTRIBUTOR`, `STORE`.
- **Player** — a leaf account that plays games. Owned by exactly one operator (its agent/store).
- **Subtree / branch** — an operator plus all its descendants. The unit of scope: you can only see and act within your own subtree.
- **Ledger account** — a balance bucket. Every operator has one (per active currency); every player wallet is one (per currency); the system has a few special ones (mint, revenue, redemption clearing, promo, adjustments).
- **Issue / mint** — the super admin creating new credits from the mint account and crediting an operator. The only place credits enter existence.
- **Transfer** — moving credits from one operator to a direct child.
- **Recharge / reload** — an agent moving credits from itself into a player's wallet.
- **Redeem / cashout** — a player burning prize credits to get paid offline.
- **RGS** — remote game server. The thing that decides game outcomes. We stub it.
- **RTP** — return to player, set per game in basis points (e.g. 9400 = 94.00%). The placeholder RGS honors it.
- **House edge / rake** — what the games keep on average. Accrues to the `REVENUE` system account.

---

## 4. How the docs fit together

Build in the order of `docs/09`. Reference order:

1. `README.md` — you are here
2. `01-system-architecture.md` — services, infra, auth, realtime, security, env
3. `02-data-model.md` — the full Prisma schema and why each table exists
4. `03-credit-ledger-and-money-flow.md` — the core: double-entry ledger, every money flow, concurrency, idempotency, reconciliation
5. `04-rbac-and-distribution-tree.md` — roles, the tree mechanics, permission matrix, scoping, account lifecycle
6. `05-api-spec.md` — REST endpoints by module, Socket.io events, the RGS contract
7. `06-frontend-console.md` — back-office screens and flows
8. `07-frontend-arcade.md` — player app screens and flows
9. `08-design-system.md` — tokens, type, color, components, the Aureus identity
10. `09-build-plan.md` — phased roadmap with acceptance criteria

If two docs disagree, `03` wins on money, `04` wins on permissions, `01` wins on infrastructure.

---

## 5. Quick mental model for a new contributor

> The whole platform is a hierarchical wallet system with a double-entry ledger underneath and games bolted on top. Operators are nodes in a tree that pass credits down to each other and into player wallets. Players spend wallet credits on game rounds and occasionally cash out. Everything that moves a balance is a journal entry that nets to zero. Real cash never enters the database; only the credits and the paperwork around the cash do.

Hold that picture and the rest follows.

---

## 6. Development

> Product name: **Fire Casino**. Internal codename: **Aureus** (kept as the `@aureus/*` package namespace for now). Specs live in [`outline-docs/`](./outline-docs); read `CLAUDE.md` first, then `outline-docs/01`–`09`. Build order and acceptance criteria are in `outline-docs/09-build-plan.md`.

### Monorepo layout

```
apps/
  api/        NestJS backend (REST + Socket.io + BullMQ workers)
  console/    Next.js back-office (all operator tiers, RBAC-scoped)
  arcade/     Next.js player PWA
packages/
  db/         Prisma schema, client, migrations, seed
  shared/     zod schemas, money/BigInt helpers, enums, permissions, env
  ui/         design system (tokens + components)
  config/     tsconfig base, eslint, prettier
```

### Prerequisites

- **Node 24 LTS** (`nvm use` reads `.nvmrc`) and **pnpm 11** (`corepack enable`).
- **Docker** (local Postgres 16 + Redis 8 via `docker-compose.yml`).

### Quick start

```bash
nvm use                      # Node 24
corepack enable
pnpm install
cp .env.example .env         # adjust if needed

docker compose up -d         # Postgres + Redis
pnpm db:migrate              # apply migrations
pnpm db:seed                 # super admin, system accounts, demo tree, games

pnpm dev                     # api :4000, console :3000, arcade :3001
```

Health: `GET http://localhost:4000/healthz` (liveness), `/readyz` (DB + Redis).

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | run api + console + arcade |
| `pnpm --filter @aureus/api dev` | run one app (`@aureus/console` / `@aureus/arcade`) |
| `pnpm build` / `lint` / `typecheck` / `test` | workspace-wide via Turborepo |
| `pnpm db:migrate` / `db:seed` / `db:studio` | database (Prisma) |
| `pnpm format` | Prettier write |

### Environment

All config is env-driven and validated by a zod schema at boot (`packages/shared/src/env.ts`); the process fails fast on missing/invalid vars. See `.env.example` for the full list. Never commit a real `.env`.

### CI

GitHub Actions runs `typecheck → lint → test → build` on every push and PR (`.github/workflows/ci.yml`). The Phase 7 ledger lifecycle test is part of the required suite. `main` stays green.
