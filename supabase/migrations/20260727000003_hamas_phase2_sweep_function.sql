-- =============================================================================
-- Migration: 20260727_hamas_phase2_sweep_function.sql
-- Phase 2 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   .github/workflows/derived-meter-sweep.yml already exists and has been
--   calling POST {SUPABASE_URL}/rest/v1/rpc/fn_sweep_derived_meters on a
--   schedule since it was added — but the function itself was never created
--   (the migration it depends on, 20260726_sweep_derived_meters.sql, does
--   not exist in this repo). Every scheduled run has been failing with a
--   Postgres "function does not exist" error. This migration creates that
--   function, matching the exact RPC signature (p_date, p_lookback_days) and
--   JSON response shape ({"ok": true, ...}) the workflow already expects, so
--   no workflow changes are needed beyond the cadence update in Phase 2's
--   accompanying .github/workflows edit.
--
-- FORMULA:
--   For each is_derived locator L with mother meter M = L.derived_from_meter_id,
--   for each date in [p_date - p_lookback_days + 1, p_date]:
--     residual = SUM(M's product_meter_readings.daily_volume that day)
--              − SUM(daily_volume of L's non-derived sibling locators that day)
--   Both source daily_volume columns are already rollover-aware / normalized
--   by the application, so the sweep reads them directly rather than
--   re-deriving current − previous itself.
--
--   Days are bucketed by Asia/Manila calendar date, matching the "yesterday
--   PHT" convention .github/workflows/nightly-summary.yml already uses and
--   the 5-minutes-earlier scheduling comment in derived-meter-sweep.yml.
--
-- WRITE BEHAVIOR (the "supersede" decision from the Hamas planning thread):
--   • No existing reading for that locator/date  → INSERT (is_estimated=true).
--   • Existing reading is sweep-computed (is_estimated=true) and the new
--     residual differs → UPDATE it in place.
--   • Existing reading is a human override (is_estimated=false) and the new
--     residual differs → UPDATE it (supersede), flip back to
--     is_estimated=true, and notify Admin/Manager/Data Analyst via
--     fn_notify_derived_review(..., 'superseded', ...) — "your override was
--     replaced." If the new residual matches the override, it's left alone.
--   • Any successful compute (mother meter had data that day) resolves an
--     open review flag for that locator/date, whether or not the value
--     actually moved.
--   • If a product_meters row mirrors this locator (derived_from_locator_id),
--     the same value is written into that meter's product_meter_readings —
--     it may belong to a different plant (the Hamas/Mambaling case).
--
-- SECURITY:
--   SECURITY DEFINER so it can write across locator_readings /
--   product_meter_readings / derived_meter_sweep_log / notifications
--   regardless of caller. Matches the existing workflow, which calls this
--   using the anon key (no user session) — there is no authenticated caller
--   to check a role against at that call site. The Phase 4 migration
--   separately restricts *direct table writes* to derived-locator readings
--   to Manager/Analyst/Admin; that restriction does not apply to this
--   function's own internal writes. p_lookback_days is capped defensively
--   since this function performs writes and is callable without auth.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters(
  p_date          DATE,
  p_lookback_days INT DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lookback        INT := LEAST(GREATEST(COALESCE(p_lookback_days, 3), 1), 30);
  v_locator         RECORD;
  v_mirror          RECORD;
  v_day             DATE;
  v_mother_vol      NUMERIC;
  v_siblings_vol    NUMERIC;
  v_new_value       NUMERIC;
  v_existing        RECORD;
  v_reading_dt      TIMESTAMPTZ;
  v_changed         BOOLEAN;
  v_was_override    BOOLEAN;
  v_locators_seen   INT := 0;
  v_rows_changed    INT := 0;
BEGIN
  FOR v_locator IN
    SELECT id, name, plant_id, derived_from_meter_id
      FROM public.locators
     WHERE is_derived = TRUE AND derived_from_meter_id IS NOT NULL
  LOOP
    v_locators_seen := v_locators_seen + 1;

    FOR v_day IN
      SELECT generate_series(p_date - (v_lookback - 1), p_date, INTERVAL '1 day')::date
    LOOP
      v_reading_dt := (v_day + TIME '23:59:00') AT TIME ZONE 'Asia/Manila';

      SELECT SUM(COALESCE(pmr.daily_volume, pmr.current_reading - pmr.previous_reading))
        INTO v_mother_vol
        FROM public.product_meter_readings pmr
       WHERE pmr.meter_id = v_locator.derived_from_meter_id
         AND (pmr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;

      -- Can't compute a residual without the mother meter's reading for that day.
      IF v_mother_vol IS NULL THEN
        CONTINUE;
      END IF;

      SELECT SUM(lr.daily_volume)
        INTO v_siblings_vol
        FROM public.locator_readings lr
        JOIN public.locators sib ON sib.id = lr.locator_id
       WHERE sib.product_meter_id = v_locator.derived_from_meter_id
         AND sib.is_derived = FALSE
         AND (lr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;

      v_new_value := v_mother_vol - COALESCE(v_siblings_vol, 0);

      SELECT lr.id, lr.daily_volume, lr.is_estimated
        INTO v_existing
        FROM public.locator_readings lr
       WHERE lr.locator_id = v_locator.id
         AND (lr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day
       ORDER BY lr.reading_datetime DESC
       LIMIT 1;

      v_changed      := FALSE;
      v_was_override := FOUND AND v_existing.is_estimated = FALSE;

      IF NOT FOUND THEN
        INSERT INTO public.locator_readings
          (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
        VALUES
          (v_locator.id, v_locator.plant_id, v_reading_dt, v_new_value, 0, TRUE);
        v_changed := TRUE;

      ELSIF ABS(COALESCE(v_existing.daily_volume, 0) - v_new_value) > 0.005 THEN
        UPDATE public.locator_readings
           SET current_reading = v_new_value, previous_reading = 0, is_estimated = TRUE
         WHERE id = v_existing.id;
        v_changed := TRUE;
      END IF;

      IF v_changed AND v_was_override THEN
        PERFORM public.fn_notify_derived_review(v_locator.id, v_day, 'superseded', NULL);
      END IF;

      INSERT INTO public.derived_meter_sweep_log
        (locator_id, date_key, old_value, new_value, changed)
      VALUES
        (v_locator.id, v_day, v_existing.daily_volume, v_new_value, v_changed);

      IF v_changed THEN
        v_rows_changed := v_rows_changed + 1;
      END IF;

      -- A successful compute resolves any open "needs review" flag for this
      -- date, whether or not the stored value actually moved.
      -- NOTE: locator_derived_review_flags is created in Phase 3
      -- (20260727_hamas_phase3_review_flags_and_notify.sql), which must run
      -- after this migration. plpgsql doesn't validate table references in a
      -- function body at CREATE time, only at execution — and this function
      -- is never called until well after all five phase migrations have run
      -- (via the cron workflow or the "Recalculate now" button), so the
      -- ordering is safe. It would NOT be safe to call this function
      -- manually between applying Phase 2 and Phase 3.
      UPDATE public.locator_derived_review_flags
         SET resolved_at = now()
       WHERE locator_id = v_locator.id AND date_key = v_day AND resolved_at IS NULL;

      -- Mirror into any product_meters row that mirrors this locator's value
      -- (may belong to a different plant — the Hamas/Mambaling case).
      FOR v_mirror IN
        SELECT id, plant_id FROM public.product_meters WHERE derived_from_locator_id = v_locator.id
      LOOP
        IF EXISTS (
          SELECT 1 FROM public.product_meter_readings
           WHERE meter_id = v_mirror.id
             AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day
        ) THEN
          UPDATE public.product_meter_readings
             SET current_reading = v_new_value, previous_reading = 0,
                 daily_volume = v_new_value, is_estimated = TRUE
           WHERE meter_id = v_mirror.id
             AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;
        ELSE
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_new_value, 0, v_new_value, TRUE);
        END IF;
      END LOOP;

    END LOOP; -- days
  END LOOP; -- derived locators

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'derived_locators_seen', v_locators_seen,
    'rows_changed', v_rows_changed
  );
END;
$$;

COMMENT ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) IS
  'Recomputes residual volume (mother meter minus sibling locators) for every '
  'is_derived locator over a rolling lookback window, mirrors the result into '
  'any linked product_meters row, and notifies Admin/Manager/Data Analyst if '
  'a manual override gets superseded. Called on a schedule by '
  '.github/workflows/derived-meter-sweep.yml and on demand by the '
  '"Recalculate now" button in Operations > Locator.';

-- Callable both by the GitHub Actions cron (anon key, no user session) and by
-- authenticated users clicking "Recalculate now" in the UI.
GRANT EXECUTE ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
