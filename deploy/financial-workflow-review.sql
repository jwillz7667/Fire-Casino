-- Read-only checks before switching traffic after restoring a historical database.
-- Run as an authorized finance/operations reviewer. Do not infer missing cash
-- amounts or RTP provenance from today's mutable operator/game settings.

-- These approved holds predate the payable snapshot. Cancellation deliberately
-- refuses them until the ORIGINAL approval-time cash amount and owing operator
-- are verified against the historical cash trail. Record the evidence and an
-- append-only AuditLog event when backfilling both snapshot columns. A zero cash
-- payable must also be explicitly verified; NULL never means zero. Do not alter
-- the ledger or settlement total merely to populate this metadata.
SELECT id, "playerId", "operatorId", "currency", "amountMinor", "holdTxId", "decidedAt"
FROM redemption_requests
WHERE status = 'APPROVED'
  AND ("approvedPayableCents" IS NULL OR "approvedPayableOperatorId" IS NULL);

-- The old game workflow could commit a bet or payout before finalizing a round.
-- New atomic rounds cannot create this state. Retrying one refuses to reinterpret
-- the original payment at a new game configuration/RTP. Reconcile posted entries,
-- original outcome/seed/config and session totals using retained source evidence;
-- if provenance cannot be established, use a reviewed, audited compensating
-- transaction. Never UPDATE/DELETE immutable ledger history or guess a payout.
SELECT r.id, r."sessionId", r."nonce", r."betMinor", r."betTxId", r."winTxId",
       t.id AS "postedTransactionId", t.type, t."idempotencyKey"
FROM game_rounds r
LEFT JOIN ledger_transactions t
  ON t."idempotencyKey" IN ('round:' || r.id || ':bet', 'round:' || r.id || ':win')
WHERE (r.outcome->>'kind' = 'pending' OR r."betTxId" IS NULL)
  AND (t.id IS NOT NULL OR r."betTxId" IS NOT NULL OR r."winTxId" IS NOT NULL);

-- Receipts uploaded before the private-proof repair may live in the public asset
-- bucket. Replace them with verified uploads into the private KYC bucket before
-- enabling signed previews, then revoke/remove the historical public copies per
-- the operator's retention policy. Do not make the KYC bucket public. This query
-- lists legacy orders without printing their potentially sensitive receipt URLs.
SELECT id, "buyerOperatorId", "sellerOperatorId", "createdAt"
FROM credit_orders
WHERE "proofUrl" IS NOT NULL;
