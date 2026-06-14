# 01 - System Architecture

How the pieces fit, how they deploy, how requests and money flow, and the security model. Money mechanics live in `docs/03`; this is the infrastructure skeleton.

---

## 1. Component map

```
                         ┌───────────────────────────────────┐
                         │            Cloudflare              │
                         │   (DNS, WAF, CDN for assets/R2)    │
                         └───────────────┬───────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         │                               │                               │
┌────────▼─────────┐          ┌──────────▼──────────┐         ┌──────────▼──────────┐
│  arcade (Vercel) │          │  console (Vercel)   │         │   R2 (assets/KYC)   │
│  Next.js PWA     │          │  Next.js back-office│         │   Cloudflare        │
│  players         │          │  operators          │         └─────────────────────┘
└────────┬─────────┘          └──────────┬──────────┘
         │  HTTPS + WSS                   │  HTTPS + WSS
         └───────────────┬───────────────┘
                         │
              ┌───────────▼────────────┐
              │      api (Railway)      │   NestJS
              │  REST + Socket.io       │
              │  guards, services       │
              └───┬───────────┬─────┬───┘
                  │           │     │
       ┌──────────▼──┐  ┌─────▼───┐ │  ┌────────────────────────┐
       │ PostgreSQL  │  │  Redis  │ └─▶│  workers (Railway)      │
       │ (Railway)   │  │ cache   │    │  BullMQ consumers       │
       │ Prisma      │  │ locks   │    │  (settlements, AML,     │
       │             │  │ pub/sub │    │   reports, outbox relay)│
       └─────────────┘  └─────────┘    └────────────────────────┘
```

Two runtime processes share the `apps/api` codebase: the **web process** (HTTP + sockets) and the **worker process** (BullMQ consumers). Same image, different entrypoint (`main.ts` vs `worker.ts`). Railway runs them as two services.

---

## 2. Backend module structure (NestJS)

One module per domain. Each owns its controllers, services, DTOs, and guards.

```
apps/api/src/
├── main.ts                 web entrypoint (HTTP + Socket.io)
├── worker.ts               BullMQ worker entrypoint
├── app.module.ts
├── common/                 guards, filters, pipes, decorators, zod pipe
├── auth/                   login, refresh, MFA, password, sessions (operator + player)
├── operators/              the tree: create node, move, suspend, settings, pricing
├── players/                create player, profile, status, transfer ownership
├── ledger/                 LedgerService (the heart), accounts, transactions, queries
├── orders/                 CreditOrder lifecycle (offline credit purchases)
├── wallet/                 player wallet ops: recharge, balance, history
├── games/                  game catalog, sessions, RGS provider, rounds
├── redemptions/            redemption requests + approval workflow + settlement
├── compliance/             kyc, geo, responsible-gaming, aml, self-exclusion
├── audit/                  append-only audit log writer + query
├── reports/               aggregations, exports
├── realtime/               Socket.io gateway, room management, event fan-out
├── outbox/                 transactional outbox + relay to realtime/webhooks
└── notifications/          in-app + (later) email/SMS
```

### Why these boundaries
- `ledger` is isolated so nothing writes balances directly. Other modules call `LedgerService.post(...)`.
- `compliance` is isolated so its checks are easy to find, test, and audit. Other modules call into it at decision points (before recharge, before redeem, before play, before login from a region).
- `outbox` exists so domain events (balance changed, redemption approved) are written **in the same DB transaction** as the state change, then relayed reliably to sockets and webhooks. No lost realtime updates, no dual-write races.

---

## 3. Request lifecycle

1. Next.js app calls the API with a short-lived JWT access token (Authorization header) or, for the player PWA, an httpOnly cookie.
2. NestJS `AuthGuard` validates the token, loads the principal (operator `User` or `Player`), attaches it to the request.
3. `ScopeGuard` (operator routes) resolves the caller's subtree path and asserts any target operator/player ID is inside it. See `docs/04`.
4. A zod `ValidationPipe` parses the body/query into a typed DTO.
5. The controller calls a service. Money-moving services open a `prisma.$transaction`, take row locks, post ledger entries, write an outbox event, commit.
6. The exception filter maps domain errors to HTTP codes. The outbox relay (worker) pushes the event to the right Socket.io rooms.

---

## 4. Auth model

Two separate principals with separate guards and token audiences. Never mix them.

### Operator side (console)
- `User` row, login by email or username + password (argon2id hash).
- Optional TOTP MFA, required for `SUPER_ADMIN` and `ADMIN`.
- Access token (JWT, 15 min, `aud: "operator"`) + refresh token (opaque, 30 days, rotating, stored hashed in `RefreshToken`, sent as httpOnly secure cookie).
- Refresh rotation with reuse detection: if a refresh token is presented twice, revoke the whole session family (token theft response).
- Sessions are revocable from the console (admin can kill an operator's sessions).

### Player side (arcade)
- `Player` row, login by username + password (the agent sets the initial password when creating the player, exactly like the real platforms; player can change it).
- Access token (JWT, 15 min, `aud: "player"`) + refresh (same rotating scheme), httpOnly cookie.
- Players cannot reach any console route. The `aud` claim plus separate guards enforce this.

### Token claims
```
{ sub, aud: "operator"|"player", tier?, operatorId?, sessionId, iat, exp }
```
Do not put the subtree path in the token (it can change). Resolve it per request from the DB/cache.

---

## 5. Realtime (Socket.io)

Used for: live balance updates, redemption status changes, order status changes, new-player and recharge notifications to agents, and (later) live game state.

### Rooms
- `player:{playerId}` — that player's wallet/redemption updates.
- `operator:{operatorId}` — that operator's own events.
- `subtree:{operatorId}` — events from anywhere in the operator's branch (agents subscribe to their players; distributors to their agents). Implement by emitting to each ancestor's `operator:{id}` room, or maintain `subtree:` rooms keyed by ancestor. Use the materialized path to fan out to ancestors. Keep fan-out depth-bounded.
- `admin:global` — platform-wide firehose for super admin dashboards (throttled/sampled).

### Flow
Domain change → outbox row (same txn) → relay worker reads outbox → emits to rooms → marks outbox row sent. Clients also reconcile on reconnect by refetching, so a missed socket event is never load-bearing.

Authenticate the socket handshake with the same JWT; join only rooms the principal is allowed in (a player joins only its own room; an operator joins its own and its subtree rooms).

---

## 6. Caching and locks (Redis)

- **Cache**: operator subtree paths, game catalog, platform settings, player wallet snapshots (short TTL, invalidate on write).
- **Locks**: distributed lock per ledger account during a money operation as a second line of defense behind DB row locks (key `lock:ledger:{accountId}`, short TTL, Redlock-style). DB `SELECT ... FOR UPDATE` is the source of truth; Redis lock reduces lock contention and protects against multi-instance stampedes.
- **Rate limiting**: per-IP and per-principal counters for login, recharge, redeem, and order endpoints.
- **Pub/sub**: Socket.io Redis adapter so realtime works across multiple API instances.

---

## 7. Background jobs (BullMQ)

| Queue | Trigger | Job |
|---|---|---|
| `outbox-relay` | interval + on-write | push unsent outbox events to sockets/webhooks |
| `aml-scan` | on transaction post | run velocity/structuring rules, raise `AmlFlag` |
| `settlement` | on order paid / redemption settled | update `Settlement` running balances between operators |
| `reports` | schedule + on-demand | precompute daily rollups, generate CSV/PDF exports to R2 |
| `rg-enforcement` | on play/recharge | evaluate responsible-gaming limits, apply cooldowns |
| `notifications` | various | deliver in-app and (later) email/SMS |
| `kyc-poll` | on submit | poll KYC provider stub, update `KycRecord` |

Idempotent consumers, retries with backoff, dead-letter queue for poison jobs.

---

## 8. Security model

- **Subtree isolation is the core boundary.** Enforced twice: a `ScopeGuard` on controllers and a Prisma middleware that injects `path LIKE '{callerPath}%'` on operator/player reads. A bug in one is caught by the other.
- **Least privilege per tier** via a permission matrix (`docs/04`). Sensitive actions (mint credits, change RTP, adjust balances, change platform mode) are `SUPER_ADMIN` only and always audited.
- **Every privileged action writes an `AuditLog`** with actor, target, before/after, IP, user agent. Append-only.
- **Balance integrity**: ledger invariant checks run as a scheduled job (sum of all entries per currency == 0; cached balances == derived balances). Any drift pages the operator.
- **Idempotency** on all money endpoints prevents double-charges on retries/double-clicks.
- **Secrets** via Railway/Vercel env, never committed. JWT signing keys rotated; support a key id (`kid`) for rotation.
- **PII / KYC docs** stored in R2 with signed, expiring URLs and a private bucket. Restrict who can fetch them; log every access.
- **Input validation** with zod at every boundary. Output DTOs whitelist fields (never return password hashes, internal flags, or another subtree's data).
- **CORS** locked to the known frontend origins. Sockets same.
- **Anti-abuse on play**: server authoritative outcomes only. The client never sends a win amount; it sends a bet, the RGS decides. See `docs/05`.

---

## 9. Environments

- `local` — docker-compose for Postgres + Redis, apps run with `pnpm dev`.
- `staging` — Railway + Vercel preview, separate DB, compliance providers in stub mode, seeded demo tree.
- `production` — Railway + Vercel, managed Postgres with PITR backups, Redis with persistence, R2 buckets.

Run migrations on deploy (`prisma migrate deploy`) as a release step, not at app boot.

---

## 10. `.env.example`

```dotenv
# --- core ---
NODE_ENV=development
PLATFORM_MODE=OPERATOR          # OPERATOR | COMPLIANCE
DATABASE_URL=postgresql://aureus:aureus@localhost:5432/aureus
REDIS_URL=redis://localhost:6379

# --- auth ---
JWT_ACCESS_SECRET=change-me
JWT_ACCESS_TTL=900              # seconds
JWT_REFRESH_TTL=2592000         # seconds
JWT_KID=key-1
COOKIE_DOMAIN=localhost
ARGON2_MEMORY_KIB=19456

# --- urls / cors ---
API_URL=http://localhost:4000
CONSOLE_URL=http://localhost:3000
ARCADE_URL=http://localhost:3001
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# --- money ---
CREDIT_MINOR_UNITS=1000         # 1 credit = 1000 minor units (3 dp)
DEFAULT_GAME_RTP_BPS=9400       # 94.00%

# --- storage ---
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_ASSETS=aureus-assets
R2_BUCKET_KYC=aureus-kyc

# --- compliance (stub providers in dev) ---
KYC_PROVIDER=stub               # stub | <real provider>
GEO_PROVIDER=stub
AML_ENABLED=true
SELF_EXCLUSION_ENABLED=true
REDEMPTION_KYC_THRESHOLD_MINOR=50000   # require KYC above this redeem amount

# --- realtime / workers ---
SOCKET_ADAPTER=redis
OUTBOX_RELAY_INTERVAL_MS=1000
```

Validate this file with a zod schema at boot in `packages/shared/env.ts`; fail fast if anything required is missing.

---

## 11. Observability

- Structured JSON logs (pino), request id + principal id on every line.
- Health checks: `/healthz` (liveness), `/readyz` (DB + Redis reachable).
- Metrics worth tracking from day one: ledger post latency, failed money txns, redemption queue depth, outbox lag, AML flags raised, login failures. Wire to whatever Railway exposes plus a metrics endpoint.
- Error tracking (Sentry or similar) on all three apps.

---

## 12. Scaling notes (not day one, but design for it)

- API web process is stateless; scale horizontally behind Railway. Sockets scale via the Redis adapter.
- The ledger is the contention point. Keep transactions short, lock only the accounts involved, order lock acquisition by account id to avoid deadlocks, and consider sharding the `MINT`/`REVENUE` hot system accounts into N sub-accounts if write volume demands it (sum them for reporting).
- Reads scale with a read replica for reports; keep money writes on the primary.
- Partition `LedgerEntry` and `AuditLog` by month once they get large.
