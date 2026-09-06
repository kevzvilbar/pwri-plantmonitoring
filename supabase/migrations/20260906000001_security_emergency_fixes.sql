-- Emergency security fixes identified during 2026-09-06 architecture review.
-- Addresses:
--   1. backfill_sweep_log fully open to anon (ALL policy created in 20260901000005)
--   2. locator_readings_latest SELECT granted to anon (20260905000001)
--   3. Search-path regressions on September functions (missing pg_temp)
--   4. Default PUBLIC execute grants on sensitive functions

-- ── 1. Drop the dangerously permissive anon policy on backfill_sweep_log ────
DROP POLICY IF EXISTS "backfill_sweep_log_anon" ON public.backfill_sweep_log;

-- Replace with authenticated-only read access for audit visibility
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'backfill_sweep_log'
      AND policyname = 'backfill_sweep_log_authenticated_read'
  ) THEN
    CREATE POLICY "backfill_sweep_log_authenticated_read"
      ON public.backfill_sweep_log FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- ── 2. Revoke anon access to locator_readings_latest view ──────────────────
REVOKE SELECT ON public.locator_readings_latest FROM anon;
-- Also check and revoke on other *_latest views that may have the same issue
DO $$ BEGIN
  EXECUTE 'REVOKE SELECT ON public.well_readings_latest FROM anon';
  EXECUTE 'REVOKE SELECT ON public.product_meter_readings_latest FROM anon';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 3. Re-harden search_path on ALL SECURITY DEFINER functions ─────────────
-- The original hardening in 20260831000002 was a one-time static loop.
-- Functions created or replaced in September 2026 missed this.
-- This dynamically finds and fixes all SECURITY DEFINER functions.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp',
      r.schema_name, r.function_name, r.args
    );
    RAISE NOTICE 'Hardened search_path: %.%(%)', r.schema_name, r.function_name, r.args;
  END LOOP;
END $$;

-- ── 4. Revoke default PUBLIC execute on sensitive mutation functions ────────
-- Postgres grants EXECUTE to PUBLIC by default on new functions.
-- These should only be callable by authenticated users or specific roles.
DO $$
DECLARE
  fn TEXT;
  r RECORD;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'fn_sweep_derived_meters',
    'fn_backfill_missing_readings',
    'fn_cascade_reading_correction',
    'fn_compute_daily_plant_summary',
    'recompute_production_cost'
  ] LOOP
    FOR r IN
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', fn, r.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', fn, r.args);
      RAISE NOTICE 'Secured function: %(%)', fn, r.args;
    END LOOP;
  END LOOP;
END $$;
