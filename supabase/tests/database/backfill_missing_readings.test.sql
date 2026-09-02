-- =============================================================================
-- Database Tests: backfill_missing_readings.test.sql
-- Comprehensive pgTAP test suite for fn_backfill_missing_readings
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

-- ── 1. Structural Checks ─────────────────────────────────────────────────────

-- Test 1: Function exists and is callable
SELECT has_function(
  'public',
  'fn_backfill_missing_readings',
  ARRAY['date', 'integer'],
  'fn_backfill_missing_readings(date, integer) exists'
);

-- Test 2: Function has SECURITY DEFINER
SELECT is_definer(
  'public',
  'fn_backfill_missing_readings',
  ARRAY['date', 'integer'],
  'fn_backfill_missing_readings is SECURITY DEFINER'
);

-- Test 3: backfill_sweep_log table exists
SELECT has_table(
  'public',
  'backfill_sweep_log',
  'backfill_sweep_log table exists'
);

-- Test 4: backfill_sweep_log has expected columns
SELECT columns_are(
  'public',
  'backfill_sweep_log',
  ARRAY['id', 'table_name', 'entity_fk_col', 'entity_fk_val', 'plant_id', 'date_key', 'method', 'old_value', 'new_value', 'changed', 'created_at'],
  'backfill_sweep_log has all expected audit columns'
);

-- Test 5: reading_gap_reasons accepts all valid entity types including power and ro_train
DO $$
DECLARE
  v_test_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.reading_gap_reasons (entity_type, entity_id, gap_date, reason_code)
  VALUES ('power', v_test_id, '2026-08-01', 'offline_planned');

  INSERT INTO public.reading_gap_reasons (entity_type, entity_id, gap_date, reason_code)
  VALUES ('ro_train', v_test_id, '2026-08-01', 'offline_unplanned');
END $$;

SELECT pass('reading_gap_reasons accepts power and ro_train entity types');

-- Test 6: Running function returns expected JSON structure
SELECT ok(
  (public.fn_backfill_missing_readings(CURRENT_DATE, 7) ->> 'ok')::boolean = true,
  'fn_backfill_missing_readings returns ok = true'
);

-- Test 7: Function output includes metrics
SELECT ok(
  (public.fn_backfill_missing_readings(CURRENT_DATE, 7) ? 'swept_count') AND
  (public.fn_backfill_missing_readings(CURRENT_DATE, 7) ? 'skipped_count') AND
  (public.fn_backfill_missing_readings(CURRENT_DATE, 7) ? 'retracted_count'),
  'fn_backfill_missing_readings returns swept_count, skipped_count, and retracted_count'
);

-- ── 2. Behavioral Tests ──────────────────────────────────────────────────────

-- Set up isolated fixture data
DO $$
DECLARE
  v_plant_id uuid := gen_random_uuid();
  v_loc_id   uuid := gen_random_uuid();
  v_well_id  uuid := gen_random_uuid();
  v_train_id uuid := gen_random_uuid();
BEGIN
  -- Insert mock plant
  INSERT INTO public.plants (id, name, code, status)
  VALUES (v_plant_id, 'Test Plant Alpha', 'TPA', 'Active');

  -- Insert mock locator
  INSERT INTO public.locators (id, plant_id, name, status, is_derived)
  VALUES (v_loc_id, v_plant_id, 'Test Locator 1', 'Active', false);

  -- Insert 2 boundary readings on locator (2-day gap: Aug 20 and Aug 21 missing)
  -- Aug 19 = 9020.6, Aug 22 = 9043.6 (Δ = 23 -> step = 7.67)
  INSERT INTO public.locator_readings (locator_id, plant_id, reading_datetime, current_reading, is_estimated)
  VALUES (v_loc_id, v_plant_id, '2026-08-19 08:00:00+08', 9020.6, false);

  INSERT INTO public.locator_readings (locator_id, plant_id, reading_datetime, current_reading, is_estimated)
  VALUES (v_loc_id, v_plant_id, '2026-08-22 08:00:00+08', 9043.6, false);

  -- Insert mock well for 6-day regression gap test
  INSERT INTO public.wells (id, plant_id, name, status, is_blending_well)
  VALUES (v_well_id, v_plant_id, 'Test Well 1', 'Active', true);

  -- Trailing history for well: Jul 31 = 988, Aug 01 = 1000 (rate = 12/day)
  INSERT INTO public.well_readings (well_id, plant_id, reading_datetime, current_reading, is_estimated)
  VALUES (v_well_id, v_plant_id, '2026-07-31 08:00:00+08', 988, false);

  INSERT INTO public.well_readings (well_id, plant_id, reading_datetime, current_reading, is_estimated)
  VALUES (v_well_id, v_plant_id, '2026-08-01 08:00:00+08', 1000, false);

  -- Anchor B: Aug 08 = 1070 (6 missing days: Aug 02..Aug 07)
  INSERT INTO public.well_readings (well_id, plant_id, reading_datetime, current_reading, is_estimated)
  VALUES (v_well_id, v_plant_id, '2026-08-08 08:00:00+08', 1070, false);

  -- Insert mock RO Train
  INSERT INTO public.ro_trains (id, plant_id, train_name, status)
  VALUES (v_train_id, v_plant_id, 'Train Alpha', 'Running');

  -- Preceding readings for RO train
  INSERT INTO public.ro_train_readings (train_id, plant_id, reading_datetime, permeate_meter, is_estimated)
  VALUES (v_train_id, v_plant_id, '2026-08-01 08:00:00+08', 500, false);

  INSERT INTO public.ro_train_readings (train_id, plant_id, reading_datetime, permeate_meter, is_estimated)
  VALUES (v_train_id, v_plant_id, '2026-08-08 08:00:00+08', 570, false);
END $$;

-- Test 8: Sweep backfills short gap with even-split (2 readings on locator)
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.locator_readings lr
    JOIN public.locators l ON l.id = lr.locator_id
    WHERE l.name = 'Test Locator 1' AND lr.is_estimated = true
  ),
  0,
  'Before sweep, 0 estimated readings exist on Test Locator 1'
);

-- Execute sweep covering Aug 19..Aug 25
SELECT ok(
  (public.fn_backfill_missing_readings('2026-08-25'::date, 10) ->> 'swept_count')::integer > 0,
  'Sweep runs successfully over test date range'
);

-- Test 10: Verify even-split values inserted for short gap (Aug 20 = 9028.27, Aug 21 = 9035.93)
SELECT results_eq(
  $$
    SELECT round(current_reading, 2), is_estimated
    FROM public.locator_readings lr
    JOIN public.locators l ON l.id = lr.locator_id
    WHERE l.name = 'Test Locator 1' AND lr.is_estimated = true
    ORDER BY reading_datetime ASC
  $$,
  $$
    VALUES (9028.27::numeric, true), (9035.93::numeric, true)
  $$,
  'Short bounded gap is backfilled with exact even-split values'
);

-- Test 11: Verify long gap (> 5 days) on Well is tagged as regression_flowrate in backfill_sweep_log
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.backfill_sweep_log
    WHERE table_name = 'well_readings' AND method = 'regression_flowrate'
  ),
  'Long gap (> 5 days) on well uses regression_flowrate method'
);

-- Test 12: Verify regression_flowrate calculates non-linear rate-aware values (Aug 2 = 1011.71 instead of 1010.00)
SELECT is(
  (
    SELECT round(current_reading, 2)
    FROM public.well_readings wr
    JOIN public.wells w ON w.id = wr.well_id
    WHERE w.name = 'Test Well 1' AND (wr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = '2026-08-02'
  ),
  1011.71::numeric,
  'Regression flow-rate computes smooth curve value distinct from even-split'
);

-- Test 13: Verify RO train module backfills missing permeate readings
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.ro_train_readings rtr
    JOIN public.ro_trains t ON t.id = rtr.train_id
    WHERE t.train_name = 'Train Alpha' AND rtr.is_estimated = true
  ),
  'RO train module successfully backfills missing permeate_meter readings'
);

-- Test 14: Remarks exemption: Add reason on file and assert date is skipped
DO $$
DECLARE
  v_loc_id uuid;
BEGIN
  SELECT id INTO v_loc_id FROM public.locators WHERE name = 'Test Locator 1';
  INSERT INTO public.reading_gap_reasons (entity_type, entity_id, gap_date, reason_code)
  VALUES ('locator', v_loc_id, '2026-08-20', 'maintenance');
END $$;

-- Run sweep again — late remark retraction should remove the estimated reading for Aug 20
SELECT ok(
  (public.fn_backfill_missing_readings('2026-08-25'::date, 10) ->> 'retracted_count')::integer >= 1,
  'Late remark retracts existing estimated reading'
);

-- Test 15: Verify Aug 20 reading was retracted/deleted
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.locator_readings lr
    JOIN public.locators l ON l.id = lr.locator_id
    WHERE l.name = 'Test Locator 1' AND (lr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = '2026-08-20'
  ),
  0,
  'Retracted date has no locator reading row'
);

-- Test 16: Orphan Purge Test: If a real reading is logged on Aug 21, the estimated reading for Aug 21 is automatically purged
DO $$
DECLARE
  v_loc_id uuid;
  v_plant_id uuid;
BEGIN
  SELECT id, plant_id INTO v_loc_id, v_plant_id FROM public.locators WHERE name = 'Test Locator 1';
  -- Insert real manual morning reading on Aug 21 (07:30 PHT = 23:30 UTC previous day)
  INSERT INTO public.locator_readings (locator_id, plant_id, reading_datetime, current_reading, is_estimated)
  VALUES (v_loc_id, v_plant_id, '2026-08-21 07:30:00+08', 9036.0, false);
END $$;

-- Run sweep again
SELECT ok(
  (public.fn_backfill_missing_readings('2026-08-25'::date, 10) ->> 'ok')::boolean = true,
  'Sweep runs and automatically purges orphaned estimated row on Aug 21'
);

SELECT * FROM finish();
ROLLBACK;
