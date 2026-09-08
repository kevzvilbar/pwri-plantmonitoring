-- =============================================================================
-- Migration: 20260906000002_revoke_anon_function_grants.sql
--
-- Purpose:
--   Closes the anon-execute hole left by 20260906000001. That migration
--   revoked PUBLIC execute on sensitive functions but did not remove earlier
--   explicit grants TO anon. In PostgreSQL, REVOKE FROM PUBLIC does not
--   affect explicit per-role grants, so these functions remained callable
--   by unauthenticated users via PostgREST RPC.
-- =============================================================================

DO $$
DECLARE
  fn TEXT;
  r RECORD;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'fn_sweep_derived_meters',
    'fn_backfill_missing_readings'
  ] LOOP
    FOR r IN
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', fn, r.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', fn, r.args);
      RAISE NOTICE 'Secured function: %(%)', fn, r.args;
    END LOOP;
  END LOOP;
END $$;
