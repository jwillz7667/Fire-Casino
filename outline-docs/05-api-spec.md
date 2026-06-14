# 05 - API Specification

REST endpoints grouped by module, the Socket.io event catalog, and the RGS (game server) contract that the placeholder games implement. All bodies/queries validated by zod (`packages/shared/schemas`). All money fields are `BigInt` serialized as decimal strings of minor units... actually as **integer strings of minor units** (e.g. `"1500000"` = 1500 credits at 1000 minor units). Format for display happens client-side via `fromMinor`.

Conventions:
- Base path `/api/v1`.
- Auth: `Authorization: Bearer <accessToken>` or httpOnly cookie (arcade). `aud` claim must match the surface (`operator` for `/console/*` and shared, `player` for `/arcade/*`).
- Money mutations require `Idempotency-Key: <uuid>` header.
- Errors: `{ error: { code, message, details? } }` with appropriate HTTP status. Codes are stable strings (`INSUFFICIENT_FUNDS`, `OUT_OF_SCOPE`, `KYC_REQUIRED`, `REGION_BLOCKED`, `SELF_EXCLUDED`, `RG_LIMIT_EXCEEDED`, `IDEMPOTENT_REPLAY` returns the original 200, etc.).
- List endpoints: cursor pagination `?cursor=&limit=` returning `{ items, nextCursor }`.

---

## 1. Auth (`/auth`)

Operator and player auth share routes but differ by a `surface` discriminator and separate guards.

| Method | Path | Who | Body / Notes |
|---|---|---|---|
| POST | `/auth/operator/login` | public | `{ identifier, password, totp? }` → sets refresh cookie, returns access token + operator summary |
| POST | `/auth/player/login` | public | `{ username, password }` → region check on login; sets refresh cookie, returns access token + wallet summary |
| POST | `/auth/refresh` | cookie | rotates refresh, returns new access token; reuse → revoke family |
| POST | `/auth/logout` | auth | revokes current session |
| POST | `/auth/password/change` | auth | `{ currentPassword, newPassword }` |
| POST | `/auth/operator/mfa/enable` | operator | returns TOTP secret + otpauth URL; confirm with `/mfa/confirm` |
| POST | `/auth/operator/mfa/confirm` | operator | `{ totp }` |
| GET | `/auth/me` | auth | current principal + permissions (operator) or wallet (player) |

---

## 2. Operators / tree (`/operators`) — operator surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/operators` | `operator.create_child` | `{ tier, displayName, username, tempPassword, buyUnitPriceCents?, sellUnitPriceCents?, settings? }` → creates User+Operator+ledger account in caller's subtree, one tier below |
| GET | `/operators` | `operator.view_subtree` | list direct children (`?parentId=`) or whole subtree (`?scope=subtree`), scoped |
| GET | `/operators/:id` | scope | one node (must be in subtree) |
| GET | `/operators/:id/tree` | scope | nested subtree for the org chart view |
| PATCH | `/operators/:id` | `operator.*` | update displayName, pricing, settings (within scope) |
| POST | `/operators/:id/suspend` | `operator.suspend` | freezes node + subtree |
| POST | `/operators/:id/activate` | `operator.suspend` | unfreeze |
| POST | `/operators/:id/close` | `operator.suspend` | terminal; requires zero balance |
| GET | `/operators/:id/balance` | scope | ledger balance(s) |
| GET | `/operators/:id/stats` | `report.view` | rollups: active players, credits in circulation below this node, GGR, redemptions |

---

## 3. Credits & orders (`/orders`, `/credits`)

The offline-purchase + issuance flow (no processor).

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/orders` | `order.request_up` | a child requests credits from its upline: `{ quantityMinor, note? }`. Status `REQUESTED`. Seller = caller's parent |
| GET | `/orders` | scope | inbox (`?role=seller`) / outbox (`?role=buyer`), filter by status |
| GET | `/orders/:id` | scope | one order |
| POST | `/orders/:id/awaiting-payment` | `order.fulfill` | seller acknowledges, awaiting offline payment |
| POST | `/orders/:id/mark-paid` | `order.fulfill` | seller marks cash received: `{ paymentMethod, paymentRef?, proofUrl? }` |
| POST | `/orders/:id/issue` | `order.fulfill` / `credit.transfer_down` | fulfills: posts `TRANSFER` (or `ISSUE` if seller is super admin/mint). Idempotent on `order:{id}:issue` |
| POST | `/orders/:id/cancel` | scope | cancel before issue |
| POST | `/credits/issue` | `credit.mint` | super admin direct mint to an operator: `{ operatorId, quantityMinor, memo }` → `ISSUE` |
| POST | `/credits/transfer` | `credit.transfer_down` | direct push to a direct child: `{ toOperatorId, quantityMinor, unitPriceCents?, memo }` → `TRANSFER` |

---

## 4. Players (`/players`) — operator surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/players` | `player.create` (STORE) | `{ username, tempPassword, displayName?, phone?, email? }` → Player + wallet |
| GET | `/players` | scope | list players in subtree (`?operatorId=&status=&q=`) |
| GET | `/players/:id` | scope | profile + wallet + KYC status + flags |
| PATCH | `/players/:id` | `player.*` | update profile/status |
| POST | `/players/:id/suspend` | `player.suspend` | |
| POST | `/players/:id/reset-password` | `player.*` | agent sets a new temp password |
| POST | `/players/:id/transfer` | admin | `{ toOperatorId }` reassign owning agent |
| GET | `/players/:id/history` | scope | unified timeline: recharges, sessions, redemptions, ledger entries |

---

## 5. Wallet & recharge (`/wallet`)

Operator surface for recharge; player surface for read + requests.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/wallet/recharge` | operator (`player.recharge`) | `{ playerId, amountMinor, unitPriceCents?, note? }` → runs compliance checks then `RECHARGE` (and prize bonus in compliance mode). Idempotency-Key required |
| GET | `/wallet` | player | own balances (PLAY/PRIZE or CREDIT) + reserved |
| GET | `/wallet/history` | player | own ledger entries, paginated |
| POST | `/wallet/recharge-request` | player | player asks their agent to load credits: `{ amountMinor, note? }` → notifies agent (no money yet) |

---

## 6. Games (`/games`) — catalog + play

Catalog is operator-configured; play is player surface. Games themselves are stubbed (see §10).

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/games` | player/operator | active catalog (filtered by what the player's branch allows), sorted |
| GET | `/games/:code` | player/operator | one game's metadata |
| POST | `/games` | `game.configure` | create catalog entry: `{ code, name, type, rtpBps, minBetMinor, maxBetMinor, supportedCurrencies, thumbnailUrl?, config? }` |
| PATCH | `/games/:id` | `game.configure` | update; RTP override within bounds (`game.rtp_override`) |
| POST | `/games/:id/status` | `game.configure` | ACTIVE/HIDDEN/MAINTENANCE |
| POST | `/sessions` | player | start a session: `{ gameCode, currency, clientSeed? }` → returns `{ sessionId, serverSeedHash }` |
| POST | `/sessions/:id/bet` | player | place a round: `{ betMinor }` + Idempotency-Key. Server calls RGS, posts ledger, returns `{ round, balanceAfter }` |
| POST | `/sessions/:id/end` | player | end session → reveals `serverSeed` for verification |
| GET | `/sessions/:id` | player/scope | session detail + rounds |

---

## 7. Redemptions (`/redemptions`)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/redemptions` | player | `{ amountMinor, method, payoutDetails? }` → compliance gate (KYC threshold, region, RG, AML, self-exclusion), pending-redemption balance check; status `PENDING` |
| GET | `/redemptions` | player | own requests |
| GET | `/redemptions/queue` | operator (`redemption.approve`) | approval queue scoped to subtree, filter by status |
| GET | `/redemptions/:id` | scope/owner | one request |
| POST | `/redemptions/:id/approve` | `redemption.approve` | posts `REDEEM_HOLD` (burn prize→clearing). Idempotent |
| POST | `/redemptions/:id/reject` | `redemption.approve` | `{ reason }`; no ledger move if not yet held |
| POST | `/redemptions/:id/settle` | `redemption.settle` | offline cash paid: `{ payoutRef, proofUrl? }` → `REDEEM_SETTLE` (clearing→mint), close |
| POST | `/redemptions/:id/cancel` | `redemption.approve`/owner | if held, posts `REDEEM_CANCEL` (return to player) |

---

## 8. Compliance (`/compliance`) — admin surface

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST/DELETE | `/compliance/geo` | `compliance.manage` | manage `GeoRule`s (allow/block regions) |
| POST | `/compliance/players/:id/kyc/submit` | player or agent | upload ID → R2 private, status `PENDING` |
| POST | `/compliance/players/:id/kyc/decision` | `compliance.manage` | verify/reject |
| GET | `/compliance/kyc/queue` | `compliance.manage` | pending KYC |
| GET/POST | `/compliance/players/:id/rg-limits` | player/admin | responsible-gaming limits |
| POST | `/compliance/players/:id/self-exclude` | player/admin | `{ until? }` |
| GET | `/compliance/aml/flags` | `compliance.manage` | flags queue, filter severity/status |
| POST | `/compliance/aml/flags/:id/resolve` | `compliance.manage` | clear/escalate |
| GET | `/compliance/check` | server-internal | helper the other modules call (not public): `checkDeposit`, `checkPlay`, `checkRedeem`, `checkLogin(region)` |

---

## 9. Reports, audit, settings, realtime token

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/reports/overview` | `report.view` | scoped KPIs: circulation, GGR, active players, redemption volume, margin |
| GET | `/reports/credit-flow` | `report.view` | issues/transfers/recharges over time, by node |
| GET | `/reports/redemptions` | `report.view` | redemption pipeline + settlement status |
| GET | `/reports/ledger-health` | `SUPER_ADMIN`/`ADMIN` | reconciliation results (§7 of docs/03) |
| POST | `/reports/export` | `report.view` | enqueue CSV/PDF export → R2, returns job id |
| GET | `/audit` | `audit.view` | filter by actor/target/action/time, scoped |
| GET/PUT | `/settings/platform` | `platform.settings` | mode, thresholds, currency config |
| POST | `/realtime/token` | auth | short-lived socket auth token bound to principal + allowed rooms |

---

## 10. The RGS contract (placeholder games)

Games are not built. The arcade renders a generic placeholder game screen; the server decides outcomes through a `GameProvider` interface. A real game later implements the same interface and renders its own client without changing the API, ledger, or schema.

### Interface (`apps/api/src/games/rgs/provider.ts`)

```ts
export interface RoundRequest {
  sessionId: string;
  gameCode: string;
  rtpBps: number;           // from Game, possibly operator-overridden within bounds
  betMinor: bigint;
  currency: Currency;
  serverSeed: string;       // revealed at session end
  clientSeed: string;
  nonce: number;            // round index in session
  config: Record<string, unknown>;  // Game.config
}

export interface RoundResult {
  winMinor: bigint;         // 0 or positive
  outcome: Record<string, unknown>;  // opaque payload stored on GameRound, rendered by the game client
}

export interface GameProvider {
  play(req: RoundRequest): Promise<RoundResult>;
}
```

### Server-authoritative play flow (`POST /sessions/:id/bet`)
1. Validate: session active, player active, bet within `[minBet, maxBet]`, wallet ≥ bet, currency supported, RG/exclusion checks pass.
2. Compute `nonce = lastNonce + 1`.
3. Post `GAME_BET` (idempotent on `round:{sessionId}:{nonce}:bet`). If this replays, return the existing round.
4. Call `provider.play(req)`.
5. If `winMinor > 0`, post `GAME_WIN` (idempotent on `round:{sessionId}:{nonce}:win`).
6. Persist `GameRound` with `betTxId`/`winTxId`/`outcome`, update session totals.
7. Return `{ round, balanceAfterMinor }`. Emit `balance.changed`.

The client **never** sends a win amount and never decides the result. It sends a bet; the server returns the outcome.

### Provable fairness (works for the stub too)
- At session start: server generates `serverSeed`, stores only `sha256(serverSeed)` as `serverSeedHash`, returns the hash. Client may supply `clientSeed`.
- Each round's RNG is `HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`)` → a uniform value used to pick the outcome.
- At session end, server reveals `serverSeed`. The player (or a verifier) can confirm `sha256(serverSeed) == serverSeedHash` and recompute each round's RNG. This makes the placeholder behave like a real, auditable game engine.

### `PlaceholderRgsProvider` algorithm
Honors RTP without building real game math:

```ts
play(req): RoundResult {
  const r = uniform01(hmac(req.serverSeed, `${req.clientSeed}:${req.nonce}`)); // 0..1
  // Target average payout = RTP. Use a simple distribution that returns to RTP over time.
  // Example: with probability p, pay a multiple m such that E[payout] = RTP * bet.
  // Pick a small prize table whose expectation equals rtp:
  //   e.g. {mult:0, p:1-q}, {mult:2x..50x, ...} tuned so sum(p*mult) == rtpBps/10000.
  const winMult = pickFromTunedTable(r, req.rtpBps);     // returns 0 or a multiplier
  const winMinor = (req.betMinor * BigInt(Math.round(winMult * 100))) / 100n;
  return { winMinor, outcome: { kind: 'placeholder', r, winMult, demo: true } };
}
```

Provide a few tuned tables per `GameType` so different placeholder games "feel" different (a slot-like high-variance table, a fish-like steadier table) while all converging to their configured RTP. Mark every outcome `demo: true` so it's obvious these aren't real games.

### Dropping in a real game later
Implement `GameProvider` for the real game (server-side math or a call to a real RGS), register it by `gameCode`, and build that game's client to render `outcome`. The bet/win/ledger/seed flow is unchanged. Nothing in money, scope, or schema moves.

---

## 11. Socket.io event catalog

Client→server: only `subscribe`/`unsubscribe` to allowed rooms (validated against principal scope). All state changes come from the server.

Server→client events (payloads are small; clients refetch detail as needed):

| Event | Room(s) | Payload | Meaning |
|---|---|---|---|
| `balance.changed` | `player:{id}`, `operator:{id}` | `{ currency, balanceMinor }` | wallet/operator balance moved |
| `order.updated` | `operator:{buyer}`, `operator:{seller}` | `{ orderId, status }` | credit order moved through its workflow |
| `recharge.requested` | `operator:{agentId}` | `{ playerId, amountMinor }` | a player asked to be loaded |
| `player.created` | `operator:{agentId}` | `{ playerId }` | (mostly for multi-seat agents) |
| `redemption.updated` | `player:{id}`, `operator:{ownerId}` | `{ requestId, status }` | redemption moved |
| `redemption.queued` | `operator:{approverId}` | `{ requestId, amountMinor }` | new request needs approval |
| `aml.flagged` | `admin:global` | `{ flagId, severity }` | new AML flag |
| `announcement` | `player:*` / scoped | `{ id, title }` | new announcement |
| `session.round` | `player:{id}` | `{ sessionId, nonce, winMinor }` | round result (also returned by the bet call; socket is for multi-device sync) |

Every realtime event originates from an `OutboxEvent` written in the same DB transaction as the change, then relayed (`docs/01` §5). Clients reconcile on reconnect, so a dropped socket never causes incorrect state.

---

## 12. Validation & DTO sharing

Define every request/response schema once in `packages/shared/schemas` with zod, infer TypeScript types from them, and import in both the NestJS DTOs (via a zod validation pipe) and the Next.js client fetchers. One source of truth for the API contract. Money fields use a `zMinor` schema that accepts an integer string and transforms to `BigInt`.
