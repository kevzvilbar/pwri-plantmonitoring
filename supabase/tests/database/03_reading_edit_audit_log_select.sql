-- Regression test for the 2026-08-17 fix: reading_edit_audit_log's SELECT
-- policy was is_manager_or_admin() (Admin/Manager only), excluding Data
-- Analyst despite Data Analyst having full access to the Data Corrections
-- page this audit trail belongs to. Swapped to is_manager_or_analyst_or_admin().
--
-- Self-contained: creates its own users/log row, cleans up via ROLLBACK.
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(2);

CREATE TEMP TABLE _fixture (analyst uuid, plain_operator uuid, log_row uuid);
INSERT INTO _fixture SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM _fixture;

  INSERT INTO auth.users (id) VALUES (f.analyst), (f.plain_operator);
  UPDATE public.user_profiles
  SET plant_assignments = ARRAY[]::uuid[], status = 'Active'::profile_status, profile_complete = true, confirmed = true
  WHERE id IN (f.analyst, f.plain_operator);
  DELETE FROM public.user_roles WHERE user_id IN (f.analyst, f.plain_operator);
  INSERT INTO public.user_roles (user_id, role) VALUES
    (f.analyst, 'Data Analyst'),
    (f.plain_operator, 'Operator');

  INSERT INTO public.reading_edit_audit_log (id, table_name, record_id, action, edited_at, actor_user_id)
  VALUES (f.log_row, 'well_readings', gen_random_uuid(), 'update', now(), f.plain_operator);
END $$;

GRANT SELECT ON _fixture TO authenticated;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', analyst, 'role', 'authenticated')::text FROM _fixture), true);

SELECT is(
  (SELECT count(*) FROM public.reading_edit_audit_log WHERE id = (SELECT log_row FROM _fixture)),
  1::bigint,
  'reading_edit_audit_log: Data Analyst can SELECT the audit log (the fix)'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', plain_operator, 'role', 'authenticated')::text FROM _fixture), true);

SELECT is(
  (SELECT count(*) FROM public.reading_edit_audit_log WHERE id = (SELECT log_row FROM _fixture)),
  0::bigint,
  'reading_edit_audit_log: plain Operator (not Admin/Manager/Data Analyst) still cannot SELECT it'
);

RESET role;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;
