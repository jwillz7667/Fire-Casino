# Fire Casino migration and security verification

Verified locally on 2026-10-17. These results apply to the implementation in this branch; they do not establish that the new production deployment is healthy.

## Completed

- Reconfigured the new Render service with independently generated 64-byte JWT access and refresh secrets, HTTPS API URL, secure host-only SameSite=Lax cookies, exact console/arcade origins, and production mode. Redis is configured privately. A separate 64-byte server-only proxy secret is shared by the API and both frontends. No credentials are committed or included here.
- Deployed both free Render frontends: [console](https://fire-casino-console.onrender.com/login) and [arcade](https://fire-casino-arcade.onrender.com/login). Both login pages respond successfully with security headers. Their API calls remain blocked by the backend's missing database/storage configuration.
- Made refresh rotation/revocation atomic, separated operator/player refresh cookies, made expired-access logout revoke the selected refresh family, enforced auth origins, and protected enrolled MFA and privileged realtime connections.
- Made orders, credit transfers, recharges, paired PLAY/PRIZE grants, redemptions, and game rounds commit their ledger movements and associated workflow bookkeeping atomically. Player locks serialize responsible-gaming deposit decisions. Retries preserve the original payable, bonus, and posted outcome.
- Kept financial proofs and KYC documents private, validated ownership, added scoped signed receipt previews, and surfaced upload failures.
- Isolated frontend account caches, restricted game iframe messages by source and origin, renewed realtime tokens, and added optional same-origin HTTP forwarding for browsers that block third-party cookies.
- Forwarded only Render's ingress-verified single client IP across that proxy, authenticated by the server-only shared secret. Invalid assertions are stripped. IP throttling runs before JWT verification and separate principal throttling runs afterward; public auth is counted once. Original rate limits remain in place.
- Added separate migration credentials, a restricted runtime-role SQL template, a safe single-admin initializer, and non-root container execution. Production demo seeding is refused.
- Updated vulnerable dependencies, including Next.js, NestJS, Socket.IO, and Vitest. Both the production and complete dependency audits report zero known advisories.

## Validation

- API: the complete 316-test suite in 41 files passes against dedicated local PostgreSQL and Redis. The fractional-transfer correction also passes 35 focused integration tests, including new fractional-price and overflow cases. A further 53 focused API tests cover proxy assertions, active rate limits, auth, logging, and guard ordering. This includes money invariants, concurrency, rollback, authorization, refresh replay, MFA, private-document scope, readiness, worker recovery, and game simulations. Plinko retains its original statistical sample and tolerances with an explicit 120-second budget.
- Shared contracts: the original 47 tests and 10 focused environment tests pass. Frontends: 70 tests pass, including direct/proxied HTTP configuration and trusted-IP middleware. Bootstrap: all 11 tests pass against a separate disposable database. Supervisor: all eight subprocess tests pass.
- API, worker, database package, shared package, and both Next.js production builds pass. Workspace lint and typechecks pass. The Node 22 Docker image builds and starts both backend processes as UID 1000, applies all migrations to a separate fresh test database, and returns healthy PostgreSQL/Redis readiness.
- All 19 database migrations apply on fresh local PostgreSQL 16. Restricted-role verification confirms immutable history cannot be updated/deleted, and the runtime role cannot truncate tables, change triggers, create schema objects, or access migration bookkeeping.
- GitHub CI passed on commit `29cedd4`, including migrations, tests, lint, typechecks, and production builds. The test task explicitly forwards the disposable test database URL; it never falls back to a live database.
- Chromium verified operator login/MFA, independent console/player refresh, console sections, player wallet/account screens, mint → transfer → recharge → play → redeem, idempotent bets, balanced ledger transactions, untrusted-origin denial, and the Wheel iframe/WASM client. The same flow passes through the same-origin proxy, including preserved `no-store` headers and logout after access expiry without affecting the other surface. Browser errors and failed network requests: zero. All 36 configured game asset objects were also checked successfully.
- Local browser and storage fixtures use isolated test data. Real R2 upload/read permissions have not been verified.
- Frontend production assets contain neither the proxy secret nor its environment-variable name. Runtime checks confirm response headers/bodies expose no proxy proof or middleware request-override metadata.

## Production blockers

1. The new Render service has no `DATABASE_URL`. The Neon project must be claimed in the owner's account and its direct PostgreSQL connection URL added securely in Render. Existing Railway data has not been copied; no source database access is available.
2. Real `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and the actual bucket names remain required. `R2_BUCKET_KYC` must be private and distinct from the assets bucket. Configure bucket CORS for the exact deployed frontend origins and verify uploads plus signed reads.
3. Once those secrets are present, deploy the backend and verify actual uploads, signed reads, refresh cookies, realtime connections, and worker processing against all three deployed services. The frontend login pages being available does not establish platform functionality.
4. Before restoring historical data, follow `financial-workflow-review.sql`. Old incomplete posted rounds and approved redemptions missing original payable snapshots fail closed for reviewed recovery. Historical public receipt copies require a private replacement and retention review. Preserve the original MFA encryption secret when importing existing MFA users; the new Render JWT refresh secret is for a fresh deployment.

## Operational limits

Render's 750 free web-service hours are shared across the workspace. Three continuously awake services exceed that allowance; other workspace services also consume it. Free services sleep after inactivity, pausing the colocated worker, and free Redis is ephemeral. These plans do not provide continuous worker availability or durable Redis state. Reconciliation scheduling restores itself after Redis loss. Access JWTs retain their existing maximum 15-minute validity after logout; account status is checked on authenticated requests. Frontend CSP currently restricts framing, base URLs, and form destinations; a nonce-based resource policy is not implemented. The embedded Godot client has an upstream service-worker warning when browser third-party storage is blocked; rendering and real bet callbacks were verified, but embedded offline/PWA caching was not. Compliance provider integrations remain the repository's configured stubs/manual workflow.

No test or dependency audit proves that an entire platform is secure. Production acceptance still requires the missing configuration, historical-data review where applicable, and verification against the actual deployed services.
