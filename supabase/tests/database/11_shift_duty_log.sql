-- =============================================================================
-- Database Tests: 11_shift_duty_log.sql
-- pgTAP tests for shift_duty_log table and pair-duty attribution
-- =============================================================================

BEGIN;
SET search_path = public, extensions;
SET timezone TO 'Asia/Manila';
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

-- ── 1. Check Table and Column Existence ─────────────────────────────────────
SELECT has_table('public', 'shift_duty_log', 'shift_duty_log table exists');
SELECT has_column('public', 'shift_duty_log', 'is_dual_duty', 'shift_duty_log has is_dual_duty column');
SELECT has_column('public', 'shift_duty_log', 'partner_operator_id', 'shift_duty_log has partner_operator_id column');
SELECT has_column('public', 'shift_duty_log', 'cycle_key', 'shift_duty_log has cycle_key column');

-- ── 2. Test Insert and Query ────────────────────────────────────────────────
CREATE TEMP TABLE _fix_duty (
  plant_id uuid,
  op1_id uuid,
  op2_id uuid
);

INSERT INTO _fix_duty
SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

DO $$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM _fix_duty;

  INSERT INTO public.plants (
    id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid
  ) VALUES (
    f.plant_id, 'Pair Duty Test Plant', 'Active'::plant_status, 1, 100,
    'independent', 'AFM', 'Cartridge Filter', false, true
  );

  -- shift_duty_log.operator_id / partner_operator_id reference auth.users
  -- (not user_profiles) directly -- see 20260926000003_shift_duty_log.sql.
  INSERT INTO auth.users (id) VALUES (f.op1_id), (f.op2_id);

  INSERT INTO public.shift_duty_log (
    plant_id, operator_id, partner_operator_id, is_dual_duty, cycle_key
  ) VALUES (
    f.plant_id, f.op1_id, f.op2_id, true, '2026-09-26-S1'
  );
END;
$$;

SELECT is(
  (SELECT count(*)::int FROM public.shift_duty_log WHERE cycle_key = '2026-09-26-S1'),
  1,
  'shift_duty_log records pair-duty shift correctly'
);

SELECT * FROM finish();
ROLLBACK;
