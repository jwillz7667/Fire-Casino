# Fire Casino migration and security verification

Verified locally on 2026-10-17. These results apply to the implementation in this branch; they do not establish that the new production deployment is healthy.

## Completed

- Reconfigured the new Render service with independently generated 64-byte JWT access and refresh secrets, HTTPS API URL, secure host-only cookies, and production mode. Redis is configured privately. No credentials are committed or included here.
- Made refresh rotation/revocation atomic, separated operator/player refresh cookies, made expired-access logout revoke the selected refresh family, enforced auth origins, and protected enrolled MFA and privileged realtime connections.
- Made orders, credit transfers, recharges, paired PLAY/PRIZE grants, redemptions, and game rounds commit their ledger movements and associated workflow bookkeeping atomically. Player locks serialize responsible-gaming deposit decisions. Retries preserve the original payable, bonus, and posted outcome.
- Kept financial proofs and KYC documents private, validated ownership, added scoped signed receipt previews, and surfaced upload failures.
- Isolated frontend account caches, restricted game iframe messages by source and origin, renewed realtime tokens, and added optional same-origin HTTP forwarding for browsers that block third-party cookies.
- Added separate migration credentials, a restricted runtime-role SQL template, a safe single-admin initializer, and non-root container execution. Production demo seeding is refused.
- Updated vulnerable dependencies, including Next.js, NestJS, Socket.IO, and Vitest. Both the production and complete dependency audits report zero known advisories.

## Validation

- API: the complete 316-test suite in 41 files passes against dedicated local PostgreSQL and Redis. The final fractional-transfer correction also passes 35 focused integration tests, including new fractional-price and overflow cases. This includes money invariants, concurrency, rollback, authorization, refresh replay, MFA, private-document scope, readiness, worker recovery, and game simulations. Plinko retains its original statistical sample and tolerances with an explicit 120-second budget.
- Shared contracts: 47 tests pass. Frontends: 40 tests pass, including direct and proxied HTTP configuration. Bootstrap: all 11 tests pass against a separate disposable database. Supervisor: all eight subprocess tests pass.
- API, worker, database package, shared package, and both Next.js production builds pass. Workspace lint and typechecks pass. The Node 22 Docker image builds and starts both backend processes as UID 1000, applies all migrations to a separate fresh test database, and returns healthy PostgreSQL/Redis readiness.
- All 19 database migrations apply on fresh local PostgreSQL 16. Restricted-role verification confirms immutable history cannot be updated/deleted, and the runtime role cannot truncate tables, change triggers, create schema objects, or access migration bookkeeping.
- Chromium verified operator login/MFA, independent console/player refresh, console sections, player wallet/account screens, mint → transfer → recharge → play → redeem, idempotent bets, balanced ledger transactions, untrusted-origin denial, and the Wheel iframe/WASM client. The same flow passes through the same-origin proxy, including preserved `no-store` headers and logout after access expiry without affecting the other surface. Browser errors and failed network requests: zero. All 36 configured game asset objects were also checked successfully.
- Local browser and storage fixtures use isolated test data. Real R2 upload/read permissions have not been verified.

## Production blockers

1. The new Render service has no `DATABASE_URL`. The Neon project must be claimed in the owner's account and its direct PostgreSQL connection URL added securely in Render. Existing Railway data has not been copied; no source database access is available.
2. Real `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and the actual bucket names remain required. `R2_BUCKET_KYC` must be private and distinct from the assets bucket. Configure bucket CORS for the exact deployed frontend origins and verify uploads plus signed reads.
3. Vercel rejected frontend project creation with HTTP 402 (`resource_creation_blocked`): the connected account is suspended. A usable hosting account or the current frontend project URLs/access is required. No frontend deployment was created.
4. Once frontend URLs exist, configure exact `CONSOLE_URL`, `ARCADE_URL`, and `ALLOWED_ORIGINS`. Enable `NEXT_PUBLIC_API_PROXY=true` on both frontend builds with the backend's HTTPS `NEXT_PUBLIC_API_URL`, then switch the backend to host-only `SameSite=Lax` cookies. Recheck realtime connections directly to the backend.
5. Before restoring historical data, follow `financial-workflow-review.sql`. Old incomplete posted rounds and approved redemptions missing original payable snapshots fail closed for reviewed recovery. Historical public receipt copies require a private replacement and retention review. Preserve the original MFA encryption secret when importing existing MFA users; the new Render JWT refresh secret is for a fresh deployment.

## Operational limits

Free Render sleeps when idle, pausing the colocated worker, and free Redis is ephemeral. These plans do not provide continuous worker availability or durable Redis state. Reconciliation scheduling restores itself after Redis loss. Access JWTs retain their existing maximum 15-minute validity after logout; account status is checked on authenticated requests. Frontend CSP currently restricts framing, base URLs, and form destinations; a nonce-based resource policy is not implemented. Compliance provider integrations remain the repository's configured stubs/manual workflow.

No test or dependency audit proves that an entire platform is secure. Production acceptance still requires the missing configuration, historical-data review where applicable, and verification against the actual deployed services.
