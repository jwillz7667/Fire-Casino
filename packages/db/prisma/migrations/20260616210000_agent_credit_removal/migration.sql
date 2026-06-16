-- Agent-initiated player credit removal (docs/03 §4.4).
--
-- Adds the burn destination account (SINK) and the dedicated ledger transaction
-- type (CREDIT_REMOVAL). Both are additive enum changes; no data is migrated.
-- The SINK account row itself is created lazily by LedgerService on first burn,
-- so there is nothing to seed here.

-- AlterEnum: SINK is the write-only burn target for removed player credits.
ALTER TYPE "SystemAccount" ADD VALUE IF NOT EXISTS 'SINK';

-- AlterEnum: CREDIT_REMOVAL keeps agent removals distinct from mints, recharges
-- and redemption settlements in the ledger. Placed before ADJUSTMENT to match
-- the Prisma schema ordering.
ALTER TYPE "LedgerTxType" ADD VALUE IF NOT EXISTS 'CREDIT_REMOVAL' BEFORE 'ADJUSTMENT';
