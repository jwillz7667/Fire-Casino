-- Payout proof was accepted at the API boundary but never stored. Store the
-- canonical private URL and verified uploader so scoped reviewers can sign reads.
ALTER TABLE "redemption_requests"
  ADD COLUMN "proofUrl" TEXT,
  ADD COLUMN "proofOperatorId" TEXT;
