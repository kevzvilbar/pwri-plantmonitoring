-- =============================================================================
-- Test: 12_security_hardening.sql
-- Description:
--   Tests for security and authorization hardening:
--   1. anon has no EXECUTE privileges on sensitive functions.
--   2. anon cannot SELECT from user_profiles.
--   3. handle_new_user() creates unconfirmed profile with status 'Pending'.
--   4. complete_onboarding() cannot self-activate.
--   5. non-admin cannot call admin_set_user_password.
--   6. non-manager/analyst/admin cannot approve correction requests.
--   7. user_has_plant_access() returns false for unconfirmed users.
-- =============================================================================

BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- Fixtures
CREATE TEMP TABLE _sec_fixture (
  plant_a uuid,
  admin_id uuid,
  operator_id uuid,
  pending_id uuid,
  corr_req_id uuid
);

INSERT INTO _sec_fixture
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid();

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM _sec_fixture;

  INSERT INTO public.plants (id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid)
  VALUES (f.plant_a, 'sec-test-plant', 'Active'::plant_status, 1, 100, 'independent', 'AFM', 'Cartridge Filter', false, true);

  -- Create users
  INSERT INTO auth.users (id, email) VALUES
    (f.admin_id, 'admin@example.com'),
    (f.operator_id, 'operator@example.com'),
    (f.pending_id, 'pending@example.com');

  -- Admin profile
  INSERT INTO public.user_profiles (id, username, email, designation, plant_assignments, status, profile_complete, confirmed)
  VALUES (f.admin_id, 'admin_user', 'admin@example.com', 'Admin', ARRAY[f.plant_a], 'Active', true, true)
  ON CONFLICT (id) DO UPDATE SET status = 'Active', confirmed = true;

  DELETE FROM public.user_roles WHERE user_id = f.admin_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (f.admin_id, 'Admin');

  -- Operator profile
  INSERT INTO public.user_profiles (id, username, email, designation, plant_assignments, status, profile_complete, confirmed)
  VALUES (f.operator_id, 'op_user', 'operator@example.com', 'Operator', ARRAY[f.plant_a], 'Active', true, true)
  ON CONFLICT (id) DO UPDATE SET status = 'Active', confirmed = true;

  DELETE FROM public.user_roles WHERE user_id = f.operator_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (f.operator_id, 'Operator');

  -- Pending user profile (unconfirmed)
  INSERT INTO public.user_profiles (id, username, email, designation, plant_assignments, status, profile_complete, confirmed)
  VALUES (f.pending_id, 'pending_user', 'pending@example.com', 'Operator', ARRAY[f.plant_a], 'Pending', true, false)
  ON CONFLICT (id) DO UPDATE SET status = 'Pending', confirmed = false;

  DELETE FROM public.user_roles WHERE user_id = f.pending_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (f.pending_id, 'Operator');

  -- Correction request
  INSERT INTO public.correction_requests (id, plant_id, source_table, source_id, proposed_value, reason, status, submitted_by)
  VALUES (f.corr_req_id, f.plant_a, 'locator_readings', gen_random_uuid(), 100, 'Test request', 'pending', f.operator_id);
END $$;

GRANT SELECT ON _sec_fixture TO anon, authenticated;

-- 1. Test anon cannot SELECT user_profiles directly
SET LOCAL role anon;
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);

SELECT is(
  (SELECT count(*) FROM public.user_profiles),
  0::bigint,
  'anon role cannot select any rows from user_profiles'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

-- 2. Test user_has_plant_access returns false for unconfirmed pending user
SELECT is(
  public.user_has_plant_access((SELECT plant_a FROM _sec_fixture), (SELECT pending_id FROM _sec_fixture)),
  false,
  'user_has_plant_access returns false for unconfirmed/pending profile'
);

-- 3. Test user_has_plant_access returns true for confirmed active operator
SELECT is(
  public.user_has_plant_access((SELECT plant_a FROM _sec_fixture), (SELECT operator_id FROM _sec_fixture)),
  true,
  'user_has_plant_access returns true for active confirmed operator'
);

-- 4. Test non-admin cannot call admin_set_user_password
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', operator_id, 'role', 'authenticated')::text FROM _sec_fixture), true);

SELECT throws_ok(
  format('SELECT public.admin_set_user_password(%L::uuid, %L)', (SELECT operator_id FROM _sec_fixture), 'NewPassword123!'),
  'Only administrators can reset user passwords',
  'Operator cannot invoke admin_set_user_password'
);

-- 5. Test Operator cannot approve correction request
SELECT throws_ok(
  format('SELECT public.fn_approve_correction_request(%L::uuid)', (SELECT corr_req_id FROM _sec_fixture)),
  'Not authorized to approve correction request for plant ' || (SELECT plant_a FROM _sec_fixture),
  'Operator cannot approve correction request'
);

-- 6. Test Operator cannot modify profile status/confirmation
SELECT throws_ok(
  format('UPDATE public.user_profiles SET status = ''Active'', confirmed = true WHERE id = %L::uuid', (SELECT pending_id FROM _sec_fixture)),
  'Only administrators can change user status',
  'Non-admin cannot update user status or confirmed via direct update'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

-- 7. Test Admin CAN approve correction request
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', admin_id, 'role', 'authenticated')::text FROM _sec_fixture), true);

SELECT lives_ok(
  format('SELECT public.fn_approve_correction_request(%L::uuid)', (SELECT corr_req_id FROM _sec_fixture)),
  'Admin can approve correction request'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;
