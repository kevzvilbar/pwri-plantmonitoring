-- =============================================================================
-- Migration: 20260901000006_backfill_improvements_and_polish.sql
--
-- Purpose:
--   1. Hardens RLS on `backfill_sweep_log` to authenticated-only read/write.
--   2. Updates `fn_backfill_missing_readings` with:
--      • Real rate-aware regression flowrate curve for gaps 6-14 days across
--        ALL 6 modules (locators, wells, product, blending, power, ro_train).
--      • Even split for gaps <= 5 days.
--      • Explicit `is_meter_rollover` check alongside `is_meter_replacement`.
--      • Retraction / cleanup of stale `is_estimated=true` rows when an operator
--        subsequently logs a `reading_gap_reasons` entry for that date.
--   3. Explicit schema reload notification (`NOTIFY pgrst, 'reload schema'`).
-- =============================================================================

-- 1. Tighten RLS on backfill_sweep_log
DROP POLICY IF EXISTS "backfill_sweep_log_anon" ON public.backfill_sweep_log;
DROP POLICY IF EXISTS "backfill_sweep_log_auth" ON public.backfill_sweep_log;
DROP POLICY IF EXISTS "backfill_sweep_log_select_auth" ON public.backfill_sweep_log;
DROP POLICY IF EXISTS "backfill_sweep_log_insert_auth" ON public.backfill_sweep_log;

-- Authenticated users can read audit logs
CREATE POLICY "backfill_sweep_log_select_auth"
  ON public.backfill_sweep_log
  FOR SELECT
  TO authenticated
  USING (true);

-- Writes restricted to authenticated system operators / security definer
CREATE POLICY "backfill_sweep_log_insert_auth"
  ON public.backfill_sweep_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 2. Enhanced fn_backfill_missing_readings
CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT CURRENT_DATE,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lookback        integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end      date := p_date;
  v_target_start    date := p_date - (v_lookback || ' days')::interval;
  v_swept_count     integer := 0;
  v_skipped_count   integer := 0;
  v_retracted_count integer := 0;

  -- Iteration variables
  r_entity          RECORD;
  r_reading_a       RECORD;
  r_reading_b       RECORD;
  v_gap_days        integer;
  v_step            numeric;
  v_val             numeric;
  v_daily_vol       numeric;
  v_cur_date        date;
  v_dt_iso          timestamptz;
  v_has_reason      boolean;
  v_existing_id     uuid;
  v_is_est          boolean;
  v_old_val         numeric;
  v_diff            numeric;
  v_method          text;
  v_hist_rate       numeric;
  v_dpre            numeric;
  v_u               numeric;
  v_curvature       numeric;
BEGIN

  -- ─── Gap-fill thresholds ─────────────────────────────────────────────────────
  -- The two numeric literals used throughout this function are intentional
  -- constants that MUST be kept in sync with their TypeScript counterparts in
  -- frontend/src/lib/gapDetection.ts:
  --
  --   SQL literal 5   ↔  EVEN_SPLIT_THRESHOLD_DAYS = 5
  --     Gaps of ≤ 5 days use even delta split (linear interpolation).
  --
  --   SQL literal 14  ↔  MAX_GAP_BACKFILL_DAYS = 14
  --     Gaps of > 14 days are ignored entirely; the trailing-history
  --     lookback window is also 14 days (interval '14 days' subquery).
  --
  -- If either value is changed here, update BOTH exported constants in
  -- gapDetection.ts so the Data-Analysis gap-preview UI stays in agreement
  -- with what the automated sweep will actually compute.
  -- ─────────────────────────────────────────────────────────────────────────────

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators WHERE status = 'Active' AND is_derived = false
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.locator_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 2: WELLS (well_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.wells WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.well_readings
                WHERE well_id = r_entity.id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.well_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 3: PRODUCT METERS (product_meter_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, reading_datetime::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.product_meter_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.current_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 4: BLENDING (blending_events)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id, name AS well_name FROM public.wells WHERE status = 'Active' AND COALESCE(is_blending_well, false) = true
  LOOP
    FOR r_reading_a IN
      SELECT id, raw_meter_reading, event_date AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND event_date >= (v_target_start - interval '14 days')::date
        AND event_date <= v_target_end
      ORDER BY event_date ASC
    LOOP
      SELECT id, raw_meter_reading, event_date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND event_date > r_reading_a.r_date
      ORDER BY event_date ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.raw_meter_reading - MIN(raw_meter_reading)) / NULLIF(r_reading_a.r_date - MIN(event_date), 0)
              INTO v_hist_rate
              FROM (
                SELECT raw_meter_reading, event_date
                FROM public.blending_events
                WHERE well_id = r_entity.id
                  AND event_date < r_reading_a.r_date
                  AND event_date >= (r_reading_a.r_date - interval '14 days')::date
                ORDER BY event_date DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND event_date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.blending_events WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.raw_meter_reading + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 5: POWER (power_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, meter_reading_kwh, reading_datetime::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, meter_reading_kwh, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.meter_reading_kwh - r_reading_a.meter_reading_kwh;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.meter_reading_kwh - MIN(meter_reading_kwh)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT meter_reading_kwh, reading_datetime
                FROM public.power_readings
                WHERE plant_id = r_entity.plant_id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, meter_reading_kwh INTO v_existing_id, v_is_est, v_old_val
                FROM public.power_readings
                WHERE plant_id = r_entity.plant_id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.power_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.meter_reading_kwh + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.meter_reading_kwh + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, daily_consumption_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val, daily_consumption_kwh = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 6: RO TRAINS (ro_train_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Active'
  LOOP
    FOR r_reading_a IN
      SELECT id, permeate_meter, reading_datetime::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND reading_datetime::date >= (v_target_start - interval '14 days')
        AND reading_datetime::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, permeate_meter, reading_datetime::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_replacement, false)
           AND NOT COALESCE(r_reading_b.is_permeate_meter_replacement, false) THEN
          v_diff := r_reading_b.permeate_meter - r_reading_a.permeate_meter;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.permeate_meter - MIN(permeate_meter)) / NULLIF(r_reading_a.r_date - MIN(reading_datetime::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT permeate_meter, reading_datetime
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id
                  AND reading_datetime::date < r_reading_a.r_date
                  AND reading_datetime::date >= (r_reading_a.r_date - interval '14 days')
                  AND permeate_meter IS NOT NULL
                ORDER BY reading_datetime DESC
                LIMIT 7
              ) sub;
            END IF;

            IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
              v_method := 'even_split';
              v_step := v_diff / (v_gap_days + 1);
            ELSE
              v_method := 'regression_flowrate';
              v_dpre := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff * 0.2), v_diff * 1.8);
              v_curvature := v_diff - v_dpre;
            END IF;

            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'ro_train' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND reading_datetime::date = v_cur_date
                LIMIT 1;

                IF v_has_reason THEN
                  IF FOUND AND v_is_est = true THEN
                    DELETE FROM public.ro_train_readings WHERE id = v_existing_id;
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                  v_skipped_count := v_skipped_count + 1;
                ELSE
                  IF v_method = 'even_split' THEN
                    v_val := ROUND(r_reading_a.permeate_meter + (v_step * k), 2);
                    v_daily_vol := ROUND(v_step, 2);
                  ELSE
                    v_u := k::numeric / (v_gap_days + 1)::numeric;
                    v_val := ROUND(r_reading_a.permeate_meter + (v_u * v_dpre) + (v_u * v_u * v_curvature), 2);
                    v_daily_vol := ROUND(v_diff / (v_gap_days + 1), 2);
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF NOT FOUND THEN
                    INSERT INTO public.ro_train_readings (
                      train_id, plant_id, reading_datetime, permeate_meter, permeate_meter_delta, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.ro_train_readings
                    SET permeate_meter = v_val, permeate_meter_delta = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'ro_train_readings', 'train_id', r_entity.id, r_entity.plant_id, v_cur_date, v_method, v_old_val, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  END IF;
                END IF;
              END IF;
            END LOOP;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'swept_count', v_swept_count,
    'skipped_count', v_skipped_count,
    'retracted_count', v_retracted_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated, anon, service_role;

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
