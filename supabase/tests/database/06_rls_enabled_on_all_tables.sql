-- ============================================================================
-- Test: 06_rls_enabled_on_all_tables.sql
--
-- Roadmap Phase 1 — "CI enforcement" for RLS coverage: asserts that EVERY
-- table in the public schema has row level security ENABLED. This is the
-- fail-closed baseline; the per-policy regression tests (01–05) check what
-- the policies actually allow, but until now nothing stopped a new
-- `CREATE TABLE` from shipping with RLS off — where a missing/typo'd
-- ENABLE statement makes the table fully readable AND writable by any
-- client holding the anon key. pgTAP checks the live catalog
-- (pg_class.relrowsecurity), not migration file text, so this catches the
-- bug no matter which migration introduced it.
--
-- One assertion per table: a failure NAMES the offending table. plan() is
-- derived from the same catalog snapshot inside the same transaction, so
-- the count always matches the assertions that follow. There is currently
-- NO exclusion list — if a genuinely-public internal table ever needs one,
-- add it here with a written justification, not by weakening the query.
--
-- Runs via `supabase test db` locally or in CI (rls-tests job) against a
-- disposable instance built from this repo's own migrations.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Ordinary ('r'), partitioned ('p') and foreign ('f') tables. Views are
-- excluded by design: RLS does not apply to them (filter_usage_daily is a
-- security_invoker view, which is its own guarantee, tested by 000008's
-- design and the policies on its source tables).
SELECT plan(
  (SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'f'))
);

SELECT is(
  c.relrowsecurity::text,
  'true',
  'RLS enabled: public.' || c.relname
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'f')
ORDER BY c.relname;

SELECT * FROM finish();
ROLLBACK;