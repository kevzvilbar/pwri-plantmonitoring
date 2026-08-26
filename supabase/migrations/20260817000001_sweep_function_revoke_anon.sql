-- =============================================================================
-- Migration: 20260817000000_sweep_function_revoke_anon.sql
-- Removes the `anon` EXECUTE grant on fn_sweep_derived_meters.
--
-- CONTEXT:
--   20260727_hamas_phase2_sweep_function.sql granted EXECUTE to anon so the
--   derived-meter-sweep.yml cron job (no user session) could call it. But
--   the credential that workflow actually uses is
--   VITE_SUPABASE_PUBLISHABLE_KEY -- the same anon key that ships inside the
--   public frontend bundle by Supabase's own design. Granting a
--   SECURITY DEFINER function to `anon` on that basis means the function's
--   only real gate is a key any site visitor can read out of devtools, not
--   "the scheduled job" as intended. Anyone who has ever loaded the app can
--   POST to /rest/v1/rpc/fn_sweep_derived_meters with any p_date /
--   p_lookback_days (capped at 30 inside the function) at any frequency,
--   writing across locator_readings, product_meter_readings, and
--   derived_meter_sweep_log, and re-triggering fn_notify_derived_review's
--   "superseded" notification to Admin/Manager/Data Analyst each time.
--
-- FIX:
--   Revoke anon's EXECUTE grant. The cron workflow switches to the
--   service_role key instead (see the paired derived-meter-sweep.yml diff --
--   service_role is only ever held in GitHub Actions secrets, never shipped
--   to the client, so this closes the gap without touching the function's
--   own logic or its SECURITY DEFINER need). The "Recalculate now" button in
--   Operations > Locator already calls this through an authenticated
--   session, so the existing `authenticated` grant is untouched and that
--   path keeps working exactly as before.
--
--   service_role bypasses RLS/grants in Supabase by design, so it needs no
--   explicit GRANT here to keep working once the workflow switches keys --
--   this migration only removes anon's access.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) FROM anon;

COMMENT ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) IS
  'Recomputes residual volume (mother meter minus sibling locators) for every '
  'is_derived locator over a rolling lookback window, mirrors the result into '
  'any linked product_meters row, and notifies Admin/Manager/Data Analyst if '
  'a manual override gets superseded. Called on a schedule by '
  '.github/workflows/derived-meter-sweep.yml (service_role key as of '
  '2026-08-17 -- see 20260817000000_sweep_function_revoke_anon.sql; anon was '
  'never actually restricted to the cron job, since the anon key ships in '
  'the public frontend bundle) and on demand by the "Recalculate now" '
  'button in Operations > Locator (authenticated session).';

NOTIFY pgrst, 'reload schema';
