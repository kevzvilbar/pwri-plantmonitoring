-- =============================================================================
-- Database Tests: 09_train_status_triggers.sql
-- pgTAP tests for train_status_log triggers and offline notifications:
--   1. trg_train_status_log_no_identical_ts (rejection of duplicate timestamp transitions)
--   2. trg_train_status_log_notify_offline & trg_train_status_log_push_offline existence
--   3. get_offline_alert_recipients (proper scoping to active plant managers/analysts/admins)
-- =============================================================================

BEGIN;
SET search_path = public, extensions;
SET timezone TO 'Asia/Manila';
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- ── Fixture setup ────────────────────────────────────────────────────────────
CREATE TEMP TABLE _test_fix (
  plant_id uuid,
  train_id uuid,
  manager_id uuid,
  operator_id uuid
);

INSERT INTO _test_fix
SELECT 
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid();

DO $$
DECLARE
  f record;
BEGIN
  SELECT * INTO f FROM _test_fix;

  -- 1. Create plant
  INSERT INTO public.plants (
    id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid
  ) VALUES (
    f.plant_id, 'Test Plant Alpha', 'Active'::plant_status, 1, 100,
    'independent', 'AFM', 'Cartridge Filter', false, true
  );

  -- 2. Create train
  INSERT INTO public.ro_trains (
    id, plant_id, train_number, status
  ) VALUES (
    f.train_id, f.plant_id, 1, 'Running'::train_status
  );

  -- 3. Create Manager User & Profile (assigned to plant)
  INSERT INTO auth.users (id, email) VALUES (f.manager_id, 'manager.alpha@example.com');
  INSERT INTO public.user_roles (user_id, role) VALUES (f.manager_id, 'Manager');
  INSERT INTO public.user_profiles (id, first_name, last_name, status, plant_assignments)
  VALUES (f.manager_id, 'Manny', 'Manager', 'Active'::profile_status, ARRAY[f.plant_id])
  ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    status = EXCLUDED.status,
    plant_assignments = EXCLUDED.plant_assignments;

  -- 4. Create Operator User & Profile (assigned to plant)
  INSERT INTO auth.users (id, email) VALUES (f.operator_id, 'operator.alpha@example.com');
  INSERT INTO public.user_roles (user_id, role) VALUES (f.operator_id, 'Operator');
  INSERT INTO public.user_profiles (id, first_name, last_name, status, plant_assignments)
  VALUES (f.operator_id, 'Otto', 'Operator', 'Active'::profile_status, ARRAY[f.plant_id])
  ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    status = EXCLUDED.status,
    plant_assignments = EXCLUDED.plant_assignments;
END $$;

-- ── 1. Trigger Existence Checks ──────────────────────────────────────────────

-- Test 1: Deduplication trigger exists on train_status_log
SELECT has_trigger(
  'public',
  'train_status_log',
  'trg_train_status_log_no_identical_ts',
  'Trigger trg_train_status_log_no_identical_ts exists on public.train_status_log'
);

-- Test 2: Email notify trigger exists on train_status_log
SELECT has_trigger(
  'public',
  'train_status_log',
  'trg_train_status_log_notify_offline',
  'Trigger trg_train_status_log_notify_offline exists on public.train_status_log'
);

-- Test 3: Push notify trigger exists on train_status_log
SELECT has_trigger(
  'public',
  'train_status_log',
  'trg_train_status_log_push_offline',
  'Trigger trg_train_status_log_push_offline exists on public.train_status_log'
);

-- ── 2. Deduplication Trigger Behavior ────────────────────────────────────────

-- Test 4: Inserting a valid train status record succeeds
SELECT lives_ok(
  format(
    'INSERT INTO public.train_status_log (train_id, plant_id, status, confirmed_at, reason) VALUES (%L, %L, %L, %L, %L)',
    (SELECT train_id FROM _test_fix),
    (SELECT plant_id FROM _test_fix),
    'Online',
    '2026-09-19 08:00:00+08'::timestamptz,
    'Initial morning online check'
  ),
  'Inserting a fresh train_status_log entry succeeds'
);

-- Test 5: Inserting a duplicate row with exact same train_id and confirmed_at raises exception
SELECT throws_ok(
  format(
    'INSERT INTO public.train_status_log (train_id, plant_id, status, confirmed_at, reason) VALUES (%L, %L, %L, %L, %L)',
    (SELECT train_id FROM _test_fix),
    (SELECT plant_id FROM _test_fix),
    'Offline',
    '2026-09-19 08:00:00+08'::timestamptz,
    'Concurrent conflicting status update'
  ),
  'P0001',
  NULL,
  'Duplicate (train_id, confirmed_at) INSERT is rejected by trg_train_status_log_no_identical_ts'
);

-- Test 6: Non-key column update on existing row succeeds
SELECT lives_ok(
  format(
    'UPDATE public.train_status_log SET reason = %L WHERE train_id = %L AND confirmed_at = %L',
    'Updated reason without timestamp shift',
    (SELECT train_id FROM _test_fix),
    '2026-09-19 08:00:00+08'::timestamptz
  ),
  'Updating non-key fields of existing train_status_log row succeeds'
);

-- Test 7: Second row with distinct timestamp succeeds
SELECT lives_ok(
  format(
    'INSERT INTO public.train_status_log (train_id, plant_id, status, confirmed_at, reason) VALUES (%L, %L, %L, %L, %L)',
    (SELECT train_id FROM _test_fix),
    (SELECT plant_id FROM _test_fix),
    'Offline',
    '2026-09-19 09:30:00+08'::timestamptz,
    'Genuine status transition 90m later'
  ),
  'Inserting train_status_log entry at different confirmed_at succeeds'
);

-- ── 3. Alert Recipient Scoping ───────────────────────────────────────────────

-- Test 8: get_offline_alert_recipients returns active plant manager, excludes operator
SELECT results_eq(
  format(
    'SELECT email, display_name FROM public.get_offline_alert_recipients(%L)',
    (SELECT plant_id FROM _test_fix)
  ),
  $$VALUES ('manager.alpha@example.com'::text, 'Manny Manager'::text)$$,
  'get_offline_alert_recipients correctly resolves assigned active manager, excluding operator'
);

SELECT * FROM finish();
ROLLBACK;
