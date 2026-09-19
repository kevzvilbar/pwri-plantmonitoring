-- =============================================================================
-- Regression test for 20260916000005_reading_storage_report.sql and
-- 20260916000006_drop_duplicate_reading_indexes.sql.
--
-- Two things are being protected here:
--
-- 1. The duplicate indexes stay dropped. The 2026-09-11 squash merged an older
--    index set with a later "phase4" one, leaving identical copies live on both
--    tables (baseline lines 7796/7824, 7712/7944, 7776/7940). If a future squash
--    or a hand-applied "missing indexes" migration reintroduces them, this fails
--    instead of silently doubling the write cost on the two busiest tables.
--
-- 2. fn_reading_storage_report() keeps its authorization. It is SECURITY
--    DEFINER (so it bypasses RLS to reach pg_class/pg_stat_*), which means the
--    in-function Manager/Admin guard is the only thing stopping a plain Operator
--    from reading database internals. anon must hold no EXECUTE grant at all.
--
-- Self-contained: creates its own fixtures, cleans up via ROLLBACK.
-- Run with `supabase test db` (CI: .github/workflows/ci.yml, job rls-tests).
-- =============================================================================

BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- ── 1. The duplicate indexes are gone, their twins survive ───────────────────
SELECT ok(
  to_regclass('public.idx_rtr_train_dt') IS NULL,
  'ro_train_readings: duplicate index idx_rtr_train_dt was dropped'
);

SELECT ok(
  to_regclass('public.idx_ro_train_readings_train_id_reading_datetime') IS NOT NULL,
  'ro_train_readings: surviving (train_id, reading_datetime DESC) index is still present'
);

SELECT ok(
  to_regclass('public.ro_pretreatment_readings_train_id_dt_idx') IS NULL,
  'ro_pretreatment_readings: duplicate index ro_pretreatment_readings_train_id_dt_idx was dropped'
);

SELECT ok(
  to_regclass('public.idx_pretreatment_train_dt') IS NOT NULL,
  'ro_pretreatment_readings: surviving (train_id, reading_datetime DESC) index is still present'
);

SELECT ok(
  to_regclass('public.ro_pretreatment_readings_plant_id_idx') IS NULL,
  'ro_pretreatment_readings: duplicate index ro_pretreatment_readings_plant_id_idx was dropped'
);

SELECT ok(
  to_regclass('public.idx_ro_pretreatment_readings_plant_id') IS NOT NULL,
  'ro_pretreatment_readings: surviving (plant_id) index is still present'
);

-- ── 2. No duplicate indexes remain on either table ───────────────────────────
-- Scoped to these two tables on purpose: the detector is schema-wide, and other
-- tables' duplicates are a separate decision (not force-dropped by this work).
SELECT is(
  (SELECT count(*) FROM public.fn_duplicate_index_report()
    WHERE table_name IN ('ro_train_readings', 'ro_pretreatment_readings')),
  0::bigint,
  'fn_duplicate_index_report: no duplicate indexes remain on the two reading tables'
);

-- ── 3. Both functions exist and are hardened ─────────────────────────────────
SELECT ok(
  (SELECT p.prosecdef
          AND coalesce(array_to_string(p.proconfig, ',') LIKE '%search_path%', false)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_duplicate_index_report'),
  'fn_duplicate_index_report is SECURITY DEFINER with search_path pinned'
);

SELECT ok(
  (SELECT p.prosecdef
          AND coalesce(array_to_string(p.proconfig, ',') LIKE '%search_path%', false)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_reading_storage_report'),
  'fn_reading_storage_report is SECURITY DEFINER with search_path pinned'
);

-- ── 4. Report shape (called here as the migration/superuser role) ─────────────
-- auth.uid() is NULL in this context, which is the documented service_role /
-- scheduled-job path through the authorization guard.
SELECT is(
  jsonb_array_length(public.fn_reading_storage_report(false) -> 'tables'),
  2,
  'fn_reading_storage_report: reports both high-volume reading tables'
);

SELECT is(
  (SELECT jsonb_agg(t -> 'table' ORDER BY ord)
     FROM jsonb_array_elements(public.fn_reading_storage_report(false) -> 'tables')
          WITH ORDINALITY AS e(t, ord)),
  '["ro_train_readings", "ro_pretreatment_readings"]'::jsonb,
  'fn_reading_storage_report: reports ro_train_readings and ro_pretreatment_readings in order'
);

SELECT is(
  (public.fn_reading_storage_report(false) -> 'ok')::boolean,
  true,
  'fn_reading_storage_report: returns ok=true for the scheduled/service path'
);

-- ── 5. Authorization: anon locked out, Operator denied, Manager allowed ──────
SELECT ok(
  NOT has_function_privilege('anon', 'public.fn_reading_storage_report(boolean)', 'EXECUTE'),
  'fn_reading_storage_report: anon holds no EXECUTE grant'
);

CREATE TEMP TABLE _fixture (
  plant_id uuid,
  manager  uuid,
  operator uuid
);
INSERT INTO _fixture SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM _fixture;

  INSERT INTO public.plants (id, name, status, num_ro_trains, geofence_radius_m,
    backwash_mode, filter_media_type, filter_housing_type, has_solar, has_grid)
  VALUES
    (f.plant_id, 'pgtap-storage-report-plant', 'Active'::plant_status, 1, 100, 'independent', 'AFM', 'Cartridge Filter', false, true);

  INSERT INTO auth.users (id) VALUES (f.manager), (f.operator);
  UPDATE public.user_profiles
  SET plant_assignments = ARRAY[f.plant_id], status = 'Active'::profile_status, profile_complete = true, confirmed = true
  WHERE id IN (f.manager, f.operator);
  DELETE FROM public.user_roles WHERE user_id IN (f.manager, f.operator);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (f.manager,  'Manager'),
    (f.operator, 'Operator');
END $$;

GRANT SELECT ON _fixture TO authenticated;

-- Plain Operator is rejected (42501 from the in-function guard).
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', operator, 'role', 'authenticated')::text FROM _fixture), true);

SELECT throws_ok(
  'SELECT public.fn_reading_storage_report(false)',
  '42501',
  NULL,
  'fn_reading_storage_report: plain Operator cannot read the storage report'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

-- Manager is allowed.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', manager, 'role', 'authenticated')::text FROM _fixture), true);

SELECT is(
  (public.fn_reading_storage_report(false) -> 'ok')::boolean,
  true,
  'fn_reading_storage_report: Manager can read the storage report'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;