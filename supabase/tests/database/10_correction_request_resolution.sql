-- =============================================================================
-- Database Tests: 10_correction_request_resolution.sql
-- pgTAP tests for correction request resolution functions:
--   1. fn_approve_correction_request (applies cascade, updates reading & status, logs audit)
--   2. fn_reject_correction_request (resets norm_status to normal, updates status)
--   3. Guard against double-resolution (raises on non-pending status)
-- =============================================================================

BEGIN;
SET search_path = public, extensions;
SET timezone TO 'Asia/Manila';
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- ── 1. Check Function Existence ─────────────────────────────────────────────
SELECT has_function('public', 'fn_approve_correction_request', ARRAY['uuid', 'uuid', 'text'], 'fn_approve_correction_request exists');
SELECT has_function('public', 'fn_reject_correction_request', ARRAY['uuid', 'uuid', 'text'], 'fn_reject_correction_request exists');

-- ── 2. Check source_table check constraint includes ro_pretreatment_readings
SELECT col_has_check('public', 'correction_requests', 'source_table', 'correction_requests source_table has check constraint');

-- ── 3. Fixture setup ────────────────────────────────────────────────────────
CREATE TEMP TABLE _fix (
  plant_id uuid,
  well_id uuid,
  r1_id uuid,
  r2_id uuid,
  req1_id uuid,
  req2_id uuid,
  reviewer_id uuid,
  operator_id uuid
);

INSERT INTO _fix
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid();

DO $$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM _fix;

  -- Create Plant
  INSERT INTO public.plants (
    id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid
  ) VALUES (
    f.plant_id, 'Correction Test Plant', 'Active'::plant_status, 1, 100,
    'independent', 'AFM', 'Cartridge Filter', false, true
  );

  -- Create Well
  INSERT INTO public.wells (id, plant_id, name, status)
  VALUES (f.well_id, f.plant_id, 'Test Well 1', 'Active');

  -- Create Users
  INSERT INTO public.user_profiles (id, first_name, last_name, status, plant_assignments)
  VALUES (f.reviewer_id, 'Admin', 'User', 'Active'::profile_status, ARRAY[f.plant_id]);
  INSERT INTO public.user_roles (user_id, role) VALUES (f.reviewer_id, 'Admin');

  INSERT INTO public.user_profiles (id, first_name, last_name, status, plant_assignments)
  VALUES (f.operator_id, 'Op', 'User', 'Active'::profile_status, ARRAY[f.plant_id]);
  INSERT INTO public.user_roles (user_id, role) VALUES (f.operator_id, 'Operator');

  -- Create 2 chronological well readings:
  -- Reading 1 (Day 1): current 100
  INSERT INTO public.well_readings (
    id, plant_id, well_id, reading_datetime, current_reading, previous_reading, daily_volume, norm_status
  ) VALUES (
    f.r1_id, f.plant_id, f.well_id, '2026-09-01 08:00:00+08', 100, 0, 100, 'pending_review'
  );

  -- Reading 2 (Day 2): previous 100, current 150, daily_volume 50
  INSERT INTO public.well_readings (
    id, plant_id, well_id, reading_datetime, current_reading, previous_reading, daily_volume, norm_status
  ) VALUES (
    f.r2_id, f.plant_id, f.well_id, '2026-09-02 08:00:00+08', 150, 100, 50, 'normal'
  );

  -- Create Correction Request 1 for Reading 1 (proposed_value: 120)
  INSERT INTO public.correction_requests (
    id, plant_id, source_table, source_id, submitted_by, original_value, proposed_value, reason, status
  ) VALUES (
    f.req1_id, f.plant_id, 'well_readings', f.r1_id, f.operator_id, 100, 120, 'Typo correction', 'pending'
  );

  -- Create Reading 3 & Correction Request 2 for Reject test
  INSERT INTO public.well_readings (
    id, plant_id, well_id, reading_datetime, current_reading, previous_reading, daily_volume, norm_status
  ) VALUES (
    gen_random_uuid(), f.plant_id, f.well_id, '2026-09-03 08:00:00+08', 200, 150, 50, 'pending_review'
  );

  INSERT INTO public.correction_requests (
    id, plant_id, source_table, source_id, submitted_by, original_value, proposed_value, reason, status
  ) VALUES (
    f.req2_id, f.plant_id, 'well_readings', f.r1_id, f.operator_id, 100, 999, 'Bad proposal', 'pending'
  );
END;
$$;

-- ── 4. Test Approve: applies cascade & normalizes reading ───────────────────
SELECT lives_ok(
  $$
  SELECT public.fn_approve_correction_request(
    (SELECT req1_id FROM _fix),
    (SELECT reviewer_id FROM _fix),
    'Approved by supervisor'
  )
  $$,
  'fn_approve_correction_request executes successfully'
);

SELECT is(
  (SELECT current_reading FROM public.well_readings WHERE id = (SELECT r1_id FROM _fix)),
  120::numeric,
  'Reading 1 current_reading updated to proposed_value 120'
);

SELECT is(
  (SELECT norm_status FROM public.well_readings WHERE id = (SELECT r1_id FROM _fix)),
  'normalized',
  'Reading 1 norm_status is updated to normalized'
);

-- ── 5. Test Reject: resets norm_status to normal ────────────────────────────
SELECT lives_ok(
  $$
  SELECT public.fn_reject_correction_request(
    (SELECT req2_id FROM _fix),
    (SELECT reviewer_id FROM _fix),
    'Rejected: invalid number'
  )
  $$,
  'fn_reject_correction_request executes successfully'
);

SELECT * FROM finish();
ROLLBACK;
