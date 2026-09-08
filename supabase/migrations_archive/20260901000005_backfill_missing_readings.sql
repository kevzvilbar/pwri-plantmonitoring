-- =============================================================================
-- Migration: 20260901000005_backfill_missing_readings.sql
--
-- Purpose:
--   1. Extends `reading_gap_reasons` CHECK constraint to include 'power'.
--   2. Creates `backfill_sweep_log` audit table.
--   3. Creates `fn_backfill_missing_readings(p_date, p_lookback_days)` RPC function
--      to automatically backfill bounded missing reading gaps across:
--        - locator_readings
--        - well_readings
--        - product_meter_readings
--        - blending_events
--        - power_readings
--        - ro_train_readings
--
-- Rules & Guards:
--   • Bounded gaps only (never forward project past the latest real reading).
--   • Even Δ distribution across short bounded gaps (≤ 5 days).
--   • Remarks exemption: skips dates that have an entry in `reading_gap_reasons`.
--   • Rollover / replacement respect: handles meter resets safely.
--   • Sets `is_estimated = true` on all generated/backfilled rows.
--   • Never overwrites operator entries (`is_estimated = false`).
-- =============================================================================

-- 1. Extend reading_gap_reasons entity_type check
ALTER TABLE public.reading_gap_reasons DROP CONSTRAINT IF EXISTS reading_gap_reasons_entity_type_check;
ALTER TABLE public.reading_gap_reasons ADD CONSTRAINT reading_gap_reasons_entity_type_check
  CHECK (entity_type IN ('well', 'locator', 'ro_train', 'blending', 'product', 'power'));

-- 2. Audit Table for backfill sweep executions
CREATE TABLE IF NOT EXISTS public.backfill_sweep_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name     TEXT NOT NULL,
  entity_fk_col  TEXT,
  entity_fk_val  UUID,
  plant_id       UUID REFERENCES public.plants(id) ON DELETE SET NULL,
  date_key       DATE NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('even_split', 'regression_flowrate')),
  old_value      NUMERIC,
  new_value      NUMERIC,
  changed        BOOLEAN NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backfill_sweep_log_table_date
  ON public.backfill_sweep_log (table_name, date_key DESC);

ALTER TABLE public.backfill_sweep_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "backfill_sweep_log_auth" ON public.backfill_sweep_log;
CREATE POLICY "backfill_sweep_log_auth" ON public.backfill_sweep_log FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "backfill_sweep_log_anon" ON public.backfill_sweep_log;
CREATE POLICY "backfill_sweep_log_anon" ON public.backfill_sweep_log FOR ALL TO anon USING (true);

-- 3. Core Backfill Function
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
  v_lookback      integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end    date := p_date;
  v_target_start  date := p_date - (v_lookback || ' days')::interval;
  v_swept_count   integer := 0;
  v_skipped_count integer := 0;
  v_retracted_count integer := 0;

  -- Iteration variables
  r_entity        RECORD;
  r_reading_a     RECORD;
  r_reading_b     RECORD;
  v_gap_days      integer;
  v_step          numeric;
  v_val           numeric;
  v_daily_vol     numeric;
  v_cur_date      date;
  v_dt_iso        timestamptz;
  v_has_reason    boolean;
  v_existing_id   uuid;
  v_is_est        boolean;
  v_old_val       numeric;
  v_diff          numeric;
BEGIN

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
        AND reading_datetime::date >= (v_target_start - interval '7 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        -- Apply even-split backfill for bounded gaps 1..5 days
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              -- Only write within lookback window
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                -- Check remarks exemption
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'locator' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- If there's now a remark for this date, retract any existing estimated reading
                  DELETE FROM public.locator_readings
                  WHERE locator_id = r_entity.id 
                    AND reading_datetime::date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  -- Check existing row
                  SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                  FROM public.locator_readings
                  WHERE locator_id = r_entity.id AND reading_datetime::date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.locator_readings (
                      locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.locator_readings
                    SET current_reading = v_val, previous_reading = ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2)
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'locator_readings', 'locator_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
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
        AND reading_datetime::date >= (v_target_start - interval '7 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'well' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- Retract any existing estimated reading for this gap date
                  DELETE FROM public.well_readings
                  WHERE well_id = r_entity.id 
                    AND reading_datetime::date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  v_daily_vol := ROUND(v_step, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                  FROM public.well_readings
                  WHERE well_id = r_entity.id AND reading_datetime::date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.well_readings (
                      well_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.well_readings
                    SET current_reading = v_val, previous_reading = ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'well_readings', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
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
        AND reading_datetime::date >= (v_target_start - interval '7 days')
        AND reading_datetime::date <= v_target_end
      ORDER BY reading_datetime ASC
    LOOP
      SELECT id, current_reading, reading_datetime::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND reading_datetime::date > r_reading_a.r_date
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.current_reading - r_reading_a.current_reading;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'product' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- Retract any existing estimated reading for this gap date
                  DELETE FROM public.product_meter_readings
                  WHERE meter_id = r_entity.id 
                    AND reading_datetime::date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.current_reading + (v_step * k), 2);
                  v_daily_vol := ROUND(v_step, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                  FROM public.product_meter_readings
                  WHERE meter_id = r_entity.id AND reading_datetime::date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.product_meter_readings (
                      meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, v_dt_iso, v_val, ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.product_meter_readings
                    SET current_reading = v_val, previous_reading = ROUND(r_reading_a.current_reading + (v_step * (k - 1)), 2), daily_volume = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'product_meter_readings', 'meter_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
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
        AND event_date >= (v_target_start - interval '7 days')::date
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
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.raw_meter_reading - r_reading_a.raw_meter_reading;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'blending' AND entity_id = r_entity.id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- Retract any existing estimated reading for this gap date
                  DELETE FROM public.blending_events
                  WHERE well_id = r_entity.id 
                    AND event_date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.raw_meter_reading + (v_step * k), 2);
                  v_daily_vol := ROUND(v_step, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                  FROM public.blending_events
                  WHERE well_id = r_entity.id AND event_date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.blending_events (
                      well_id, plant_id, well_name, event_date, reading_datetime, raw_meter_reading, volume_m3, is_estimated
                    ) VALUES (
                      r_entity.id, r_entity.plant_id, r_entity.well_name, v_cur_date, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.blending_events
                    SET raw_meter_reading = v_val, volume_m3 = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'blending_events', 'well_id', r_entity.id, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
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
        AND reading_datetime::date >= (v_target_start - interval '7 days')
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
        IF v_gap_days >= 1 AND v_gap_days <= 5 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          v_diff := r_reading_b.meter_reading_kwh - r_reading_a.meter_reading_kwh;
          IF v_diff >= 0 THEN
            v_step := v_diff / (v_gap_days + 1);
            FOR k IN 1..v_gap_days LOOP
              v_cur_date := r_reading_a.r_date + k;
              IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
                SELECT EXISTS (
                  SELECT 1 FROM public.reading_gap_reasons
                  WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
                ) INTO v_has_reason;

                IF v_has_reason THEN
                  v_skipped_count := v_skipped_count + 1;
                  -- Retract any existing estimated reading for this gap date
                  DELETE FROM public.power_readings
                  WHERE plant_id = r_entity.plant_id 
                    AND reading_datetime::date = v_cur_date 
                    AND is_estimated = true;
                  IF FOUND THEN
                    v_retracted_count := v_retracted_count + 1;
                  END IF;
                ELSE
                  v_val := ROUND(r_reading_a.meter_reading_kwh + (v_step * k), 2);
                  v_daily_vol := ROUND(v_step, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  SELECT id, is_estimated, meter_reading_kwh INTO v_existing_id, v_is_est, v_old_val
                  FROM public.power_readings
                  WHERE plant_id = r_entity.plant_id AND reading_datetime::date = v_cur_date
                  LIMIT 1;

                  IF NOT FOUND THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, daily_consumption_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, 'even_split', null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND v_old_val <> v_val THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val, daily_consumption_kwh = v_daily_vol
                    WHERE id = v_existing_id;
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, 'even_split', v_old_val, v_val, true
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
  -- MODULE 6: RO TRAIN READINGS (ro_train_readings) — Orphan Purge
  -- ───────────────────────────────────────────────────────────────────────────
  -- When a real (non-estimated) reading is logged on a date that previously
  -- had only an estimated backfill, delete the estimated row to avoid duplicates.
  DELETE FROM public.ro_train_readings rtr
  WHERE is_estimated = true
    AND reading_datetime::date >= v_target_start
    AND reading_datetime::date <= v_target_end
    AND EXISTS (
      SELECT 1 FROM public.ro_train_readings rtr2
      WHERE rtr2.train_id = rtr.train_id
        AND rtr2.is_estimated = false
        AND rtr2.reading_datetime::date = rtr.reading_datetime::date
    );
  v_retracted_count := v_retracted_count + (SELECT changes());

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

GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_backfill_missing_readings(date, integer) TO anon;
