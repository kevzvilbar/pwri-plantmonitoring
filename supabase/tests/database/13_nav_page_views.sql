-- =============================================================================
-- Database Tests: 13_nav_page_views.sql
-- Navigation telemetry: anon blocked, signed-in users may insert valid rows
-- only, only Admin may read or delete.
-- =============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(9);

CREATE TEMP TABLE _nav_fix (admin_id uuid, operator_id uuid);
INSERT INTO _nav_fix SELECT gen_random_uuid(), gen_random_uuid();

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM _nav_fix;
  INSERT INTO auth.users (id) VALUES (f.admin_id), (f.operator_id);
  UPDATE public.user_profiles
  SET plant_assignments = ARRAY[]::uuid[], status = 'Active'::profile_status,
      profile_complete = true, confirmed = true
  WHERE id IN (f.admin_id, f.operator_id);
  DELETE FROM public.user_roles WHERE user_id IN (f.admin_id, f.operator_id);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (f.admin_id, 'Admin'), (f.operator_id, 'Operator');
END $$;

GRANT SELECT ON _nav_fix TO authenticated, anon;

-- 1. anon cannot insert
SET LOCAL role anon;
SELECT throws_ok(
  $$INSERT INTO public.nav_page_views (session_id, route, device) VALUES ('abcdefgh12', '/alerts', 'desktop')$$,
  '42501', NULL, 'anon cannot insert page views'
);
RESET role;

-- 2-4. operator: valid insert ok, bad rows rejected, cannot read
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', operator_id, 'role', 'authenticated')::text FROM _nav_fix), true);

SELECT lives_ok(
  $$INSERT INTO public.nav_page_views (session_id, route, tab, role, device)
    VALUES ('abcdefgh12', '/plants/:id/wells/:wellId', 'hydraulic', 'Operator', 'mobile')$$,
  'signed-in user can insert a valid page view'
);
SELECT throws_ok(
  $$INSERT INTO public.nav_page_views (session_id, route, device)
    VALUES ('abcdefgh12', '/plants/3f2b9c1e-0000-4000-8000-000000000000?x=1', 'desktop')$$,
  '23514', NULL, 'route with query string or odd characters is rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.nav_page_views (session_id, route, device)
    VALUES ('abcdefgh12', '/alerts', 'tablet')$$,
  '23514', NULL, 'unknown device is rejected'
);
SELECT is(
  (SELECT count(*) FROM public.nav_page_views), 0::bigint,
  'non-admin sees no page views'
);
RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

-- 5-6. admin: can read, can delete
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', admin_id, 'role', 'authenticated')::text FROM _nav_fix), true);

SELECT is(
  (SELECT count(*) FROM public.nav_page_views), 1::bigint,
  'admin can read page views'
);
DELETE FROM public.nav_page_views WHERE occurred_at < now() + interval '1 day';
SELECT is(
  (SELECT count(*) FROM public.nav_page_views), 0::bigint,
  'admin can delete page views (retention)'
);
RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

-- 7-8. no user identifying column; RLS on
SELECT hasnt_column('public', 'nav_page_views', 'user_id', 'no user_id column by design');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.nav_page_views'::regclass),
  true, 'RLS enabled'
);

SELECT * FROM finish();
ROLLBACK;
