-- =============================================================================
-- Migration: 20260817010000_rls_gap_closure_pump_cip_incidents_blending_audit.sql
--
-- Closes the remaining RLS gaps flagged in the 2026-08-17 code review /
-- status report, plus one newly-discovered gap found while verifying them
-- live (see part 2 below). Applied live via Supabase MCP on 2026-08-17;
-- this file backfills it into migrations so main and the live schema don't
-- drift apart (the recurring "committed but never run live" pattern, in
-- reverse).
--
-- PART 1 -- SELECT bypass for Manager/Data Analyst/Admin outside their own
-- plant assignment, same pattern already applied to well_readings,
-- locator_readings, and power_readings (is_manager_or_analyst_or_admin()).
-- Without this, a Manager/Data Analyst/Admin picking a plant outside their
-- own assignment silently gets 0 rows back on these three tables, same bug
-- class as the earlier "data analysis missing for some roles" fix.
-- INSERT/UPDATE/DELETE are untouched -- the existing plant-scoped FOR ALL
-- policies still gate writes for everyone, including Admin (which is fine,
-- since user_has_plant_access() already grants admins full access via
-- is_admin()).
-- =============================================================================

CREATE POLICY "pump_readings_analyst_select_bypass" ON public.pump_readings
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

CREATE POLICY "cip_logs_analyst_select_bypass" ON public.cip_logs
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

CREATE POLICY "incidents_analyst_select_bypass" ON public.incidents
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

-- =============================================================================
-- PART 2 -- blending_events: drop two over-permissive PERMISSIVE policies.
--
-- auth_delete_blending_events (DELETE, USING auth.uid() IS NOT NULL) was
-- already flagged as stray in the 2026-08-17 review. While verifying it
-- live, found the exact same pattern also exists for UPDATE:
-- auth_update_blending_events (UPDATE, USING/WITH CHECK auth.uid() IS NOT
-- NULL) -- not previously flagged. Because Postgres RLS policies for the
-- same command are OR'd together (both are PERMISSIVE), either of these
-- alone grants ANY authenticated user the ability to update or delete ANY
-- blending event in ANY plant, regardless of plant assignment -- making the
-- correctly plant-scoped blending_events_update / blending_events_delete
-- policies sitting right next to them functionally moot. A malicious or
-- merely curious authenticated user could reach this directly via the
-- Supabase REST API even though ReadingHistoryDialog's client-side
-- canEditEntry()/hasFullAccess() checks make the UI itself behave
-- correctly -- RLS is the real boundary, and it wasn't holding.
--
-- Dropping both. blending_events_update / blending_events_delete (both
-- FOR ... TO authenticated USING user_has_plant_access(plant_id)) already
-- grant the intended access: any role with plant access can edit/delete
-- within their own plant, same model as every other operational table in
-- this app, with per-row ownership/time restrictions enforced client-side
-- via canEditEntry() (the established pattern here, not changed by this
-- migration). auth_read_blending_events (SELECT, also auth.uid() IS NOT
-- NULL, no plant check) is untouched -- that one was already reviewed and
-- deliberately left open in the "blending history missing for some roles"
-- fix, since ReadingHistoryDialog's own read-only visibility gate was the
-- actual bug there, not the RLS.
-- =============================================================================

DROP POLICY IF EXISTS "auth_delete_blending_events" ON public.blending_events;
DROP POLICY IF EXISTS "auth_update_blending_events" ON public.blending_events;

-- =============================================================================
-- PART 3 -- reading_edit_audit_log SELECT: include Data Analyst.
--
-- Was is_manager_or_admin(auth.uid()) (Admin/Manager only), excluding Data
-- Analyst despite Data Analyst having full access to the Data Corrections
-- page this audit trail belongs to. Swapped to the analyst-inclusive
-- helper, same one used everywhere else in this migration.
-- =============================================================================

DROP POLICY IF EXISTS "reading edit log readable by admin/manager" ON public.reading_edit_audit_log;

CREATE POLICY "reading edit log readable by admin/manager/analyst" ON public.reading_edit_audit_log
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';
