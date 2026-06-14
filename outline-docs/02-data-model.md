# 02 - Data Model

The complete Prisma schema lives in `packages/db/prisma/schema.prisma`. This doc is that schema plus the reasoning. Money flows that use these tables are in `docs/03`; permissions in `docs/04`.

## Conventions

- All money is `BigInt` minor units. `CREDIT_MINOR_UNITS=1000` means 1 credit = 1000 minor units.
- Soft delete via `status` enums, not row deletion, for anything financial or audited.
- Timestamps: `createdAt`/`updatedAt` everywhere. Money and audit rows are immutable after insert (except status transitions on workflow tables).
- IDs: `cuid()` strings.
- Materialized path on operators for subtree queries (`path` like `1.4.12`, dot-separated cuids or sequence — use a short sequential `code` per node so paths stay compact; see `Operator.pathSegment`).

---

## The schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// PLATFORM CONFIG
// ============================================================

model PlatformSetting {
  key       String   @id            // e.g. "PLATFORM_MODE", "REDEMPTION_THRESHOLDS"
  value     Json
  updatedAt DateTime @updatedAt
  updatedBy String?                 // User id
  @@map("platform_settings")
}

// ============================================================
// IDENTITY & AUTH (operator side)
// ============================================================

model User {
  id            String     @id @default(cuid())
  email         String?    @unique
  username      String     @unique
  passwordHash  String
  mfaSecret     String?                       // TOTP, encrypted at rest
  mfaEnabled    Boolean    @default(false)
  status        UserStatus @default(ACTIVE)
  lastLoginAt   DateTime?
  operator      Operator?                      // 1:1 — the tree node this login controls
  refreshTokens RefreshToken[]
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  @@map("users")
}

enum UserStatus { ACTIVE SUSPENDED LOCKED }

model RefreshToken {
  id          String   @id @default(cuid())
  userId      String?
  playerId    String?
  tokenHash   String   @unique
  familyId    String                          // rotation family, for reuse detection
  audience    TokenAudience
  expiresAt   DateTime
  revokedAt   DateTime?
  replacedBy  String?
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())
  user        User?    @relation(fields: [userId], references: [id])
  @@index([userId])
  @@index([playerId])
  @@index([familyId])
  @@map("refresh_tokens")
}

enum TokenAudience { OPERATOR PLAYER }

// ============================================================
// DISTRIBUTION TREE
// ============================================================

model Operator {
  id           String        @id @default(cuid())
  userId       String        @unique
  user         User          @relation(fields: [userId], references: [id])
  tier         OperatorTier
  displayName  String
  status       OperatorStatus @default(ACTIVE)

  // hierarchy (materialized path)
  parentId     String?
  parent       Operator?     @relation("OperatorTree", fields: [parentId], references: [id])
  children     Operator[]    @relation("OperatorTree")
  pathSegment  Int                              // unique small int among siblings, assigned on create
  path         String                           // e.g. "1.7.23" — ancestors' pathSegments + own
  depth        Int                              // 0 = super admin

  // pricing (for margin reporting only; ledger moves raw units)
  buyUnitPriceCents  Int?                        // what this operator pays its upline per credit
  sellUnitPriceCents Int?                        // default price this operator charges its children/players

  // settings (per-operator config: allowed games, recharge limits, redemption approval rights, etc.)
  settings     Json          @default("{}")

  players      Player[]
  ledgerAccounts LedgerAccount[]
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@index([parentId])
  @@index([path])
  @@index([tier])
  @@map("operators")
}

enum OperatorTier {
  SUPER_ADMIN
  ADMIN
  MASTER_DISTRIBUTOR
  DISTRIBUTOR
  SUB_DISTRIBUTOR
  STORE            // the retail agent that deals with players
}

enum OperatorStatus { ACTIVE SUSPENDED CLOSED }

// ============================================================
// PLAYERS
// ============================================================

model Player {
  id            String       @id @default(cuid())
  operatorId    String                          // owning store/agent
  operator      Operator     @relation(fields: [operatorId], references: [id])
  username      String       @unique
  passwordHash  String
  displayName   String?
  phone         String?
  email         String?
  status        PlayerStatus @default(ACTIVE)

  kyc           KycRecord?
  wallets       LedgerAccount[]
  sessions      GameSession[]
  redemptions   RedemptionRequest[]
  rgLimits      ResponsibleGamingLimit[]
  selfExclusion SelfExclusion?

  lastLoginAt   DateTime?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([operatorId])
  @@index([status])
  @@map("players")
}

enum PlayerStatus { ACTIVE SUSPENDED SELF_EXCLUDED CLOSED }

// ============================================================
// LEDGER (double-entry) — see docs/03
// ============================================================

model LedgerAccount {
  id          String          @id @default(cuid())
  ownerType   LedgerOwnerType
  operatorId  String?
  operator    Operator?       @relation(fields: [operatorId], references: [id])
  playerId    String?
  player      Player?         @relation(fields: [playerId], references: [id])
  systemKey   SystemAccount?                    // set when ownerType = SYSTEM
  currency    Currency
  balanceMinor BigInt         @default(0)        // cached balance, updated atomically with entries
  version     Int             @default(0)        // optimistic lock
  entries     LedgerEntry[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  @@unique([ownerType, operatorId, playerId, systemKey, currency])
  @@index([operatorId])
  @@index([playerId])
  @@index([systemKey])
  @@map("ledger_accounts")
}

enum LedgerOwnerType { OPERATOR PLAYER SYSTEM }

enum SystemAccount {
  MINT                 // source of all issued credits (goes unbounded negative)
  REVENUE              // house edge / rake sink
  REDEMPTION_CLEARING  // burned prize credits awaiting offline cash settlement
  PROMO                // source of promotional grants
  ADJUSTMENT           // manual corrections (always audited)
  ROUNDING             // rounding remainders
}

enum Currency {
  CREDIT   // OPERATOR mode single currency
  PLAY     // COMPLIANCE mode: non-redeemable entertainment
  PRIZE    // COMPLIANCE mode: redeemable sweeps
}

model LedgerTransaction {
  id             String            @id @default(cuid())
  type           LedgerTxType
  status         LedgerTxStatus    @default(POSTED)
  currency       Currency
  idempotencyKey String            @unique
  // who triggered it
  actorUserId    String?
  actorPlayerId  String?
  // optional link to the business object that caused it
  refType        String?                          // "CreditOrder" | "RedemptionRequest" | "GameRound" | ...
  refId          String?
  memo           String?
  reversedById   String?                          // if reversed, the reversal txn
  entries        LedgerEntry[]
  createdAt      DateTime          @default(now())

  @@index([type])
  @@index([refType, refId])
  @@index([actorUserId])
  @@index([actorPlayerId])
  @@index([createdAt])
  @@map("ledger_transactions")
}

enum LedgerTxType {
  ISSUE            // mint -> operator
  TRANSFER         // operator -> child operator
  RECHARGE         // operator -> player wallet
  PROMO_GRANT      // promo -> player/operator
  GAME_BET         // player -> revenue (stake)
  GAME_WIN         // revenue -> player (payout)
  GAME_ROUND_NET   // optional netted single-txn round (bet+win combined)
  REDEEM_HOLD      // player prize -> redemption_clearing (on approval)
  REDEEM_CANCEL    // reverse a hold
  REDEEM_SETTLE    // mark clearing settled (offline cash paid) — accounting close
  ADJUSTMENT       // manual correction
  REVERSAL         // reversal of another txn
}

enum LedgerTxStatus { PENDING POSTED REVERSED FAILED }

model LedgerEntry {
  id            String         @id @default(cuid())
  transactionId String
  transaction   LedgerTransaction @relation(fields: [transactionId], references: [id])
  accountId     String
  account       LedgerAccount  @relation(fields: [accountId], references: [id])
  direction     EntryDirection
  amountMinor   BigInt                            // always positive; direction carries sign
  currency      Currency
  // snapshot of account balance AFTER this entry, for fast statements
  balanceAfterMinor BigInt
  createdAt     DateTime       @default(now())

  @@index([accountId, createdAt])
  @@index([transactionId])
  @@map("ledger_entries")
}

enum EntryDirection { DEBIT CREDIT }

// ============================================================
// OFFLINE CREDIT PURCHASES (no card processor)
// ============================================================

model CreditOrder {
  id             String           @id @default(cuid())
  // buyer requests credits from seller (its direct upline). For SUPER_ADMIN issuing, sellerOperatorId is null (mint).
  buyerOperatorId  String
  sellerOperatorId String?
  currency       Currency         @default(CREDIT)
  quantityMinor  BigInt                            // credits requested
  unitPriceCents Int                               // agreed cash price per credit
  totalCents     Int                               // quantity * price (for reporting)
  status         CreditOrderStatus @default(REQUESTED)
  paymentMethod  String?                           // "cash" | "wire" | "crypto" | "cashapp" | ...
  paymentRef     String?                           // external reference / memo
  proofUrl       String?                           // R2 link to receipt/screenshot
  note           String?
  issuedTxId     String?                           // ledger ISSUE/TRANSFER txn once fulfilled
  requestedByUserId String?
  decidedByUserId   String?
  decidedAt      DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  @@index([buyerOperatorId])
  @@index([sellerOperatorId])
  @@index([status])
  @@map("credit_orders")
}

enum CreditOrderStatus {
  REQUESTED
  AWAITING_PAYMENT
  PAID
  ISSUED          // credits delivered to buyer's ledger account
  CANCELLED
  REFUNDED
}

// Optional running tab between two operators (who owes whom, off-platform)
model Settlement {
  id              String   @id @default(cuid())
  operatorId      String
  counterpartyId  String
  currency        Currency @default(CREDIT)
  // net cash position in cents: positive = counterparty owes operator
  netCents        Int      @default(0)
  lastEventAt     DateTime @default(now())
  @@unique([operatorId, counterpartyId, currency])
  @@map("settlements")
}

// ============================================================
// GAMES (stubbed — see docs/05 RGS contract)
// ============================================================

model Game {
  id            String     @id @default(cuid())
  code          String     @unique             // stable slug, e.g. "reef-rumble"
  name          String
  type          GameType
  status        GameStatus @default(ACTIVE)
  rtpBps        Int        @default(9400)       // basis points; bounded per-operator overrides allowed
  minBetMinor   BigInt
  maxBetMinor   BigInt
  supportedCurrencies Currency[]               // [CREDIT] or [PLAY, PRIZE]
  thumbnailUrl  String?
  config        Json       @default("{}")       // arbitrary game config for the real game later
  sortOrder     Int        @default(0)
  sessions      GameSession[]
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  @@index([status, sortOrder])
  @@map("games")
}

enum GameType { FISH SLOT KENO TABLE OTHER }
enum GameStatus { ACTIVE HIDDEN MAINTENANCE }

model GameSession {
  id            String        @id @default(cuid())
  playerId      String
  player        Player        @relation(fields: [playerId], references: [id])
  gameId        String
  game          Game          @relation(fields: [gameId], references: [id])
  currency      Currency
  status        GameSessionStatus @default(ACTIVE)
  totalBetMinor BigInt        @default(0)
  totalWinMinor BigInt        @default(0)
  // provable fairness (used by placeholder RGS too)
  serverSeedHash String
  clientSeed     String?
  startedAt     DateTime      @default(now())
  endedAt       DateTime?
  rounds        GameRound[]
  @@index([playerId, startedAt])
  @@index([gameId])
  @@map("game_sessions")
}

enum GameSessionStatus { ACTIVE ENDED }

model GameRound {
  id          String   @id @default(cuid())
  sessionId   String
  session     GameSession @relation(fields: [sessionId], references: [id])
  nonce       Int                              // increments per session
  betMinor    BigInt
  winMinor    BigInt
  outcome     Json                             // RGS result payload (placeholder)
  betTxId     String?                          // ledger GAME_BET txn
  winTxId     String?                          // ledger GAME_WIN txn (if win > 0)
  createdAt   DateTime @default(now())
  @@unique([sessionId, nonce])
  @@index([sessionId, createdAt])
  @@map("game_rounds")
}

// ============================================================
// REDEMPTIONS (cashout) — see docs/03
// ============================================================

model RedemptionRequest {
  id            String           @id @default(cuid())
  playerId      String
  player        Player           @relation(fields: [playerId], references: [id])
  operatorId    String                            // owning agent at request time
  currency      Currency         @default(PRIZE)   // CREDIT in operator mode
  amountMinor   BigInt
  status        RedemptionStatus @default(PENDING)
  method        String?                           // how the player wants paid (offline)
  payoutRef     String?                           // proof of offline payout
  holdTxId      String?                           // REDEEM_HOLD ledger txn
  settleTxId    String?                           // REDEEM_SETTLE ledger txn
  reviewedByUserId String?
  rejectionReason  String?
  createdAt     DateTime         @default(now())
  decidedAt     DateTime?
  settledAt     DateTime?
  @@index([playerId])
  @@index([operatorId, status])
  @@index([status, createdAt])
  @@map("redemption_requests")
}

enum RedemptionStatus { PENDING APPROVED PAID REJECTED CANCELLED }

// ============================================================
// PROMOTIONS
// ============================================================

model Promotion {
  id          String   @id @default(cuid())
  code        String   @unique
  description String?
  currency    Currency @default(PLAY)
  grantMinor  BigInt
  // sweeps AMoE support: free prize credits with no purchase
  isAmoe      Boolean  @default(false)
  maxRedemptions Int?
  perPlayerLimit Int    @default(1)
  startsAt    DateTime?
  endsAt      DateTime?
  status      PromoStatus @default(ACTIVE)
  createdAt   DateTime @default(now())
  @@map("promotions")
}

enum PromoStatus { ACTIVE PAUSED ENDED }

// ============================================================
// COMPLIANCE — hooks are real, providers can be stubs (docs/01 §8)
// ============================================================

model KycRecord {
  id          String    @id @default(cuid())
  playerId    String    @unique
  player      Player    @relation(fields: [playerId], references: [id])
  status      KycStatus @default(NONE)
  level       Int       @default(0)              // tiered verification
  idType      String?
  documentUrl String?                            // R2 private
  provider    String?
  providerRef String?
  verifiedAt  DateTime?
  rejectedReason String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@map("kyc_records")
}

enum KycStatus { NONE PENDING VERIFIED REJECTED }

model GeoRule {
  id        String   @id @default(cuid())
  region    String   @unique                    // e.g. "US-CA", country or subdivision code
  action    GeoAction
  reason    String?
  updatedAt DateTime @updatedAt
  @@map("geo_rules")
}

enum GeoAction { ALLOW BLOCK }

model ResponsibleGamingLimit {
  id        String   @id @default(cuid())
  playerId  String
  player    Player   @relation(fields: [playerId], references: [id])
  type      RgLimitType
  valueMinor BigInt?                             // for deposit/loss limits
  minutes   Int?                                 // for session-time limits
  period    RgPeriod
  setByPlayer Boolean @default(true)
  createdAt DateTime @default(now())
  @@index([playerId, type])
  @@map("rg_limits")
}

enum RgLimitType { DEPOSIT LOSS SESSION_TIME WAGER }
enum RgPeriod { DAILY WEEKLY MONTHLY SESSION }

model SelfExclusion {
  id        String   @id @default(cuid())
  playerId  String   @unique
  player    Player   @relation(fields: [playerId], references: [id])
  until     DateTime?                            // null = permanent
  reason    String?
  createdAt DateTime @default(now())
  @@map("self_exclusions")
}

model AmlFlag {
  id          String   @id @default(cuid())
  subjectType String                             // "PLAYER" | "OPERATOR"
  subjectId   String
  ruleCode    String                             // "VELOCITY" | "STRUCTURING" | "RAPID_REDEEM" | ...
  severity    AmlSeverity
  status      AmlStatus @default(OPEN)
  details     Json
  resolvedByUserId String?
  createdAt   DateTime @default(now())
  resolvedAt  DateTime?
  @@index([subjectType, subjectId])
  @@index([status, severity])
  @@map("aml_flags")
}

enum AmlSeverity { LOW MEDIUM HIGH }
enum AmlStatus { OPEN REVIEWING CLEARED ESCALATED }

// ============================================================
// AUDIT (append-only)
// ============================================================

model AuditLog {
  id         String   @id @default(cuid())
  actorType  String                              // "USER" | "PLAYER" | "SYSTEM"
  actorId    String?
  action     String                              // "operator.create" | "ledger.adjust" | "redemption.approve" | ...
  targetType String?
  targetId   String?
  before     Json?
  after      Json?
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())
  @@index([actorType, actorId])
  @@index([targetType, targetId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
}

// ============================================================
// OUTBOX (transactional events -> realtime/webhooks)
// ============================================================

model OutboxEvent {
  id         String   @id @default(cuid())
  type       String                              // "balance.changed" | "redemption.updated" | ...
  payload    Json
  // routing
  rooms      String[]                            // socket rooms to emit to
  status     OutboxStatus @default(PENDING)
  attempts   Int      @default(0)
  createdAt  DateTime @default(now())
  sentAt     DateTime?
  @@index([status, createdAt])
  @@map("outbox_events")
}

enum OutboxStatus { PENDING SENT FAILED }

// ============================================================
// NOTIFICATIONS / ANNOUNCEMENTS
// ============================================================

model Notification {
  id         String   @id @default(cuid())
  audience   TokenAudience
  userId     String?
  playerId   String?
  title      String
  body       String
  readAt     DateTime?
  createdAt  DateTime @default(now())
  @@index([userId, readAt])
  @@index([playerId, readAt])
  @@map("notifications")
}

model Announcement {
  id         String   @id @default(cuid())
  title      String
  body       String
  // targeting
  audience   AnnouncementAudience @default(PLAYERS)
  operatorScopePath String?                      // limit to a subtree
  startsAt   DateTime?
  endsAt     DateTime?
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  @@map("announcements")
}

enum AnnouncementAudience { PLAYERS OPERATORS BOTH }
```

---

## Why the shape is what it is

**Operator and Player are separate tables, not one polymorphic account.** They have different auth surfaces (console vs arcade), different lifecycles, and different relations. Trying to unify them creates a table full of nullable columns and dangerous mix-ups. Keep them apart.

**One `User` per operator, 1:1.** Auth identity is separate from the tree node so you can later support multiple logins per operator (staff seats) by relaxing the 1:1 without touching the ledger. For v1 it is 1:1.

**Materialized path on `Operator`.** Subtree scope checks (`path LIKE '1.7.%'`) are the single most common query in the system. The path plus `depth` makes "everyone under me" and "am I an ancestor of X" both cheap. `pathSegment` is a small per-sibling integer so paths stay short even with cuid primary keys. Assign it on create (max sibling segment + 1, under a parent lock).

**`LedgerAccount` is generic over owner type.** Operators, players, and system accounts all hold balances the same way, so the ledger code is uniform. The unique constraint guarantees one account per owner per currency. Players in compliance mode get two accounts (PLAY and PRIZE); in operator mode, one (CREDIT).

**`balanceMinor` is cached on the account but every change is journaled.** Reads are O(1) off the cached column; correctness is guaranteed by entries that net to zero and a reconciliation job that recomputes from entries. `version` gives optimistic locking on top of the pessimistic row lock used during posting (belt and suspenders, see `docs/03`).

**`balanceAfterMinor` on each entry** gives instant account statements without summing history, and a second integrity check (each entry's snapshot must equal the running sum).

**`CreditOrder` is the offline-payment record.** Because there is no processor, the "payment" is paperwork: who bought, how many, at what cash price, by what method, with what proof, approved by whom. Credits only issue after the order is marked paid. This is the audit trail that replaces a payment gateway.

**Redemption is a workflow table, not a single ledger event.** A cashout is request → approve (hold/burn prize credits to clearing) → settle (offline cash paid, accounting closed) or reject/cancel (reverse the hold). The ledger txns are linked from the request. See `docs/03` for the exact entries.

**Games store sessions and rounds with provable-fairness seeds even though they're stubbed.** This means the placeholder RGS produces real, verifiable-looking sessions, and a real game later drops into the same tables and contract with no migration.

**Compliance tables exist now even if providers are stubs.** Ripping them in later is expensive and risky. The checks run from day one; only the provider implementations are stubs.

**Outbox guarantees realtime/webhook delivery.** The event row is written in the same transaction as the state change, so you never emit an update for a change that rolled back, and you never lose an update because a socket was briefly down.

---

## Indexing summary (already in the schema, called out)

- `Operator.path`, `Operator.parentId`, `Operator.tier` — subtree and tree-walk queries.
- `LedgerAccount` unique on owner+currency, plus owner indexes — fast balance lookup.
- `LedgerEntry (accountId, createdAt)` — account statements, paginated.
- `LedgerTransaction (refType, refId)` and `(createdAt)` — trace a business object's money and time-range reports.
- `RedemptionRequest (operatorId, status)` and `(status, createdAt)` — agent approval queues.
- `AuditLog` on actor, target, action, time — investigations.
- `OutboxEvent (status, createdAt)` — relay scan.

## Migrations & seed

- `pnpm db:migrate` runs `prisma migrate dev` locally, `prisma migrate deploy` in CI/release.
- Seed (`packages/db/seed.ts`) creates: the system accounts (MINT, REVENUE, etc.), a `SUPER_ADMIN` operator + user, a sample distributor → store → player chain, a handful of placeholder `Game` rows, and default `GeoRule`/`PlatformSetting` rows. The integration test (`docs/09`) builds on this seed.
