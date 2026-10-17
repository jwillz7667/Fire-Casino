# Aureus

A credit-based gaming platform. The operator issues credits and sells them down a distribution tree; players buy credits from a local store/agent, play arcade games, and redeem winnings back up the chain. Every dollar of real money moves **off-platform** (cash, wire, crypto, Cash App, whatever the operators arrange), so the system never touches a card or debit processor. The actual games are out of scope and stubbed behind a clean contract.

"Aureus" is a placeholder codename (a Roman gold coin). Rename freely.

---

## 1. What we're building

Three deployable surfaces over one backend:

| Surface     | App            | Who uses it                                                        | What it does                                                                                                                                            |
| ----------- | -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Console** | `apps/console` | Super admin, admins, distributors, sub-distributors, stores/agents | Manage the distribution tree, issue and transfer credits, create and recharge players, approve redemptions, run reports, configure games and compliance |
| **Arcade**  | `apps/arcade`  | Players                                                            | Log in, see balance, browse the game lobby (placeholder games), play, request a recharge from their agent, request a redemption                         |
| **API**     | `apps/api`     | The two apps above                                                 | NestJS backend: REST + Socket.io + background workers                                                                                                   |

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

- **One credit is one credit everywhere in the ledger.** Transferring 1000 credits down moves exactly 1000 credits. Nobody marks up the _credit count_.
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

> Product name: **Goldwave Casino** (`goldwavecasino.xyz`). Internal codename: **Aureus** (kept as the `@aureus/*` package namespace and platform-infra name). Specs live in [`outline-docs/`](./outline-docs); read `CLAUDE.md` first, then `outline-docs/01`–`09`. Build order and acceptance criteria are in `outline-docs/09-build-plan.md`.

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

### Processes

The API image runs as **two processes** that share the same code:

| Process | Entry                                                       | Responsibility                                                    |
| ------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| web     | `pnpm --filter @aureus/api start` (`dist/main.js`)          | REST + Socket.io gateway                                          |
| worker  | `pnpm --filter @aureus/api start:worker` (`dist/worker.js`) | outbox → realtime relay, scheduled ledger reconciliation (BullMQ) |

Both must run in production. The web process attaches the Socket.io Redis adapter; the worker publishes relayed events over Redis so they reach clients on any web instance, and runs the reconciliation sweep every 5 minutes (results land on the **Ledger Health** page).

### Deployment

The backend uses PostgreSQL, Redis, and **Cloudflare R2** (KYC documents / payment proofs). The free setup below also hosts the console and arcade as separate Render Node web services. Set `NEXT_PUBLIC_API_URL` to the backend's HTTPS origin and `NEXT_PUBLIC_API_PROXY=true` on **both** frontend services, then rebuild. Next.js forwards `/api/v1/*` to that fixed upstream while Socket.io connects directly to it. The browser stores refresh cookies on each frontend's own host, so browsers blocking third-party cookies can restore sessions without a paid custom domain. Configure exact frontend origins in backend `ALLOWED_ORIGINS`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax`, and an empty `COOKIE_DOMAIN`.

Configure the same strong **server-only** `FRONTEND_PROXY_SECRET` on the API and both Render frontends. The Blueprint generates it once and references that value from both frontends. Render's Cloudflare ingress overwrites `CF-Connecting-IP`; frontend middleware validates that single address, strips caller-supplied assertion headers, and authenticates its forwarded address to the public API. This keeps rate limits and audit IPs tied to the browser client. The API ignores invalid assertions and keeps its normal one-hop proxy policy. See [Render's header guidance](https://render.com/articles/host-pocketbase-on-render). Never use a `NEXT_PUBLIC_` name for this secret, and rotate all three services together. Other frontend providers need their own documented trusted-ingress adapter before enabling authenticated client-IP forwarding.

Direct HTTP calls remain available with `NEXT_PUBLIC_API_PROXY=false` (the default). If frontends and backend are on different sites, direct mode requires `COOKIE_SAMESITE=none` and browsers that permit third-party cookies. Only switch the backend to `lax` after both deployed frontends use the proxy; existing direct callers otherwise lose refresh sessions.

#### Free Render + Neon deployment

The [Render Blueprint](./render.yaml) creates three free web services (API/worker, console, arcade) and a free Key Value instance for Redis. PostgreSQL runs on [Neon Free](https://neon.com/pricing), which has no expiration or card requirement. All four Render resources explicitly use `plan: free`; no paid worker or expiring Render Postgres database is created.

[Deploy Fire Casino to Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fjwillz7667%2FFire-Casino%2Ftree%2Fcodex%2Ffree-backend-hosting-20261017)

1. Create a Neon Free PostgreSQL 16 project, preferably near Render's Oregon region. Use its SSL connection URL as `DATABASE_URL`. For a small instance, add `connect_timeout=15`, `connection_limit=5`, and `pool_timeout=15` query parameters alongside `sslmode=require`. A direct URL works for both startup migrations and the runtime; separate credentials are recommended below.
2. Open the deploy link and sign in to Render with GitHub. Supply the prompted runtime values: the Neon URL, existing platform mode and JWT secrets, frontend URLs/allowed origins, and real R2 credentials and bucket names. Preserve both JWT secrets when importing existing users, especially `JWT_REFRESH_SECRET`, which protects MFA secrets. A fresh setup needs independently generated secrets of at least 32 characters.
3. Review the Blueprint's four **Free** resources, then deploy. Redis is private and configured with `noeviction`; its connection URL is wired automatically. `API_URL` references Render's own public HTTPS URL, both frontend API origins reference it, and the proxy secret is shared through service references. Keep credentials in the providers' secret stores.
4. Set backend `CONSOLE_URL`, `ARCADE_URL`, and `ALLOWED_ORIGINS` to the exact generated frontend HTTPS URLs. Check `/readyz`, both API/worker logs, and each frontend's `/login`. The frontend commands install development build tools explicitly and start Next on Render's supplied `PORT`. Provision the initial administrator securely for a fresh database; the development seed also creates demo accounts.

[Render's free limits](https://render.com/docs/free) include **750 web-service hours shared by the entire workspace per month**, with sleep after 15 minutes without traffic. Three continuously active web services would exceed that allowance; idle sleep makes this suitable for low-use/demo workloads. Sleep also pauses the worker; the next request wakes a service and can take about a minute. Free Redis has 25 MB of memory and no disk persistence: the worker restores its recurring reconciliation schedule automatically within a minute of Redis recovering. `/readyz` checks connections, not the job schedule. Render advertises no-card free hosting but may request account verification for some users.

Neon Free currently includes 1 GB of storage and 100 compute-unit hours per project per month. The worker's database polling consumes compute while the backend is awake, so monitor that allowance. This is a free setup for small/test workloads within the providers' limits; it does not promise uninterrupted production service.

The combined command applies pending Prisma migrations before starting either process, forwards shutdown signals to both, and exits if either process stops unexpectedly so the host can restart the complete backend. Test this supervisor with `pnpm test:deploy`.

For least-privilege database access, keep the owner's **direct** Neon URL in the optional Render secret `MIGRATION_DATABASE_URL`, and put a separate runtime role's URL in `DATABASE_URL`. Only the migration subprocess receives the owner URL as its `DATABASE_URL`; the API and worker retain the runtime URL and do not inherit `MIGRATION_DATABASE_URL`. Without an override, startup migrations use `DATABASE_URL` as before. The supervisor and hosting account still hold the owner secret, so restrict access to deployment settings.

After applying migrations as the database owner, [deploy/runtime-role.sql](./deploy/runtime-role.sql) creates a new runtime role and limits its permissions: normal tables allow application reads/writes, financial and audit history allow only reads/inserts, and the migration table and schema DDL remain owner-only. Run it with `psql "$MIGRATION_DATABASE_URL" -v runtime_role=firecasino_runtime -f deploy/runtime-role.sql`, then use psql's interactive `\password firecasino_runtime` to set the password without saving it in source. Configure both URLs in Render's secret store. The script is for a dedicated application database and deliberately refuses existing role names. Future table migrations must explicitly grant any required update/delete permissions to the runtime role.

For a fresh production database, use `pnpm --filter @aureus/db db:bootstrap-admin` after migrations. Supply `DATABASE_URL` and `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD` through a secure one-time environment or secret manager; never put credentials in shell arguments, source, or chat. The password must be randomly generated, 20–128 characters long, with at least ten distinct characters. The command creates exactly one `SUPER_ADMIN`, a zero-balance CREDIT account, and an audit record in one transaction. It refuses any database that already contains users or operators, and leaves settings, game data, and other accounts untouched. Complete MFA enrollment on first sign-in and remove the bootstrap credentials from the execution environment afterward. `db:seed` creates development/demo data and is refused when `NODE_ENV=production`.

To retain existing users and balances, first restore a full PostgreSQL backup (schema, data, triggers, custom indexes, and `_prisma_migrations`) into the new database and preserve the existing JWT secrets, especially `JWT_REFRESH_SECRET`, which also protects stored MFA secrets. Stop old web/worker writes for the final transfer and run all five Ledger Health checks before switching traffic. For a fresh database, provision the initial administrator securely: the development seed also creates demo operator/player accounts.

Before switching a restored historical database to the atomic workflows, run the read-only checks in [deploy/financial-workflow-review.sql](./deploy/financial-workflow-review.sql). Approved redemptions with no approval-time payable snapshot require evidence-based metadata backfill before cancellation. Incomplete game rounds with an already-posted bet or win require finance reconciliation; retries deliberately refuse to guess historical payouts or RTP. Old public payment receipts must be replaced with uploads to the private KYC bucket and their public copies retired under the operator's retention policy.

### Backup & restore (Postgres)

The ledger is the system of record, so back up Postgres on a schedule and verify restores:

```bash
# logical backup (schema + data)
pg_dump "$DATABASE_URL" -Fc -f aureus-$(date +%F).dump

# restore into a fresh database
createdb aureus_restore
pg_restore -d "postgresql://.../aureus_restore" --clean --if-exists aureus-YYYY-MM-DD.dump

# after any restore, prove integrity before going live:
#   open Ledger Health (or run the reconciliation job) — all five checks must pass
#   (zero-sum, cache-vs-derived, snapshot-continuity, circulation-identity, settlement-sanity).
```

On Railway, enable automated daily Postgres backups and periodically test a restore into a throwaway DB. Redis holds only ephemeral state (rate-limit counters, BullMQ jobs, the last reconciliation result) and does not need point-in-time backup.

### Commands

| Command                                      | What it does                                       |
| -------------------------------------------- | -------------------------------------------------- |
| `pnpm dev`                                   | run api + console + arcade                         |
| `pnpm --filter @aureus/api dev`              | run one app (`@aureus/console` / `@aureus/arcade`) |
| `pnpm build` / `lint` / `typecheck` / `test` | workspace-wide via Turborepo                       |
| `pnpm db:migrate` / `db:seed` / `db:studio`  | database (Prisma)                                  |
| `pnpm format`                                | Prettier write                                     |

### Environment

All config is env-driven and validated by a zod schema at boot (`packages/shared/src/env.ts`); the process fails fast on missing/invalid vars. See `.env.example` for the full list. Never commit a real `.env`.

### CI

GitHub Actions runs `typecheck → lint → test → build` on every push and PR (`.github/workflows/ci.yml`). The Phase 7 ledger lifecycle test is part of the required suite. `main` stays green.
