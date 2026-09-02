-- =============================================================================
-- Migration: 20260902000001_fix_backfill_timezone_and_cleanup_orphans.sql
--
-- Fixes timezone bucketing in fn_backfill_missing_readings and cleans up
-- duplicate/orphaned estimated readings.
--
-- PROBLEM:
--   1. PostgreSQL session timezone on Supabase defaults to UTC.
--   2. `reading_datetime::date` evaluated morning readings (e.g. 07:22 AM PHT)
--      as the PREVIOUS day in UTC (e.g. 23:22 UTC).
--   3. The backfill sweep therefore falsely assumed calendar dates were missing
--      a reading, and inserted an estimated reading at 12:00 PHT on that same date.
--   4. This created TWO readings on the same date (real morning reading + estimated noon reading),
--      causing delta calculations to produce negative readings (-5.85 m³).
--
-- SOLUTION:
--   1. Purge existing orphaned estimated rows where a real reading exists on the same Asia/Manila date.
--   2. In fn_backfill_missing_readings, enforce `SET timezone TO 'Asia/Manila'` and
--      explicitly cast all reading dates using `(reading_datetime AT TIME ZONE 'Asia/Manila')::date`.
--   3. Ensure real readings (`is_estimated = false`) are always prioritized in existing-row checks
--      (`ORDER BY COALESCE(is_estimated, false) ASC LIMIT 1`).
--   4. Add automatic pre-sweep purge of any orphaned estimated rows.
-- =============================================================================

-- ─── 1. Immediate Cleanup of Existing Orphaned Estimated Rows ─────────────────

DELETE FROM public.locator_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.locator_readings r
    WHERE r.locator_id = e.locator_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );

DELETE FROM public.well_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.well_readings r
    WHERE r.well_id = e.well_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );

DELETE FROM public.product_meter_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.product_meter_readings r
    WHERE r.meter_id = e.meter_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );

DELETE FROM public.blending_events e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.blending_events r
    WHERE r.well_id = e.well_id
      AND COALESCE(r.is_estimated, false) = false
      AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
  );

DELETE FROM public.power_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.power_readings r
    WHERE r.plant_id = e.plant_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );

DELETE FROM public.ro_train_readings e
WHERE e.is_estimated = true
  AND EXISTS (
    SELECT 1 FROM public.ro_train_readings r
    WHERE r.train_id = e.train_id
      AND COALESCE(r.is_estimated, false) = false
      AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
  );


-- ─── 2. Updated fn_backfill_missing_readings ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_backfill_missing_readings(
  p_date date DEFAULT (now() AT TIME ZONE 'Asia/Manila')::date,
  p_lookback_days integer DEFAULT 7
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'Asia/Manila'
AS $function$
DECLARE
  v_lookback        integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end      date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  v_target_start    date := v_target_end - (v_lookback || ' days')::interval;
  v_swept_count     integer := 0;
  v_skipped_count   integer := 0;
  v_retracted_count integer := 0;
  v_purged_count    integer := 0;

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

  -- ─── 0. Purge Orphaned Estimated Rows ────────────────────────────────────────
  WITH deleted AS (
    DELETE FROM public.locator_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.locator_readings r
        WHERE r.locator_id = e.locator_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.well_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.well_readings r
        WHERE r.well_id = e.well_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.product_meter_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.product_meter_readings r
        WHERE r.meter_id = e.meter_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.blending_events e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.blending_events r
        WHERE r.well_id = e.well_id
          AND COALESCE(r.is_estimated, false) = false
          AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.power_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.power_readings r
        WHERE r.plant_id = e.plant_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.ro_train_readings e
    WHERE e.is_estimated = true
      AND EXISTS (
        SELECT 1 FROM public.ro_train_readings r
        WHERE r.train_id = e.train_id
          AND COALESCE(r.is_estimated, false) = false
          AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  -- ─── Gap-fill thresholds ─────────────────────────────────────────────────────
  --   SQL literal 5   ↔  EVEN_SPLIT_THRESHOLD_DAYS = 5
  --   SQL literal 14  ↔  MAX_GAP_BACKFILL_DAYS = 14
  -- ─────────────────────────────────────────────────────────────────────────────

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators WHERE status = 'Active' AND is_derived = false
  LOOP
    FOR r_reading_a IN
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 
           AND NOT COALESCE(r_reading_b.is_meter_rollover, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.locator_readings
                WHERE locator_id = r_entity.id
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
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
                WHERE locator_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
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
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
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
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.well_readings
                WHERE well_id = r_entity.id
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
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
                WHERE well_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
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
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
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
              SELECT (r_reading_a.current_reading - MIN(current_reading)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT current_reading, reading_datetime
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
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
                WHERE meter_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
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
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (v_target_start - interval '14 days')::date
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) <= v_target_end
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
    LOOP
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) > r_reading_a.r_date
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.raw_meter_reading - MIN(raw_meter_reading)) / NULLIF(r_reading_a.r_date - MIN(COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date)), 0)
              INTO v_hist_rate
              FROM (
                SELECT raw_meter_reading, event_date, reading_datetime
                FROM public.blending_events
                WHERE well_id = r_entity.id
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) < r_reading_a.r_date
                  AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (r_reading_a.r_date - interval '14 days')::date
                ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) DESC
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
                WHERE well_id = r_entity.id AND (event_date = v_cur_date OR (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date)
                ORDER BY COALESCE(is_estimated, false) ASC
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
      SELECT id, meter_reading_kwh, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, meter_reading_kwh, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.meter_reading_kwh - r_reading_a.meter_reading_kwh;
          IF v_diff >= 0 THEN
            v_hist_rate := NULL;
            IF v_gap_days > 5 THEN
              SELECT (r_reading_a.meter_reading_kwh - MIN(meter_reading_kwh)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT meter_reading_kwh, reading_datetime
                FROM public.power_readings
                WHERE plant_id = r_entity.plant_id
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
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
                WHERE plant_id = r_entity.plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
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
    SELECT id, plant_id FROM public.ro_trains WHERE status = 'Running'
  LOOP
    FOR r_reading_a IN
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
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
              SELECT (r_reading_a.permeate_meter - MIN(permeate_meter)) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
              INTO v_hist_rate
              FROM (
                SELECT permeate_meter, reading_datetime
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                  AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
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
                WHERE train_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
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

