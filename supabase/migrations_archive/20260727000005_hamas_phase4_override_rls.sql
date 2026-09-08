-- =============================================================================
-- Migration: 20260727_hamas_phase4_override_rls.sql
-- Phase 4 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   locator_readings' existing "locator_readings_plant_access" policy is
--   FOR ALL TO authenticated USING (user_has_plant_access(plant_id)) — i.e.
--   role-agnostic. Today, any authenticated user with plant access can
--   already INSERT/UPDATE/DELETE any locator_readings row, including for
--   is_derived locators; only the frontend hiding the input has been
--   preventing it. This migration adds real DB-level enforcement.
--
--   Postgres RLS policies are additive (OR'd) within the same command, so a
--   normal PERMISSIVE policy can't narrow what locator_readings_plant_access
--   already allows. RESTRICTIVE policies are the correct tool: they AND on
--   top of whatever permissive policies already allow, without touching or
--   risking the existing broad policy that lets operators submit their own
--   (non-derived) readings.
--
--   Three separate policies are required — CREATE POLICY takes exactly one
--   command per statement (no "FOR INSERT, UPDATE" shorthand).
-- =============================================================================

DROP POLICY IF EXISTS "derived_locator_readings_insert_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_insert_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "derived_locator_readings_update_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_update_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  )
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "derived_locator_readings_delete_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_delete_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

-- Note: these three RESTRICTIVE policies apply only to normal authenticated
-- client sessions. fn_sweep_derived_meters() (Phase 2) is SECURITY DEFINER
-- and bypasses RLS entirely, as does the reading-integrity trigger — neither
-- is affected by this change.
