# CLAUDE.md

Conventions and guardrails for building **Aureus**. Read this before touching code. Read `docs/README.md` next, then build in the order set by `docs/09-build-plan.md`.

> Aureus is a credit-based gaming platform. An operator mints credits and sells them down a distribution tree (distributor → sub-distributor → store/agent → player). Players play arcade games and redeem winnings back up the chain. All real-money settlement happens off-platform, so there is no card/debit processor in this codebase. Games are placeholders behind a clean game-server contract.

## Stack (do not swap without a reason in the PR description)

- Monorepo: **pnpm workspaces + Turborepo**
- Backend: **NestJS** (TypeScript, strict), **Prisma + PostgreSQL**, **Redis** (cache + locks + pub/sub), **BullMQ** (jobs), **Socket.io** (realtime)
- Frontends: **Next.js 15** (App Router, React 19), **Tailwind CSS**, shared `packages/ui` design system
- Hosting target: API + workers on **Railway**, Next.js apps on **Vercel**, assets on **Cloudflare R2**
- Validation: **zod** everywhere a boundary is crossed (HTTP, sockets, jobs, env)
- Auth: JWT access (15m) + rotating refresh (httpOnly cookie), separate guards for operator side and player side

## Repo layout

```
aureus/
├── apps/
│   ├── api/        NestJS backend (REST + Socket.io + workers entrypoints)
│   ├── console/    Next.js back-office (super admin + all distributor tiers, RBAC-scoped)
│   └── arcade/     Next.js player PWA (game lobby, wallet, recharge/redeem requests)
├── packages/
│   ├── db/         Prisma schema, client singleton, migrations, seed
│   ├── shared/     shared zod schemas, DTOs, enums, money helpers, constants
│   ├── ui/         design system (tokens + components) used by console and arcade
│   └── config/     eslint, tsconfig base, tailwind preset
└── docs/           the specs
```

## Hard rules

1. **Money is integer minor units (`BigInt`). Never floats. Never `number` for balances.** 1 credit = 1000 minor units (3 dp) unless `docs/03` says otherwise. All math in `packages/shared/money.ts`. JSON-serialize `BigInt` as string.
2. **Every balance change goes through the ledger service as a double-entry transaction.** No raw `UPDATE ... balance = balance + x` outside `LedgerService`. The sum of entries per transaction per currency is always zero.
3. **Every credit-moving endpoint takes an idempotency key** and is safe to retry. See `docs/03`.
4. **Scope every operator query to the caller's subtree.** A distributor can only see/act on its descendants. Enforce in a guard + a Prisma middleware that injects the path filter. Never trust an ID from the client without a subtree check. See `docs/04`.
5. **The audit log is append-only.** Every privileged action writes an `AuditLog` row. No deletes, no updates on that table.
6. **Games are stubbed.** Implement the RGS contract in `docs/05` and a `PlaceholderRgsProvider` that returns outcomes against a configured RTP. Do not build real game math. The arcade renders a placeholder game screen.
7. **Compliance hooks are real, the providers are stubs.** KYC, geo, responsible-gaming, and AML checks run at the right points and can block actions; the underlying provider implementations can be stubs that read config. Do not rip the checks out.

## Coding conventions

- TypeScript strict, no `any` (use `unknown` + zod). ESLint + Prettier from `packages/config`.
- NestJS: one module per domain (auth, operators, players, ledger, orders, games, redemptions, compliance, audit, realtime). DTOs validated with zod via a pipe. Services hold logic, controllers stay thin.
- Database access only through `packages/db` Prisma client. Wrap multi-step money operations in `prisma.$transaction` with row locks (`docs/03`).
- Errors: typed domain errors mapped to HTTP by an exception filter. Never leak Prisma errors to clients.
- Naming: `*.controller.ts`, `*.service.ts`, `*.dto.ts`, `*.guard.ts`. Tables snake_case via Prisma `@@map`, fields camelCase in code.
- Tests: Vitest. The ledger, scope guard, and money helpers must have unit tests. Add an integration test that runs a full issue → transfer → recharge → play → redeem cycle and asserts the ledger nets to zero.

## Commands (wire these up in turbo + package.json)

- `pnpm dev` run all apps
- `pnpm --filter api dev` / `--filter console dev` / `--filter arcade dev`
- `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio`
- `pnpm lint` / `pnpm typecheck` / `pnpm test`

## What to ask vs assume

This is a vibe-coder handoff. If a detail is missing, pick the sensible default a competent team would pick, write it down in a short note at the top of the file or in the PR, and keep moving. Do not stop to ask about naming, file layout, or obvious wiring. Do stop and flag if a choice changes the money model, the security boundary, or the legal/compliance posture.

## Legal note for the builder

This is platform infrastructure. The legal model (operator-mode single credit vs. dual-currency sweeps mode) is a business/legal decision the owner makes with counsel, and it changes which compliance toggles are on. Build both modes behind a `PLATFORM_MODE` setting (see `docs/03` and `docs/02` `PlatformSetting`). Keep the compliance scaffolding intact regardless of mode.
