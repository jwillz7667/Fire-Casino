-- Optional least-privilege provisioning for a dedicated application database.
-- Run with psql as the migration/table owner AFTER prisma migrate deploy:
--   psql "$MIGRATION_DATABASE_URL" -v runtime_role=firecasino_runtime \
--     -f deploy/runtime-role.sql
-- Then set a strong password using psql's interactive \password command and
-- build the runtime DATABASE_URL for this role. Never save the password here.
-- The role must be NEW: refusing an existing role avoids retaining memberships
-- or owner privileges that would bypass these grants. PostgreSQL/Neon supported.
\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
  \set runtime_role firecasino_runtime
\endif

BEGIN;
CREATE ROLE :"runtime_role" LOGIN NOCREATEDB NOCREATEROLE NOINHERIT;
SELECT current_database() AS database_name, current_user AS migration_role \gset

GRANT CONNECT ON DATABASE :"database_name" TO :"runtime_role";
-- PostgreSQL grants PUBLIC schema CREATE on some older databases. This database
-- is dedicated to the app; only its owner should be able to create objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"runtime_role";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";
-- Immutable financial/audit history stays insertable but cannot be rewritten.
REVOKE UPDATE, DELETE ON TABLE audit_logs, ledger_entries, ledger_transactions FROM :"runtime_role";
REVOKE ALL ON TABLE _prisma_migrations FROM :"runtime_role";

-- Future tables initially permit only reads/inserts; new migration code must
-- explicitly grant UPDATE/DELETE where the domain needs mutable records.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";
COMMIT;
