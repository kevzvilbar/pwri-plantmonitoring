-- Regression test for the 2026-08-17/18 blending_events fix: dropped two
-- over-permissive PERMISSIVE policies (auth_update_blending_events,
-- auth_delete_blending_events) that granted ANY authenticated user UPDATE/
-- DELETE on ANY blending event regardless of plant assignment, because
-- Postgres OR's PERMISSIVE policies together for the same command -- their
-- USING (auth.uid() IS NOT NULL) alone made the correctly plant-scoped
-- blending_events_update / blending_events_delete policies sitting right
-- next to them functionally moot. Before the fix, any signed-in user could
-- edit or delete any plant's blending event directly via the Supabase REST
-- API, even though ReadingHistoryDialog's own client-side checks made the
-- UI itself behave correctly.
--
-- Self-contained: creates its own plants/well/user/event and cleans up via
-- ROLLBACK.
BEGIN;
SELECT plan(3);

CREATE TEMP TABLE _fixture (
  plant_a uuid, plant_b uuid, well_b uuid,
  outsider uuid, event_b uuid
);
INSERT INTO _fixture
SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid();

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM _fixture;

  INSERT INTO public.plants (id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid)
  VALUES
    (f.plant_a, 'pgtap-blend-a', 'Active'::plant_status, 1, 100, 'independent', 'AFM', 'Cartridge Filter', false, true),
    (f.plant_b, 'pgtap-blend-b', 'Active'::plant_status, 1, 100, 'independent', 'AFM', 'Cartridge Filter', false, true);

  INSERT INTO public.wells (id, plant_id, name, status, has_power_meter, is_blending_well)
  VALUES (f.well_b, f.plant_b, 'pgtap-blend-well', 'Active'::plant_status, false, true);

  -- "outsider" is assigned to plant_a only -- has no relationship to
  -- plant_b's blending event at all, the exact scenario the stray policy
  -- let through before.
  INSERT INTO auth.users (id) VALUES (f.outsider);
  INSERT INTO public.user_profiles (id, plant_assignments, status, profile_complete, confirmed)
  VALUES (f.outsider, ARRAY[f.plant_a], 'Active'::profile_status, true, true);
  INSERT INTO public.user_roles (user_id, role) VALUES (f.outsider, 'Operator');

  INSERT INTO public.blending_events (id, plant_id, well_id, event_date, raw_meter_reading, noted_at)
  VALUES (f.event_b, f.plant_b, f.well_b, current_date, 12.5, now());
END $$;

GRANT SELECT ON _fixture TO authenticated;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', outsider, 'role', 'authenticated')::text FROM _fixture), true);

-- Attempt the INSERT the stray policy used to allow -- should now throw an RLS error (42501).
SELECT throws_ok(
  format('INSERT INTO public.blending_events (plant_id, well_id, event_date, raw_meter_reading) VALUES (%L, %L, current_date, 50)', (SELECT plant_b FROM _fixture), (SELECT well_b FROM _fixture)),
  '42501',
  NULL,
  'blending_events: outsider (no plant_b assignment) cannot INSERT into plant_b'
);

-- Attempt the UPDATE the stray policy used to allow -- should now be a no-op.
UPDATE public.blending_events SET raw_meter_reading = 999 WHERE id = (SELECT event_b FROM _fixture);
SELECT is(
  (SELECT raw_meter_reading FROM public.blending_events WHERE id = (SELECT event_b FROM _fixture)),
  12.5::numeric,
  'blending_events: outsider (no plant_b assignment) cannot UPDATE a plant_b event -- reading unchanged'
);

-- Attempt the DELETE the stray policy used to allow -- should also no-op.
DELETE FROM public.blending_events WHERE id = (SELECT event_b FROM _fixture);
SELECT is(
  (SELECT count(*) FROM public.blending_events WHERE id = (SELECT event_b FROM _fixture)),
  1::bigint,
  'blending_events: outsider (no plant_b assignment) cannot DELETE a plant_b event -- row still exists'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;
