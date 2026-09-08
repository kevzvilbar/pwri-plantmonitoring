-- =============================================================================
-- Migration: 20260905000005_fix_backfill_boundary_anchors_and_monotonicity.sql
--
-- BUG FIX: Backfill formula error when days have multiple intra-day readings.
--
-- Root Cause:
--   1. Boundary Anchor Selection:
--      When a date had multiple human readings (e.g., Aug 31 with 06:00, 07:00, 21:56),
--      r_reading_a was ordered ASC, selecting the earliest morning reading (06:00, 148,470)
--      as the pre-gap baseline rather than the latest reading of that date (21:56, 148,700).
--      Interpolating across to Sep 02 (148,902) produced an estimated reading of 148,686,
--      which was LESS than the 21:56 reading (148,700), resulting in a negative delta (-14.00 m³).
--   2. Invalidation & Monotonicity:
--      Section 0 previously only purged estimated readings if a human reading existed
--      on the EXACT same date. It did NOT purge estimated readings that violated
--      monotonicity (i.e. where an earlier non-rollover human reading had a higher value,
--      or a later non-rollover human reading had a lower value).
--
-- Solution:
--   1. In Section 0, purge any estimated reading that violates strict monotonicity
--      against adjacent human readings.
--   2. In Modules 1–6, change r_reading_a to use:
--      DISTINCT ON (date) ... ORDER BY date ASC, reading_datetime DESC
--      so the chronologically LATEST reading of that date is ALWAYS chosen as the pre-gap baseline.
--   3. Keep r_reading_b as ORDER BY reading_datetime ASC LIMIT 1
--      so the chronologically EARLIEST reading of the post-gap date is chosen.
--   4. Add strict monotonicity clamps during value calculation:
--      for cumulative meters without rollover, v_val must strictly satisfy
--      r_reading_a.current_reading < v_val < r_reading_b.current_reading.
--   5. Run a 30-day sweep immediately to repair any corrupted estimates.
-- =============================================================================

-- ─── 0. Purge Existing Stale / Non-Monotonic Estimated Readings ───────────────

-- Locator readings: purge estimated rows that are <= preceding human reading or >= succeeding human reading
DELETE FROM public.locator_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.locator_readings r
      WHERE r.locator_id = e.locator_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'locator'
        AND gr.entity_id = e.locator_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.locators l
      WHERE l.id = e.locator_id
        AND (COALESCE(l.default_input_mode, 'raw') = 'direct' OR COALESCE(l.is_derived, false) = true)
    )
    OR EXISTS (
      SELECT 1 FROM public.locator_readings prev_r
      WHERE prev_r.locator_id = e.locator_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.locator_readings next_r
      WHERE next_r.locator_id = e.locator_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Well readings: purge estimated rows that violate monotonicity
DELETE FROM public.well_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.well_readings r
      WHERE r.well_id = e.well_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'well'
        AND gr.entity_id = e.well_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.well_readings prev_r
      WHERE prev_r.well_id = e.well_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.well_readings next_r
      WHERE next_r.well_id = e.well_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Product meter readings: purge estimated rows that violate monotonicity
DELETE FROM public.product_meter_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.product_meter_readings r
      WHERE r.meter_id = e.meter_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'product'
        AND gr.entity_id = e.meter_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meters pm
      WHERE pm.id = e.meter_id
        AND COALESCE(pm.is_derived, false) = true
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meter_readings prev_r
      WHERE prev_r.meter_id = e.meter_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_meter_rollover, false) = false
        AND COALESCE(e.is_meter_rollover, false) = false
        AND prev_r.current_reading >= e.current_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.product_meter_readings next_r
      WHERE next_r.meter_id = e.meter_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_meter_rollover, false) = false
        AND next_r.current_reading <= e.current_reading
    )
  );

-- Blending events: purge estimated rows that violate monotonicity
DELETE FROM public.blending_events e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.blending_events r
      WHERE r.well_id = e.well_id
        AND COALESCE(r.is_estimated, false) = false
        AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'blending'
        AND gr.entity_id = e.well_id
        AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
    )
    OR EXISTS (
      SELECT 1 FROM public.blending_events prev_r
      WHERE prev_r.well_id = e.well_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND COALESCE(prev_r.event_date, (prev_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) < COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND prev_r.raw_meter_reading >= e.raw_meter_reading
    )
    OR EXISTS (
      SELECT 1 FROM public.blending_events next_r
      WHERE next_r.well_id = e.well_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND COALESCE(next_r.event_date, (next_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) > COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND next_r.raw_meter_reading <= e.raw_meter_reading
    )
  );

-- Power readings: purge estimated rows that violate monotonicity
DELETE FROM public.power_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.power_readings r
      WHERE r.plant_id = e.plant_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'power'
        AND gr.entity_id = e.plant_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR e.daily_solar_kwh IS NOT NULL
    OR e.solar_meter_reading IS NOT NULL
    OR e.grid_meter_readings IS NULL
    OR e.grid_meter_readings = '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM public.power_readings prev_r
      WHERE prev_r.plant_id = e.plant_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_grid_replacement, false) = false
        AND COALESCE((prev_r.grid_meter_readings ->> '0')::numeric, prev_r.meter_reading_kwh) >= COALESCE((e.grid_meter_readings ->> '0')::numeric, e.meter_reading_kwh)
    )
    OR EXISTS (
      SELECT 1 FROM public.power_readings next_r
      WHERE next_r.plant_id = e.plant_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_grid_replacement, false) = false
        AND COALESCE((next_r.grid_meter_readings ->> '0')::numeric, next_r.meter_reading_kwh) <= COALESCE((e.grid_meter_readings ->> '0')::numeric, e.meter_reading_kwh)
    )
  );

-- RO Train readings: purge estimated rows that violate monotonicity
DELETE FROM public.ro_train_readings e
WHERE e.is_estimated = true
  AND (
    EXISTS (
      SELECT 1 FROM public.ro_train_readings r
      WHERE r.train_id = e.train_id
        AND COALESCE(r.is_estimated, false) = false
        AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.reading_gap_reasons gr
      WHERE gr.entity_type = 'ro_train'
        AND gr.entity_id = e.train_id
        AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
    )
    OR EXISTS (
      SELECT 1 FROM public.ro_train_readings prev_r
      WHERE prev_r.train_id = e.train_id
        AND COALESCE(prev_r.is_estimated, false) = false
        AND prev_r.reading_datetime < e.reading_datetime
        AND COALESCE(prev_r.is_meter_replacement, false) = false
        AND COALESCE(prev_r.is_permeate_meter_replacement, false) = false
        AND prev_r.permeate_meter >= e.permeate_meter
    )
    OR EXISTS (
      SELECT 1 FROM public.ro_train_readings next_r
      WHERE next_r.train_id = e.train_id
        AND COALESCE(next_r.is_estimated, false) = false
        AND next_r.reading_datetime > e.reading_datetime
        AND COALESCE(next_r.is_meter_replacement, false) = false
        AND COALESCE(next_r.is_permeate_meter_replacement, false) = false
        AND next_r.permeate_meter <= e.permeate_meter
    )
  );


-- ─── 1. Recreate fn_backfill_missing_readings With Boundary Fixes ─────────────

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
  v_lookback                integer := LEAST(GREATEST(COALESCE(p_lookback_days, 7), 1), 30);
  v_target_end              date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Manila')::date);
  v_target_start            date := v_target_end - (v_lookback || ' days')::interval;
  v_swept_count             integer := 0;
  v_skipped_count           integer := 0;
  v_retracted_count         integer := 0;
  v_purged_count            integer := 0;

  -- Iteration variables
  r_entity                  RECORD;
  r_reading_a               RECORD;
  r_reading_b               RECORD;
  v_gap_days                integer;
  v_step                    numeric;
  v_val                     numeric;
  v_daily_vol               numeric;
  v_cur_date                date;
  v_dt_iso                  timestamptz;
  v_has_reason              boolean;
  v_existing_id             uuid;
  v_is_est                  boolean;
  v_old_val                 numeric;
  v_old_gmr                 jsonb;
  v_diff                    numeric;
  v_method                  text;
  v_hist_rate               numeric;
  v_dpre                    numeric;
  v_u                       numeric;
  v_curvature               numeric;

  -- Multi-meter power variables
  v_grid_meter_count        integer;
  v_grid_meter_multipliers  numeric[];
  v_gmr_jsonb               jsonb;
  v_total_daily_kwh         numeric;
  v_val_a                   numeric;
  v_val_b                   numeric;
  v_diff_m                  numeric;
  v_step_m                  numeric;
  v_mult_m                  numeric;
  v_val_m_k                 numeric;
  v_daily_m_k               numeric;
  v_kwh_m_k                 numeric;
  v_dpre_m                  numeric;
  v_curvature_m             numeric;
  mi                        integer;
BEGIN

  -- ─── 0. Purge Orphaned & Non-Monotonic Estimated Rows ───────────────────────
  WITH deleted AS (
    DELETE FROM public.locator_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.locator_readings r
          WHERE r.locator_id = e.locator_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'locator'
            AND gr.entity_id = e.locator_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.locators l
          WHERE l.id = e.locator_id
            AND (COALESCE(l.default_input_mode, 'raw') = 'direct' OR COALESCE(l.is_derived, false) = true)
        )
        OR EXISTS (
          SELECT 1 FROM public.locator_readings prev_r
          WHERE prev_r.locator_id = e.locator_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.locator_readings next_r
          WHERE next_r.locator_id = e.locator_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.well_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.well_readings r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'well'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.well_readings prev_r
          WHERE prev_r.well_id = e.well_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.well_readings next_r
          WHERE next_r.well_id = e.well_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.product_meter_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.product_meter_readings r
          WHERE r.meter_id = e.meter_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'product'
            AND gr.entity_id = e.meter_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meters pm
          WHERE pm.id = e.meter_id
            AND COALESCE(pm.is_derived, false) = true
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meter_readings prev_r
          WHERE prev_r.meter_id = e.meter_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_meter_rollover, false) = false
            AND COALESCE(e.is_meter_rollover, false) = false
            AND prev_r.current_reading >= e.current_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.product_meter_readings next_r
          WHERE next_r.meter_id = e.meter_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_meter_rollover, false) = false
            AND next_r.current_reading <= e.current_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.blending_events e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.blending_events r
          WHERE r.well_id = e.well_id
            AND COALESCE(r.is_estimated, false) = false
            AND COALESCE(r.event_date, (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'blending'
            AND gr.entity_id = e.well_id
            AND gr.gap_date = COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
        )
        OR EXISTS (
          SELECT 1 FROM public.blending_events prev_r
          WHERE prev_r.well_id = e.well_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND COALESCE(prev_r.event_date, (prev_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) < COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND prev_r.raw_meter_reading >= e.raw_meter_reading
        )
        OR EXISTS (
          SELECT 1 FROM public.blending_events next_r
          WHERE next_r.well_id = e.well_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND COALESCE(next_r.event_date, (next_r.reading_datetime AT TIME ZONE 'Asia/Manila')::date) > COALESCE(e.event_date, (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date)
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND next_r.raw_meter_reading <= e.raw_meter_reading
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.power_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.power_readings r
          WHERE r.plant_id = e.plant_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'power'
            AND gr.entity_id = e.plant_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR e.daily_solar_kwh IS NOT NULL
        OR e.solar_meter_reading IS NOT NULL
        OR e.grid_meter_readings IS NULL
        OR e.grid_meter_readings = '{}'::jsonb
        OR EXISTS (
          SELECT 1 FROM public.power_readings prev_r
          WHERE prev_r.plant_id = e.plant_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_grid_replacement, false) = false
            AND COALESCE((prev_r.grid_meter_readings ->> '0')::numeric, prev_r.meter_reading_kwh) >= COALESCE((e.grid_meter_readings ->> '0')::numeric, e.meter_reading_kwh)
        )
        OR EXISTS (
          SELECT 1 FROM public.power_readings next_r
          WHERE next_r.plant_id = e.plant_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_grid_replacement, false) = false
            AND COALESCE((next_r.grid_meter_readings ->> '0')::numeric, next_r.meter_reading_kwh) <= COALESCE((e.grid_meter_readings ->> '0')::numeric, e.meter_reading_kwh)
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  WITH deleted AS (
    DELETE FROM public.ro_train_readings e
    WHERE e.is_estimated = true
      AND (
        EXISTS (
          SELECT 1 FROM public.ro_train_readings r
          WHERE r.train_id = e.train_id
            AND COALESCE(r.is_estimated, false) = false
            AND (r.reading_datetime AT TIME ZONE 'Asia/Manila')::date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.reading_gap_reasons gr
          WHERE gr.entity_type = 'ro_train'
            AND gr.entity_id = e.train_id
            AND gr.gap_date = (e.reading_datetime AT TIME ZONE 'Asia/Manila')::date
        )
        OR EXISTS (
          SELECT 1 FROM public.ro_train_readings prev_r
          WHERE prev_r.train_id = e.train_id
            AND COALESCE(prev_r.is_estimated, false) = false
            AND prev_r.reading_datetime < e.reading_datetime
            AND COALESCE(prev_r.is_meter_replacement, false) = false
            AND COALESCE(prev_r.is_permeate_meter_replacement, false) = false
            AND prev_r.permeate_meter >= e.permeate_meter
        )
        OR EXISTS (
          SELECT 1 FROM public.ro_train_readings next_r
          WHERE next_r.train_id = e.train_id
            AND COALESCE(next_r.is_estimated, false) = false
            AND next_r.reading_datetime > e.reading_datetime
            AND COALESCE(next_r.is_meter_replacement, false) = false
            AND COALESCE(next_r.is_permeate_meter_replacement, false) = false
            AND next_r.permeate_meter <= e.permeate_meter
        )
      )
    RETURNING 1
  ) SELECT count(*) INTO v_purged_count FROM deleted;
  v_retracted_count := v_retracted_count + v_purged_count;

  -- ───────────────────────────────────────────────────────────────────────────
  -- MODULE 1: LOCATORS (locator_readings)
  -- EXEMPTION: Only cumulative odometer locators (default_input_mode <> 'direct'
  -- and is_derived = false). Direct volume locators must NEVER be backfilled.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.locators
    WHERE status = 'Active'
      AND is_derived = false
      AND COALESCE(default_input_mode, 'raw') <> 'direct'
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_rollover
      INTO r_reading_b
      FROM public.locator_readings
      WHERE locator_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
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
                  AND COALESCE(is_estimated, false) = false
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

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.locator_readings
                WHERE locator_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
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

                  -- Strict Monotonicity Guard: ensure v_val stays strictly between bounding readings
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
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
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.well_readings
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
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
                  AND COALESCE(is_estimated, false) = false
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

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.well_readings
                WHERE well_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
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

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
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
  -- EXEMPTION: Only cumulative physical product meters (is_derived = false).
  -- Derived/virtual product meters (e.g. Parkmall, Coke, HAMAS) must never be backfilled.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id, plant_id FROM public.product_meters
    WHERE status = 'Active'
      AND COALESCE(is_derived, false) = false
  LOOP
    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, current_reading, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_meter_rollover
      INTO r_reading_b
      FROM public.product_meter_readings
      WHERE meter_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
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
                  AND COALESCE(is_estimated, false) = false
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

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, current_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.product_meter_readings
                WHERE meter_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
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

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.current_reading OR v_val >= r_reading_b.current_reading THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
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
      SELECT DISTINCT ON (COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date))
             id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) >= (v_target_start - interval '14 days')::date
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) <= v_target_end
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC, reading_datetime DESC
    LOOP
      SELECT id, raw_meter_reading, COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.blending_events
      WHERE well_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) > r_reading_a.r_date
      ORDER BY COALESCE(event_date, (reading_datetime AT TIME ZONE 'Asia/Manila')::date) ASC, reading_datetime ASC
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
                  AND COALESCE(is_estimated, false) = false
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

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, raw_meter_reading INTO v_existing_id, v_is_est, v_old_val
                FROM public.blending_events
                WHERE well_id = r_entity.id AND (event_date = v_cur_date OR (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date)
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
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

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.raw_meter_reading OR v_val >= r_reading_b.raw_meter_reading THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
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
  -- MODULE 5: POWER (power_readings) - MULTI-METER GRID SUPPORT
  -- EXEMPTION: Solar generation (daily_solar_kwh / solar_meter_reading) is direct
  -- power and is strictly EXEMPT from backfill. Only cumulative grid meters are
  -- backfilled. Plants without grid (has_grid = false) are skipped.
  -- ───────────────────────────────────────────────────────────────────────────
  FOR r_entity IN
    SELECT id AS plant_id FROM public.plants
    WHERE status = 'Active'
      AND COALESCE(has_grid, true) = true
  LOOP
    -- Discover configured grid meter count and CT multipliers
    SELECT
      COALESCE(grid_meter_count, 1),
      grid_meter_multipliers
    INTO
      v_grid_meter_count,
      v_grid_meter_multipliers
    FROM public.plant_power_config
    WHERE plant_id = r_entity.plant_id;

    IF NOT FOUND OR v_grid_meter_count IS NULL OR v_grid_meter_count < 1 THEN
      v_grid_meter_count := 1;
    END IF;

    FOR r_reading_a IN
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND (meter_reading_kwh IS NOT NULL OR grid_meter_readings IS NOT NULL)
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, meter_reading_kwh, grid_meter_readings, meter_multiplier, multiplier,
             (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement
      INTO r_reading_b
      FROM public.power_readings
      WHERE plant_id = r_entity.plant_id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date > r_reading_a.r_date
        AND (meter_reading_kwh IS NOT NULL OR grid_meter_readings IS NOT NULL)
      ORDER BY reading_datetime ASC
      LIMIT 1;

      IF FOUND THEN
        v_gap_days := (r_reading_b.r_date - r_reading_a.r_date) - 1;
        IF v_gap_days >= 1 AND v_gap_days <= 14 AND NOT COALESCE(r_reading_b.is_meter_replacement, false) THEN
          
          -- Dynamically ensure v_grid_meter_count covers all indices in both bounding rows
          IF r_reading_a.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_a.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;
          IF r_reading_b.grid_meter_readings IS NOT NULL THEN
            SELECT GREATEST(v_grid_meter_count, COALESCE(MAX(key::integer) + 1, 1))
            INTO v_grid_meter_count
            FROM jsonb_each(r_reading_b.grid_meter_readings)
            WHERE key ~ '^\d+$';
          END IF;

          -- Historical rate regression check for meter 0 if gap > 5 days
          v_hist_rate := NULL;
          IF v_gap_days > 5 THEN
            SELECT (
              COALESCE((r_reading_a.grid_meter_readings ->> '0')::numeric, r_reading_a.meter_reading_kwh)
              - MIN(COALESCE((grid_meter_readings ->> '0')::numeric, meter_reading_kwh))
            ) / NULLIF(r_reading_a.r_date - MIN((reading_datetime AT TIME ZONE 'Asia/Manila')::date), 0)
            INTO v_hist_rate
            FROM (
              SELECT meter_reading_kwh, grid_meter_readings, reading_datetime
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id
                AND COALESCE(is_estimated, false) = false
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date < r_reading_a.r_date
                AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (r_reading_a.r_date - interval '14 days')
              ORDER BY reading_datetime DESC
              LIMIT 7
            ) sub;
          END IF;

          IF v_gap_days <= 5 OR v_hist_rate IS NULL OR v_hist_rate <= 0 THEN
            v_method := 'even_split';
          ELSE
            v_method := 'regression_flowrate';
          END IF;

          FOR k IN 1..v_gap_days LOOP
            v_cur_date := r_reading_a.r_date + k;
            IF v_cur_date >= v_target_start AND v_cur_date <= v_target_end THEN
              SELECT EXISTS (
                SELECT 1 FROM public.reading_gap_reasons
                WHERE entity_type = 'power' AND entity_id = r_entity.plant_id AND gap_date = v_cur_date
              ) INTO v_has_reason;

              v_existing_id := NULL;
              v_is_est := NULL;
              v_old_val := NULL;
              v_old_gmr := NULL;

              SELECT id, is_estimated, meter_reading_kwh, grid_meter_readings
              INTO v_existing_id, v_is_est, v_old_val, v_old_gmr
              FROM public.power_readings
              WHERE plant_id = r_entity.plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
              ORDER BY COALESCE(is_estimated, false) ASC
              LIMIT 1;

              IF v_has_reason THEN
                IF v_existing_id IS NOT NULL AND v_is_est = true THEN
                  DELETE FROM public.power_readings WHERE id = v_existing_id;
                  v_retracted_count := v_retracted_count + 1;
                END IF;
                v_skipped_count := v_skipped_count + 1;
              ELSE
                -- Build grid_meter_readings JSONB and total daily consumption across all grid meters
                v_gmr_jsonb := '{}'::jsonb;
                v_total_daily_kwh := 0;

                FOR mi IN 0..(v_grid_meter_count - 1) LOOP
                  IF mi = 0 THEN
                    v_val_a := COALESCE(
                      CASE WHEN r_reading_a.grid_meter_readings ? '0' THEN (r_reading_a.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_a.meter_reading_kwh
                    );
                    v_val_b := COALESCE(
                      CASE WHEN r_reading_b.grid_meter_readings ? '0' THEN (r_reading_b.grid_meter_readings ->> '0')::numeric ELSE NULL END,
                      r_reading_b.meter_reading_kwh
                    );
                  ELSE
                    v_val_a := (r_reading_a.grid_meter_readings ->> mi::text)::numeric;
                    v_val_b := (r_reading_b.grid_meter_readings ->> mi::text)::numeric;
                  END IF;

                  IF v_val_a IS NOT NULL AND v_val_b IS NOT NULL AND v_val_b >= v_val_a THEN
                    v_diff_m := v_val_b - v_val_a;
                    v_step_m := v_diff_m / (v_gap_days + 1);

                    -- Determine CT multiplier for this meter
                    v_mult_m := 1;
                    IF v_grid_meter_multipliers IS NOT NULL AND array_length(v_grid_meter_multipliers, 1) >= (mi + 1) THEN
                      v_mult_m := COALESCE(v_grid_meter_multipliers[mi + 1], 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    ELSE
                      v_mult_m := COALESCE(r_reading_a.meter_multiplier, r_reading_a.multiplier, 1);
                      IF v_mult_m <= 0 THEN v_mult_m := 1; END IF;
                    END IF;

                    IF v_method = 'even_split' THEN
                      v_val_m_k := ROUND(v_val_a + (v_step_m * k), 2);
                      v_daily_m_k := ROUND(v_step_m, 2);
                    ELSE
                      v_u := k::numeric / (v_gap_days + 1)::numeric;
                      v_dpre_m := LEAST(GREATEST(v_hist_rate * (v_gap_days + 1), v_diff_m * 0.2), v_diff_m * 1.8);
                      v_curvature_m := v_diff_m - v_dpre_m;
                      v_val_m_k := ROUND(v_val_a + (v_u * v_dpre_m) + (v_u * v_u * v_curvature_m), 2);
                      v_daily_m_k := ROUND(v_diff_m / (v_gap_days + 1), 2);
                    END IF;

                    -- Strict monotonicity clamp per meter
                    IF v_val_m_k < v_val_a THEN v_val_m_k := v_val_a; END IF;
                    IF v_val_m_k > v_val_b THEN v_val_m_k := v_val_b; END IF;

                    v_kwh_m_k := v_daily_m_k * v_mult_m;
                    v_gmr_jsonb := v_gmr_jsonb || jsonb_build_object(mi::text, v_val_m_k);
                    v_total_daily_kwh := v_total_daily_kwh + v_kwh_m_k;
                  END IF;
                END LOOP;

                IF v_gmr_jsonb <> '{}'::jsonb THEN
                  v_val := CASE WHEN v_gmr_jsonb ? '0' THEN (v_gmr_jsonb ->> '0')::numeric ELSE NULL END;
                  v_daily_vol := ROUND(v_total_daily_kwh, 2);
                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  -- NOTE: daily_solar_kwh and solar_meter_reading are NEVER backfilled
                  IF v_existing_id IS NULL THEN
                    INSERT INTO public.power_readings (
                      plant_id, reading_datetime, meter_reading_kwh, grid_meter_readings,
                      daily_consumption_kwh, daily_grid_kwh, is_estimated
                    ) VALUES (
                      r_entity.plant_id, v_dt_iso, v_val, v_gmr_jsonb,
                      v_daily_vol, v_daily_vol, true
                    );
                    INSERT INTO public.backfill_sweep_log (
                      table_name, entity_fk_col, entity_fk_val, plant_id, date_key, method, old_value, new_value, changed
                    ) VALUES (
                      'power_readings', null, null, r_entity.plant_id, v_cur_date, v_method, null, v_val, true
                    );
                    v_swept_count := v_swept_count + 1;
                  ELSIF v_is_est = true AND (v_old_val IS DISTINCT FROM v_val OR v_old_gmr IS DISTINCT FROM v_gmr_jsonb) THEN
                    UPDATE public.power_readings
                    SET meter_reading_kwh = v_val,
                        grid_meter_readings = v_gmr_jsonb,
                        daily_consumption_kwh = v_daily_vol,
                        daily_grid_kwh = v_daily_vol,
                        daily_solar_kwh = NULL,
                        solar_meter_reading = NULL
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
            END IF;
          END LOOP;
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
      SELECT DISTINCT ON ((reading_datetime AT TIME ZONE 'Asia/Manila')::date)
             id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date >= (v_target_start - interval '14 days')
        AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date <= v_target_end
        AND permeate_meter IS NOT NULL
      ORDER BY (reading_datetime AT TIME ZONE 'Asia/Manila')::date ASC, reading_datetime DESC
    LOOP
      SELECT id, permeate_meter, (reading_datetime AT TIME ZONE 'Asia/Manila')::date AS r_date, is_meter_replacement, is_permeate_meter_replacement
      INTO r_reading_b
      FROM public.ro_train_readings
      WHERE train_id = r_entity.id
        AND COALESCE(is_estimated, false) = false
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
                  AND COALESCE(is_estimated, false) = false
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

                v_existing_id := NULL;
                v_is_est := NULL;
                v_old_val := NULL;

                SELECT id, is_estimated, permeate_meter INTO v_existing_id, v_is_est, v_old_val
                FROM public.ro_train_readings
                WHERE train_id = r_entity.id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_cur_date
                ORDER BY COALESCE(is_estimated, false) ASC
                LIMIT 1;

                IF v_has_reason THEN
                  IF v_existing_id IS NOT NULL AND v_is_est = true THEN
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

                  -- Strict Monotonicity Guard
                  IF v_val <= r_reading_a.permeate_meter OR v_val >= r_reading_b.permeate_meter THEN
                    CONTINUE;
                  END IF;

                  v_dt_iso := (v_cur_date::text || ' 12:00:00+08')::timestamptz;

                  IF v_existing_id IS NULL THEN
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

-- Run 30-day sweep to immediately clean up invalid estimates and reconcile
SELECT public.fn_backfill_missing_readings((now() AT TIME ZONE 'Asia/Manila')::date, 30);

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';

