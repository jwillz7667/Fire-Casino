-- Snapshot the actual approval-time off-ledger cash payable so cancelling an
-- approved hold reverses exactly that position, even after operator price edits.
-- Existing rows intentionally remain NULL: no historical cash amount is guessed.
ALTER TABLE "redemption_requests"
  ADD COLUMN "approvedPayableCents" INTEGER,
  ADD COLUMN "approvedPayableOperatorId" TEXT,
  ADD CONSTRAINT "redemption_payable_non_negative"
    CHECK ("approvedPayableCents" IS NULL OR "approvedPayableCents" >= 0);
