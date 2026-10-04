-- =============================================================================
-- Database Tests: 14_get_all_user_roles_scope.sql
-- An Operator sees the roles of same-plant colleagues (so KPI can list them),
-- never roles of other plants; a Manager sees all; anon sees nothing.
-- =============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

CREATE TEMP TABLE _f (plant_a uuid, plant_b uuid, me uuid, peer uuid, other_plant uuid, inactive_peer uuid, mgr uuid);
INSERT INTO _f SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                      gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM _f;
  INSERT INTO public.plants (id, name) VALUES (f.plant_a, 'Test Plant A'), (f.plant_b, 'Test Plant B');
  INSERT INTO auth.users (id) VALUES (f.me), (f.peer), (f.other_plant), (f.inactive_peer), (f.mgr);

  UPDATE public.user_profiles SET status = 'Active'::profile_status, confirmed = true, profile_complete = true,
         designation = 'Operator',
         plant_assignments = CASE id
           WHEN f.me THEN ARRAY[f.plant_a] WHEN f.peer THEN ARRAY[f.plant_a]
           WHEN f.other_plant THEN ARRAY[f.plant_b] WHEN f.inactive_peer THEN ARRAY[f.plant_a]
           ELSE ARRAY[]::uuid[] END
  WHERE id IN (f.me, f.peer, f.other_plant, f.inactive_peer, f.mgr);
  UPDATE public.user_profiles SET status = 'Pending'::profile_status WHERE id = f.inactive_peer;

  DELETE FROM public.user_roles WHERE user_id IN (f.me, f.peer, f.other_plant, f.inactive_peer, f.mgr);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (f.me, 'Operator'), (f.peer, 'Operator'), (f.other_plant, 'Operator'),
    (f.inactive_peer, 'Operator'), (f.mgr, 'Manager');
END $$;
GRANT SELECT ON _f TO authenticated, anon;

-- anon: nothing (function not executable, or returns no rows)
SET LOCAL role anon;
SELECT throws_ok($$SELECT * FROM public.get_all_user_roles()$$, '42501', NULL, 'anon cannot call get_all_user_roles');
RESET role;

-- Operator
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', me, 'role', 'authenticated')::text FROM _f), true);

SELECT ok((SELECT count(*) FROM public.get_all_user_roles() r, _f WHERE r.user_id = _f.me) = 1, 'operator sees own role');
SELECT ok((SELECT count(*) FROM public.get_all_user_roles() r, _f WHERE r.user_id = _f.peer) = 1, 'operator sees same-plant operator role');
SELECT ok((SELECT count(*) FROM public.get_all_user_roles() r, _f WHERE r.user_id = _f.other_plant) = 0, 'operator does NOT see other-plant role');
SELECT ok((SELECT count(*) FROM public.get_all_user_roles() r, _f WHERE r.user_id = _f.inactive_peer) = 0, 'operator does NOT see non-Active colleague role');
SELECT ok((SELECT count(*) FROM public.get_all_user_roles() r, _f WHERE r.user_id = _f.mgr) = 0, 'operator does NOT see an unrelated manager role');
RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

-- Manager sees everyone
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', mgr, 'role', 'authenticated')::text FROM _f), true);
SELECT ok((SELECT count(*) FROM public.get_all_user_roles() r, _f
           WHERE r.user_id IN (_f.me, _f.peer, _f.other_plant, _f.inactive_peer, _f.mgr)) = 5, 'manager sees all roles');
RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;
