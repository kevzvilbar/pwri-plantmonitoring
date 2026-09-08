-- Security hardening follow-up: REVOKE default PUBLIC EXECUTE on remaining
-- September 2026 SECURITY DEFINER functions that were missed by the emergency
-- fix (20260906000001 only covered 5 named functions).
--
-- Affected functions:
--   fn_sync_well_reading_chain
--   fn_product_meter_reading_integrity
--   fn_sync_product_meter_reading_chain
--   fn_blending_set_reading
--   fn_sync_blending_reading_chain
--   fn_trg_sync_operator_presence
--
-- These are trigger-side functions (not user-facing RPCs), but PostgREST
-- still exposes any stored procedure as an RPC endpoint unless EXECUTE is
-- revoked from PUBLIC. Default-deny: authenticated users who need them
-- already have access via the role grants in their creation migrations; the
-- app never calls these directly from the client.

DO $$
DECLARE
  fn TEXT;
  r RECORD;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'fn_sync_well_reading_chain',
    'fn_product_meter_reading_integrity',
    'fn_sync_product_meter_reading_chain',
    'fn_blending_set_reading',
    'fn_sync_blending_reading_chain',
    'fn_trg_sync_operator_presence'
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
