-- Regression test for the 2026-08-18 fix: auth.users.raw_app_meta_data->>
-- 'role' is kept in sync with public.user_roles by a trigger, closing the
-- gap where 0 of 36 users had the claim set even after data-analysis/
-- index.ts was fixed to read it (it would have 403'd every real user).
-- Covers INSERT, a priority-order upgrade, and both DELETE cases (reverts
-- to the remaining role vs. removes the claim entirely when no roles are
-- left) -- see sync_user_role_to_app_metadata() in
-- 20260818020000_sync_user_roles_to_app_metadata.sql for the full priority
-- order (Admin > Data Analyst > Manager > Technician > Operator).
--
-- No RLS/impersonation needed here -- this exercises the trigger directly,
-- as the migration role. Self-contained, cleans up via ROLLBACK.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET search_path = public, extensions;

SELECT plan(4);

CREATE TEMP TABLE _fixture (u uuid);
INSERT INTO _fixture SELECT gen_random_uuid();
INSERT INTO auth.users (id) SELECT u FROM _fixture;

INSERT INTO public.user_roles (user_id, role) SELECT u, 'Operator' FROM _fixture;
SELECT is(
  (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = (SELECT u FROM _fixture)),
  'Operator',
  'INSERT sets app_metadata.role to match the new user_roles row'
);

INSERT INTO public.user_roles (user_id, role) SELECT u, 'Admin' FROM _fixture;
SELECT is(
  (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = (SELECT u FROM _fixture)),
  'Admin',
  'a second, higher-priority role upgrades the claim (Admin > Operator)'
);

DELETE FROM public.user_roles WHERE user_id = (SELECT u FROM _fixture) AND role = 'Admin';
SELECT is(
  (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = (SELECT u FROM _fixture)),
  'Operator',
  'deleting the higher-priority role reverts the claim to the remaining one'
);

DELETE FROM public.user_roles WHERE user_id = (SELECT u FROM _fixture) AND role = 'Operator';
SELECT ok(
  NOT ((SELECT raw_app_meta_data FROM auth.users WHERE id = (SELECT u FROM _fixture)) ? 'role'),
  'deleting the last remaining role removes the claim entirely, not a stale value'
);

SELECT * FROM finish();
ROLLBACK;
