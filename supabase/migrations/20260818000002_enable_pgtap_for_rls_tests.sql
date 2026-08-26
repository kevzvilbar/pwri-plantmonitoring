-- =============================================================================
-- Migration: 20260818030000_enable_pgtap_for_rls_tests.sql
--
-- pgTAP for the RLS regression suite (2026-08-18 review, "the single
-- highest-leverage fix available"). Lives in the `extensions` schema,
-- matching this project's existing convention for pgcrypto/uuid-ossp/etc.
-- Test files live in supabase/tests/database/, Supabase CLI's conventional
-- location, run via `supabase test db` locally or in CI (see
-- .github/workflows/ci.yml's rls-tests job) against a disposable local
-- instance built from this repo's own migrations -- never against the
-- real project.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
