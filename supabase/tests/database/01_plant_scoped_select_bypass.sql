-- Regression test for the 2026-08-17 RLS fix: pump_readings, cip_logs, and
-- incidents each got a SELECT-bypass policy for Manager/Data Analyst/Admin,
-- matching the pattern already proven on well_readings/locator_readings/
-- power_readings. Before the fix, a Manager/Data Analyst/Admin looking at a
-- plant outside their own plant_assignments got silently empty results on
-- these three tables (same bug class as the earlier "data analysis missing
-- for some roles" incident) -- their FOR ALL user_has_plant_access() policy
-- had no bypass for elevated roles' SELECTs.
--
-- Entirely self-contained: creates its own plants/users/rows and rolls
-- everything back at the end, so this runs the same way against a fresh
-- `supabase test db` as it does against a linked project with real data.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET search_path = public, extensions;

SELECT plan(7);

-- ── Fixture setup (runs as the migration role, which bypasses RLS) ──────────
CREATE TEMP TABLE _fixture (
  plant_a uuid, plant_b uuid, train_b uuid,
  operator_a uuid, manager_partial uuid,
  incident_b uuid, pump_reading_b uuid, cip_log_b uuid
);

INSERT INTO _fixture
-- Generate fresh UUIDs for each test run to avoid collision across test files
SELECT 
  public.gen_random_uuid() AS plant_a,
  public.gen_random_uuid() AS plant_b,
  public.gen_random_uuid() AS train_b,
  public.gen_random_uuid() AS operator_a,
  public.gen_random_uuid() AS manager_partial,
  public.gen_random_uuid() AS incident_b,
  public.gen_random_uuid() AS pump_reading_b,
  public.gen_random_uuid() AS cip_log_b;

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM _fixture;

  INSERT INTO public.plants (id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid)
  VALUES
    (f.plant_a, 'pgtap-plant-a', 'Active'::plant_status, 1, 100, 'independent', 'AFM', 'Cartridge Filter', false, true),
    (f.plant_b, 'pgtap-plant-b', 'Active'::plant_status, 1, 100, 'independent', 'AFM', 'Cartridge Filter', false, true);

  INSERT INTO public.ro_trains (id, plant_id, train_number, status, num_afm,
    num_booster_pumps, num_hp_pumps, num_cartridge_filters, num_filter_housings,
    num_controllers)
  VALUES (f.train_b, f.plant_b, 1, 'Running'::train_status, 0, 1, 1, 1, 1, 1);

  -- auth.users only strictly requires id -- see the 2026-08-18 review's
  -- app_metadata.role sync migration, which established this same pattern.
  INSERT INTO auth.users (id) VALUES (f.operator_a), (f.manager_partial);

  INSERT INTO public.user_profiles (id, plant_assignments, status, profile_complete, confirmed)
  VALUES
    (f.operator_a,      ARRAY[f.plant_a], 'Active'::profile_status, true, true),
    (f.manager_partial, ARRAY[f.plant_a], 'Active'::profile_status, true, true); -- deliberately NOT plant_b

  INSERT INTO public.user_roles (user_id, role) VALUES
    (f.operator_a, 'Operator'),
    (f.manager_partial, 'Manager');

  INSERT INTO public.incidents (id, plant_id, status, created_at, updated_at)
  VALUES (f.incident_b, f.plant_b, 'Open'::incident_status, now(), now());

  INSERT INTO public.pump_readings (id, train_id, plant_id, pump_type, pump_number, reading_datetime, created_at)
  VALUES (f.pump_reading_b, f.train_b, f.plant_b, 'HighPressure', 1, now(), now());

  INSERT INTO public.cip_logs (id, train_id, plant_id, created_at)
  VALUES (f.cip_log_b, f.train_b, f.plant_b, now());
END $$;

GRANT SELECT ON _fixture TO authenticated;

-- ── Baseline: Operator assigned only to plant_a sees 0 of plant_b's rows ────
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', operator_a, 'role', 'authenticated')::text FROM _fixture), true);

SELECT is(
  (SELECT count(*) FROM public.incidents WHERE id = (SELECT incident_b FROM _fixture)),
  0::bigint, 'incidents: plant_a-only Operator cannot see plant_b incident (baseline, unchanged by the fix)');
SELECT is(
  (SELECT count(*) FROM public.pump_readings WHERE id = (SELECT pump_reading_b FROM _fixture)),
  0::bigint, 'pump_readings: plant_a-only Operator cannot see plant_b reading (baseline, unchanged by the fix)');
SELECT is(
  (SELECT count(*) FROM public.cip_logs WHERE id = (SELECT cip_log_b FROM _fixture)),
  0::bigint, 'cip_logs: plant_a-only Operator cannot see plant_b log (baseline, unchanged by the fix)');

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

-- ── The actual fix: Manager assigned only to plant_a still sees plant_b's
--    rows via the SELECT-bypass, despite having no plant_b assignment ──────
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', manager_partial, 'role', 'authenticated')::text FROM _fixture), true);

SELECT is(
  (SELECT count(*) FROM public.incidents WHERE id = (SELECT incident_b FROM _fixture)),
  1::bigint, 'incidents: Manager sees plant_b incident via SELECT-bypass despite no plant_b assignment (the fix)');
SELECT is(
  (SELECT count(*) FROM public.pump_readings WHERE id = (SELECT pump_reading_b FROM _fixture)),
  1::bigint, 'pump_readings: Manager sees plant_b reading via SELECT-bypass despite no plant_b assignment (the fix)');
SELECT is(
  (SELECT count(*) FROM public.cip_logs WHERE id = (SELECT cip_log_b FROM _fixture)),
  1::bigint, 'cip_logs: Manager sees plant_b log via SELECT-bypass despite no plant_b assignment (the fix)');

-- ── The bypass is SELECT-only: the same Manager still cannot WRITE to
--    plant_b's rows -- confirms the fix didn't accidentally widen access
--    beyond what it was explicitly asked to (read visibility only). RLS
--    filters rows silently (0 rows affected), it doesn't raise an error, so
--    the check is a before/after comparison rather than throws_ok. ────────
UPDATE public.incidents SET status = 'Resolved' WHERE id = (SELECT incident_b FROM _fixture);

SELECT is(
  (SELECT status::text FROM public.incidents WHERE id = (SELECT incident_b FROM _fixture)),
  'Open',
  'incidents: Manager with no plant_b assignment cannot UPDATE a plant_b incident (bypass is SELECT-only) -- still Open, not Resolved'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;
