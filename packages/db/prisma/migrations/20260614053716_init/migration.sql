-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LOCKED');

-- CreateEnum
CREATE TYPE "TokenAudience" AS ENUM ('OPERATOR', 'PLAYER');

-- CreateEnum
CREATE TYPE "OperatorTier" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'SUB_DISTRIBUTOR', 'STORE');

-- CreateEnum
CREATE TYPE "OperatorStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'SELF_EXCLUDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LedgerOwnerType" AS ENUM ('OPERATOR', 'PLAYER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SystemAccount" AS ENUM ('MINT', 'REVENUE', 'REDEMPTION_CLEARING', 'PROMO', 'ADJUSTMENT', 'ROUNDING');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('CREDIT', 'PLAY', 'PRIZE');

-- CreateEnum
CREATE TYPE "LedgerTxType" AS ENUM ('ISSUE', 'TRANSFER', 'RECHARGE', 'PROMO_GRANT', 'GAME_BET', 'GAME_WIN', 'GAME_ROUND_NET', 'REDEEM_HOLD', 'REDEEM_CANCEL', 'REDEEM_SETTLE', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LedgerTxStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED', 'FAILED');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "CreditOrderStatus" AS ENUM ('REQUESTED', 'AWAITING_PAYMENT', 'PAID', 'ISSUED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('FISH', 'SLOT', 'KENO', 'TABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PromoStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GeoAction" AS ENUM ('ALLOW', 'BLOCK');

-- CreateEnum
CREATE TYPE "RgLimitType" AS ENUM ('DEPOSIT', 'LOSS', 'SESSION_TIME', 'WAGER');

-- CreateEnum
CREATE TYPE "RgPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'SESSION');

-- CreateEnum
CREATE TYPE "AmlSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AmlStatus" AS ENUM ('OPEN', 'REVIEWING', 'CLEARED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('PLAYERS', 'OPERATORS', 'BOTH');

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "playerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "audience" "TokenAudience" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "OperatorTier" NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "OperatorStatus" NOT NULL DEFAULT 'ACTIVE',
    "parentId" TEXT,
    "pathSegment" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "buyUnitPriceCents" INTEGER,
    "sellUnitPriceCents" INTEGER,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "ownerType" "LedgerOwnerType" NOT NULL,
    "operatorId" TEXT,
    "playerId" TEXT,
    "systemKey" "SystemAccount",
    "currency" "Currency" NOT NULL,
    "balanceMinor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" TEXT NOT NULL,
    "type" "LedgerTxType" NOT NULL,
    "status" "LedgerTxStatus" NOT NULL DEFAULT 'POSTED',
    "currency" "Currency" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorPlayerId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "memo" TEXT,
    "reversedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "balanceAfterMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_orders" (
    "id" TEXT NOT NULL,
    "buyerOperatorId" TEXT NOT NULL,
    "sellerOperatorId" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'CREDIT',
    "quantityMinor" BIGINT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "status" "CreditOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "paymentMethod" TEXT,
    "paymentRef" TEXT,
    "proofUrl" TEXT,
    "note" TEXT,
    "issuedTxId" TEXT,
    "requestedByUserId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'CREDIT',
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GameType" NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'ACTIVE',
    "rtpBps" INTEGER NOT NULL DEFAULT 9400,
    "minBetMinor" BIGINT NOT NULL,
    "maxBetMinor" BIGINT NOT NULL,
    "supportedCurrencies" "Currency"[],
    "thumbnailUrl" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalBetMinor" BIGINT NOT NULL DEFAULT 0,
    "totalWinMinor" BIGINT NOT NULL DEFAULT 0,
    "serverSeedHash" TEXT NOT NULL,
    "serverSeed" TEXT,
    "clientSeed" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rounds" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "betMinor" BIGINT NOT NULL,
    "winMinor" BIGINT NOT NULL,
    "outcome" JSONB NOT NULL,
    "betTxId" TEXT,
    "winTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_requests" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'PRIZE',
    "amountMinor" BIGINT NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "payoutRef" TEXT,
    "holdTxId" TEXT,
    "settleTxId" TEXT,
    "reviewedByUserId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "redemption_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'PLAY',
    "grantMinor" BIGINT NOT NULL,
    "isAmoe" BOOLEAN NOT NULL DEFAULT false,
    "maxRedemptions" INTEGER,
    "perPlayerLimit" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "status" "PromoStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_records" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NONE',
    "level" INTEGER NOT NULL DEFAULT 0,
    "idType" TEXT,
    "documentUrl" TEXT,
    "provider" TEXT,
    "providerRef" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geo_rules" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "action" "GeoAction" NOT NULL,
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rg_limits" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" "RgLimitType" NOT NULL,
    "valueMinor" BIGINT,
    "minutes" INTEGER,
    "period" "RgPeriod" NOT NULL,
    "setByPlayer" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rg_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_exclusions" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aml_flags" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "severity" "AmlSeverity" NOT NULL,
    "status" "AmlStatus" NOT NULL DEFAULT 'OPEN',
    "details" JSONB NOT NULL,
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "aml_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rooms" TEXT[],
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "audience" "TokenAudience" NOT NULL,
    "userId" TEXT,
    "playerId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'PLAYERS',
    "operatorScopePath" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_playerId_idx" ON "refresh_tokens"("playerId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "operators_userId_key" ON "operators"("userId");

-- CreateIndex
CREATE INDEX "operators_parentId_idx" ON "operators"("parentId");

-- CreateIndex
CREATE INDEX "operators_path_idx" ON "operators"("path");

-- CreateIndex
CREATE INDEX "operators_tier_idx" ON "operators"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "players_username_key" ON "players"("username");

-- CreateIndex
CREATE INDEX "players_operatorId_idx" ON "players"("operatorId");

-- CreateIndex
CREATE INDEX "players_status_idx" ON "players"("status");

-- CreateIndex
CREATE INDEX "ledger_accounts_operatorId_idx" ON "ledger_accounts"("operatorId");

-- CreateIndex
CREATE INDEX "ledger_accounts_playerId_idx" ON "ledger_accounts"("playerId");

-- CreateIndex
CREATE INDEX "ledger_accounts_systemKey_idx" ON "ledger_accounts"("systemKey");

-- CreateIndex
-- NULLS NOT DISTINCT (Postgres 15+): treat NULL key components as equal so this
-- composite unique actually enforces one ledger account per owner per currency.
-- Without it, NULL operatorId/playerId/systemKey would let duplicate accounts
-- exist (Postgres treats NULLs as distinct by default). Supports hard rule #2.
CREATE UNIQUE INDEX "ledger_accounts_ownerType_operatorId_playerId_systemKey_cur_key" ON "ledger_accounts"("ownerType", "operatorId", "playerId", "systemKey", "currency") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotencyKey_key" ON "ledger_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ledger_transactions_type_idx" ON "ledger_transactions"("type");

-- CreateIndex
CREATE INDEX "ledger_transactions_refType_refId_idx" ON "ledger_transactions"("refType", "refId");

-- CreateIndex
CREATE INDEX "ledger_transactions_actorUserId_idx" ON "ledger_transactions"("actorUserId");

-- CreateIndex
CREATE INDEX "ledger_transactions_actorPlayerId_idx" ON "ledger_transactions"("actorPlayerId");

-- CreateIndex
CREATE INDEX "ledger_transactions_createdAt_idx" ON "ledger_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_createdAt_idx" ON "ledger_entries"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_transactionId_idx" ON "ledger_entries"("transactionId");

-- CreateIndex
CREATE INDEX "credit_orders_buyerOperatorId_idx" ON "credit_orders"("buyerOperatorId");

-- CreateIndex
CREATE INDEX "credit_orders_sellerOperatorId_idx" ON "credit_orders"("sellerOperatorId");

-- CreateIndex
CREATE INDEX "credit_orders_status_idx" ON "credit_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_operatorId_counterpartyId_currency_key" ON "settlements"("operatorId", "counterpartyId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "games_code_key" ON "games"("code");

-- CreateIndex
CREATE INDEX "games_status_sortOrder_idx" ON "games"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "game_sessions_playerId_startedAt_idx" ON "game_sessions"("playerId", "startedAt");

-- CreateIndex
CREATE INDEX "game_sessions_gameId_idx" ON "game_sessions"("gameId");

-- CreateIndex
CREATE INDEX "game_rounds_sessionId_createdAt_idx" ON "game_rounds"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_sessionId_nonce_key" ON "game_rounds"("sessionId", "nonce");

-- CreateIndex
CREATE INDEX "redemption_requests_playerId_idx" ON "redemption_requests"("playerId");

-- CreateIndex
CREATE INDEX "redemption_requests_operatorId_status_idx" ON "redemption_requests"("operatorId", "status");

-- CreateIndex
CREATE INDEX "redemption_requests_status_createdAt_idx" ON "redemption_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_records_playerId_key" ON "kyc_records"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "geo_rules_region_key" ON "geo_rules"("region");

-- CreateIndex
CREATE INDEX "rg_limits_playerId_type_idx" ON "rg_limits"("playerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "self_exclusions_playerId_key" ON "self_exclusions"("playerId");

-- CreateIndex
CREATE INDEX "aml_flags_subjectType_subjectId_idx" ON "aml_flags"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "aml_flags_status_severity_idx" ON "aml_flags"("status", "severity");

-- CreateIndex
CREATE INDEX "audit_logs_actorType_actorId_idx" ON "audit_logs"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "outbox_events_status_createdAt_idx" ON "outbox_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_playerId_readAt_idx" ON "notifications"("playerId", "readAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_requests" ADD CONSTRAINT "redemption_requests_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_records" ADD CONSTRAINT "kyc_records_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rg_limits" ADD CONSTRAINT "rg_limits_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_exclusions" ADD CONSTRAINT "self_exclusions_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
