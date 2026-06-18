-- Append-only enforcement at the DATABASE (security audit D1). audit_logs,
-- ledger_entries and ledger_transactions are immutable history; corrections are
-- made only by inserting new ADJUSTMENT/REVERSAL rows (never editing the past).
-- A row-level BEFORE UPDATE/DELETE trigger raises, so a careless service call, a
-- bug, or a compromised process cannot silently rewrite financial/compliance
-- history. TRUNCATE is intentionally NOT covered: it is privileged DDL used only
-- by test teardown, never reachable by the runtime application role.
CREATE OR REPLACE FUNCTION aureus_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; UPDATE/DELETE is not permitted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION aureus_reject_mutation();

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION aureus_reject_mutation();

CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION aureus_reject_mutation();

-- Non-negative balances for tenant accounts (security audit D2). Only allow-listed
-- SYSTEM accounts (MINT/PROMO/…) may go negative; an OPERATOR or PLAYER balance
-- must never be driven below zero, backstopping LedgerService.applyLegs in the DB.
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_tenant_non_negative"
  CHECK ("ownerType"::text NOT IN ('OPERATOR', 'PLAYER') OR "balanceMinor" >= 0);
