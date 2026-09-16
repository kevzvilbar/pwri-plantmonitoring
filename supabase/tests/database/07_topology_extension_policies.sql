-- ============================================================================
-- Test: 07_topology_extension_policies.sql
--
-- The topology extension tables from 20260916000001 (plant_process_stages,
-- product_tanks, dosing_points) must carry a policy for EVERY command, not
-- just the ones the first screen happens to exercise.
--
-- This is a regression test with a history: plant_topology_links shipped with
-- SELECT/INSERT/DELETE policies and no UPDATE policy, so every upsert against
-- an already-saved topology failed with "new row violates row-level security
-- policy" until 20260915000001 added it. 06_rls_enabled_on_all_tables.sql
-- catches a table with RLS off; nothing caught a table with RLS on and a hole
-- in its command coverage. This does.
--
-- Checks the live catalog (pg_policies), not migration text, so it holds no
-- matter which migration introduced or dropped a policy.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;

SELECT plan(20);

-- ── RLS is enabled ──────────────────────────────────────────────────────────
SELECT ok(
    COALESCE(
      (SELECT relrowsecurity FROM pg_class
        WHERE oid = to_regclass('public.' || t)),
      false
    ),
    format('RLS is enabled on public.%s', t)
)
FROM unnest(ARRAY['plant_process_stages', 'product_tanks', 'dosing_points', 'plant_topology_config']) AS t;

-- ── One policy per command on each table ────────────────────────────────────
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = t
           AND cmd = c
    ),
    format('public.%s has a %s policy', t, c)
)
FROM unnest(ARRAY['plant_process_stages', 'product_tanks', 'dosing_points', 'plant_topology_config']) AS t
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS c;

SELECT * FROM finish();
ROLLBACK;
