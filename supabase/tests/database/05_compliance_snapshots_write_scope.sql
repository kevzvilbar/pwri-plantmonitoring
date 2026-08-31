-- Regression test for the 2026-09-01 compliance_snapshots fix:
-- The initial policy "analyst_write_snapshots" permitted ANY authenticated user
-- (including operators) to INSERT rows into compliance_snapshots.
-- The fix restricts INSERT to users with role 'Admin' or 'Data Analyst'.
--
-- Self-contained: creates its own users/plant, cleans up via ROLLBACK.
BEGIN;
SELECT plan(2);

CREATE TEMP TABLE _fixture (
  plant_id uuid,
  analyst uuid,
  plain_operator uuid
);
INSERT INTO _fixture SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM _fixture;

  INSERT INTO public.plants (id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid)
  VALUES
    (f.plant_id, 'pgtap-compliance-plant', 'Active'::plant_status, 1, 100, 'independent', 'AFM', 'Cartridge Filter', false, true);

  INSERT INTO auth.users (id) VALUES (f.analyst), (f.plain_operator);
  INSERT INTO public.user_profiles (id, plant_assignments, status, profile_complete, confirmed)
  VALUES (f.analyst,        ARRAY[f.plant_id], 'Active'::profile_status, true, true),
         (f.plain_operator, ARRAY[f.plant_id], 'Active'::profile_status, true, true);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (f.analyst, 'Data Analyst'),
    (f.plain_operator, 'Operator');
END $$;

GRANT SELECT ON _fixture TO authenticated;

-- Test 1: Plain Operator cannot INSERT into compliance_snapshots (throws RLS 42501).
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', plain_operator, 'role', 'authenticated')::text FROM _fixture), true);

SELECT throws_ok(
  format('INSERT INTO public.compliance_snapshots (plant_id, summary) VALUES (%L, %L)', (SELECT plant_id FROM _fixture), 'Operator test snapshot'),
  '42501',
  NULL,
  'compliance_snapshots: plain Operator cannot INSERT into compliance_snapshots'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

-- Test 2: Data Analyst CAN INSERT into compliance_snapshots.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', analyst, 'role', 'authenticated')::text FROM _fixture), true);

INSERT INTO public.compliance_snapshots (plant_id, summary)
VALUES ((SELECT plant_id FROM _fixture), 'Analyst test snapshot');

SELECT is(
  (SELECT count(*) FROM public.compliance_snapshots WHERE plant_id = (SELECT plant_id FROM _fixture)),
  1::bigint,
  'compliance_snapshots: Data Analyst can successfully INSERT compliance snapshots'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;

