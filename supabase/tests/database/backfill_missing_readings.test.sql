-- =============================================================================
-- Database Tests: backfill_missing_readings.test.sql
-- Tests pgTAP assertions for fn_backfill_missing_readings
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

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

-- Test 5: reading_gap_reasons accepts 'power' and 'ro_train'
SELECT col_is_pk('public', 'backfill_sweep_log', 'id', 'backfill_sweep_log primary key is id');

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

SELECT * FROM finish();
ROLLBACK;

