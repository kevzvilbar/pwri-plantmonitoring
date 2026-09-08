-- =============================================================================
-- Migration: 20260901000001_blending_compliance_insert_scope.sql
--
-- Closes the RLS INSERT gap on blending_events and compliance_snapshots:
--
-- 1. blending_events:
--    The initial policy "analyst_write_blending_events" created in
--    20260515000001_supabase_only_and_data_analysis.sql had:
--      FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
--    This permitted ANY signed-in user to insert a blending event for ANY plant,
--    even plants they are not assigned to.
--    We drop "analyst_write_blending_events" and replace it with
--    "blending_events_insert" checking public.user_has_plant_access(plant_id).
--
-- 2. compliance_snapshots:
--    The initial policy "analyst_write_snapshots" created in
--    20260515000001_supabase_only_and_data_analysis.sql had:
--      FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
--    This permitted ANY signed-in user (including operators) to write
--    compliance snapshots.
--    We drop "analyst_write_snapshots" and replace it with
--    "compliance_snapshots_insert" checking that the caller has 'Admin' or
--    'Data Analyst' role, matching "admin_write_thresholds" on the sibling
--    compliance_thresholds table.
-- =============================================================================

-- ── 1. blending_events: drop over-permissive INSERT policy and add plant-scoped policy ──
DROP POLICY IF EXISTS "analyst_write_blending_events" ON public.blending_events;
DROP POLICY IF EXISTS "blending_events_insert" ON public.blending_events;

CREATE POLICY "blending_events_insert" ON public.blending_events
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 2. compliance_snapshots: drop over-permissive INSERT policy and add role-scoped policy ──
DROP POLICY IF EXISTS "analyst_write_snapshots" ON public.compliance_snapshots;
DROP POLICY IF EXISTS "compliance_snapshots_insert" ON public.compliance_snapshots;

CREATE POLICY "compliance_snapshots_insert" ON public.compliance_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
  );

-- ── 3. Reload PostgREST schema cache ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

