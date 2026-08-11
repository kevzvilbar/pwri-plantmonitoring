-- =============================================================================
-- Migration: 20260811_ro_pretreat_delete_rls_fix.sql
--
-- Fixes: the Delete (and Edit) button in the RO Train / Pre-Treatment
-- operator log does nothing for some Manager / Data Analyst users.
--
-- Root cause: TrainLogModal.tsx sets
--     hasFullAccess = isManager || isDataAnalyst
-- and shows the delete/edit controls to those roles for ANY train, with no
-- plant scoping (see frontend/src/pages/ro-trains/helpers.tsx canEditEntry).
-- But the RLS policies on ro_train_readings and ro_pretreatment_readings
-- only ever called user_has_plant_access(plant_id), which for a non-Admin
-- requires the row's plant_id to be in that user's plant_assignments. A
-- Manager/Data Analyst whose plant_assignments don't cover a given train's
-- plant sees the delete button (frontend says "full access"), confirms the
-- dialog, and the DELETE is silently blocked by RLS -- 0 rows affected.
-- TrainLogModal.tsx's doDeleteReading() already detects and reports this via
-- its post-delete `.select('id')` 0-row check (added after the same failure
-- mode hit blending_events -- see 20260729_blending_events_meter_columns.sql).
--
-- Fix: give Manager / Data Analyst unscoped write access to just these two
-- tables, matching what the frontend already assumes. Scoped through a new
-- helper function rather than broadening user_has_plant_access() itself,
-- since that function also backs write policies on locator_readings,
-- well_readings, power_readings, pump_readings, cip_logs, incidents, and
-- others -- broadening it globally would silently hand Manager/Data Analyst
-- unscoped write access to all of those too, which is a bigger change than
-- "fix the RO delete button."
--
-- Supersedes the interactive supabase/migrations/confirm-and-fix-ro-delete.sql
-- draft (same fix, minus the manual per-user diagnostic step). That file can
-- be deleted once this one has been run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_has_ro_write_access(_plant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.user_has_plant_access(_plant_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('Manager', 'Data Analyst')
    );
$$;

DROP POLICY IF EXISTS "ro_train_readings_plant_access" ON public.ro_train_readings;
CREATE POLICY "ro_train_readings_plant_access" ON public.ro_train_readings
  FOR ALL TO authenticated
  USING (public.user_has_ro_write_access(plant_id))
  WITH CHECK (public.user_has_ro_write_access(plant_id));

DROP POLICY IF EXISTS "ro_pretreatment_access" ON public.ro_pretreatment_readings;
CREATE POLICY "ro_pretreatment_access" ON public.ro_pretreatment_readings
  FOR ALL TO authenticated
  USING (public.user_has_ro_write_access(plant_id))
  WITH CHECK (public.user_has_ro_write_access(plant_id));

NOTIFY pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────
-- Re-run this after applying and confirm both policies show USING/WITH CHECK
-- expressions referencing user_has_ro_write_access.
select tablename, policyname, cmd, roles
from pg_policies
where tablename in ('ro_train_readings', 'ro_pretreatment_readings')
order by tablename, policyname;
