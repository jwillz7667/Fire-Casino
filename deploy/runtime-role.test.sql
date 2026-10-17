-- Run only against a dedicated test database after runtime-role.sql:
--   psql "$TEST_DATABASE_URL" -v runtime_role=firecasino_runtime \
--     -f deploy/runtime-role.test.sql
-- Exercises real role permissions. Test inserts/updates are rolled back.
\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \set runtime_role firecasino_runtime
\endif

BEGIN;
SET LOCAL ROLE :"runtime_role";
INSERT INTO audit_logs (id, "actorType", action)
VALUES ('runtime-role-check-' || txid_current(), 'SYSTEM', 'test.runtime_role');
INSERT INTO platform_settings (key, value, "updatedAt")
VALUES ('runtime-role-check-' || txid_current(), '{}'::jsonb, now());
UPDATE platform_settings SET value = '{"checked":true}'::jsonb
WHERE key = 'runtime-role-check-' || txid_current();
DELETE FROM platform_settings WHERE key = 'runtime-role-check-' || txid_current();

DO $$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['audit_logs', 'ledger_entries', 'ledger_transactions'] LOOP
    IF NOT has_table_privilege(current_user, relation, 'SELECT')
       OR NOT has_table_privilege(current_user, relation, 'INSERT') THEN
      RAISE EXCEPTION 'Missing runtime read/insert permission on %', relation;
    END IF;
    IF has_table_privilege(current_user, relation, 'UPDATE, DELETE, TRUNCATE, TRIGGER') THEN
      RAISE EXCEPTION 'Runtime may rewrite or bypass protections on %', relation;
    END IF;
    -- An actual prohibited operation must reject even when it affects no rows.
    BEGIN
      EXECUTE format('DELETE FROM %I WHERE false', relation);
      RAISE EXCEPTION 'Runtime DELETE unexpectedly succeeded on %', relation;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
  IF has_table_privilege(current_user, '_prisma_migrations', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
    RAISE EXCEPTION 'Runtime can access migration bookkeeping';
  END IF;
  IF has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Runtime can create schema objects';
  END IF;
END;
$$;
ROLLBACK;
