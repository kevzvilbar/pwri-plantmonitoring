-- =============================================================================
-- Migration: 20261015000002_scope_manager_cross_plant_access.sql
-- Description:
--   Follow-up to 20261015000001. Managers are plant-scoped: they may only see
--   and change data for plants in their plant_assignments. Admin keeps global
--   access (user_has_plant_access() already returns true for Admin) and Data
--   Analyst keeps its cross-plant READ access on telemetry/log tables.
--
--   Removes the remaining "any Manager, any plant" policies:
--     * SELECT bypass: pump_readings, cip_logs, incidents, power_readings,
--       reading_edit_audit_log, import_analysis, plant_edit_audit_log,
--       operator_switch_log, alert_events
--     * Entity tables where `is_manager_or_admin OR assigned` let a Manager
--       through on every plant: wells, ro_trains, locators and their meter
--       replacement / PMS records
--     * Manager-wide writes: plants (update/delete), power_meter_changes,
--       meter_events, power_tariffs, checklist_templates
--   Not changed on purpose: global catalogs without a plant (chemical catalog,
--   chemical_prices, filter_unit_prices, compliance thresholds), staff directory
--   (user_profiles / user_roles), deletion_audit_log (no plant column).
-- =============================================================================

-- ── 1. Cross-plant SELECT bypass: Admin / Data Analyst only ─────────────────
-- Managers keep reading their own plants via the existing *_plant_access policies.

DROP POLICY IF EXISTS "pump_readings_analyst_select_bypass" ON public.pump_readings;
CREATE POLICY "pump_readings_analyst_select_bypass" ON public.pump_readings
FOR SELECT USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role));

DROP POLICY IF EXISTS "cip_logs_analyst_select_bypass" ON public.cip_logs;
CREATE POLICY "cip_logs_analyst_select_bypass" ON public.cip_logs
FOR SELECT USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role));

DROP POLICY IF EXISTS "incidents_analyst_select_bypass" ON public.incidents;
CREATE POLICY "incidents_analyst_select_bypass" ON public.incidents
FOR SELECT USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role));

DROP POLICY IF EXISTS "power_readings_analyst_read" ON public.power_readings;
CREATE POLICY "power_readings_analyst_read" ON public.power_readings
FOR SELECT USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role));

DROP POLICY IF EXISTS "reading edit log readable by admin/manager/analyst" ON public.reading_edit_audit_log;
CREATE POLICY "reading edit log readable by admin/manager/analyst" ON public.reading_edit_audit_log
FOR SELECT USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "import_analysis readable by admin/manager" ON public.import_analysis;
CREATE POLICY "import_analysis readable by admin/manager" ON public.import_analysis
FOR SELECT USING (
  public.is_admin(auth.uid())
  OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "import_analysis insertable by admin/manager" ON public.import_analysis;
CREATE POLICY "import_analysis insertable by admin/manager" ON public.import_analysis
FOR INSERT WITH CHECK (
  public.is_admin(auth.uid())
  OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "plant_edit_audit_manager_read" ON public.plant_edit_audit_log;
CREATE POLICY "plant_edit_audit_manager_read" ON public.plant_edit_audit_log
FOR SELECT USING (
  public.is_admin(auth.uid())
  OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "plant_edit_audit_manager_insert" ON public.plant_edit_audit_log;
CREATE POLICY "plant_edit_audit_manager_insert" ON public.plant_edit_audit_log
FOR INSERT WITH CHECK (
  public.is_admin(auth.uid())
  OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "admin_read_switch_log" ON public.operator_switch_log;
CREATE POLICY "admin_read_switch_log" ON public.operator_switch_log
FOR SELECT USING (
  public.is_admin(auth.uid())
  OR (public.has_role(auth.uid(), 'Manager'::public.app_role) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "alert_events_select_plant" ON public.alert_events;
CREATE POLICY "alert_events_select_plant" ON public.alert_events
FOR SELECT TO authenticated USING (
  plant_id IS NULL
  OR public.user_has_plant_access(plant_id)
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
);

DROP POLICY IF EXISTS "alert_events_insert_own" ON public.alert_events;
CREATE POLICY "alert_events_insert_own" ON public.alert_events
FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid()
  AND (
    plant_id IS NULL
    OR public.user_has_plant_access(plant_id)
    OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  )
);

-- ── 2. Entity tables: replace "Manager OR assigned" with plant access ───────

-- wells
DROP POLICY IF EXISTS "wells_select" ON public.wells;
CREATE POLICY "wells_select" ON public.wells FOR SELECT TO authenticated
USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "wells_insert" ON public.wells;
CREATE POLICY "wells_insert" ON public.wells FOR INSERT TO authenticated
WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "wells_update" ON public.wells;
CREATE POLICY "wells_update" ON public.wells FOR UPDATE TO authenticated
USING (public.user_has_plant_access(plant_id))
WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "wells_delete" ON public.wells;
CREATE POLICY "wells_delete" ON public.wells FOR DELETE TO authenticated
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- ro_trains
DROP POLICY IF EXISTS "ro_trains_select" ON public.ro_trains;
CREATE POLICY "ro_trains_select" ON public.ro_trains FOR SELECT TO authenticated
USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "ro_trains_insert" ON public.ro_trains;
CREATE POLICY "ro_trains_insert" ON public.ro_trains FOR INSERT TO authenticated
WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "ro_trains_update" ON public.ro_trains;
CREATE POLICY "ro_trains_update" ON public.ro_trains FOR UPDATE TO authenticated
USING (public.user_has_plant_access(plant_id))
WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "ro_trains_delete" ON public.ro_trains;
CREATE POLICY "ro_trains_delete" ON public.ro_trains FOR DELETE TO authenticated
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- locators (select is already plant-scoped elsewhere; fix write paths)
DROP POLICY IF EXISTS "locators_insert" ON public.locators;
CREATE POLICY "locators_insert" ON public.locators FOR INSERT TO authenticated
WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "locators_update" ON public.locators;
CREATE POLICY "locators_update" ON public.locators FOR UPDATE TO authenticated
USING (public.user_has_plant_access(plant_id))
WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "locators_delete" ON public.locators;
CREATE POLICY "locators_delete" ON public.locators FOR DELETE TO authenticated
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- meter replacements
DROP POLICY IF EXISTS "locator_replacements_select" ON public.locator_meter_replacements;
CREATE POLICY "locator_replacements_select" ON public.locator_meter_replacements FOR SELECT TO authenticated
USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "locator_replacements_insert" ON public.locator_meter_replacements;
CREATE POLICY "locator_replacements_insert" ON public.locator_meter_replacements FOR INSERT TO authenticated
WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "well_replacements_select" ON public.well_meter_replacements;
CREATE POLICY "well_replacements_select" ON public.well_meter_replacements FOR SELECT TO authenticated
USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "well_replacements_insert" ON public.well_meter_replacements;
CREATE POLICY "well_replacements_insert" ON public.well_meter_replacements FOR INSERT TO authenticated
WITH CHECK (public.user_has_plant_access(plant_id));

-- well PMS records
DROP POLICY IF EXISTS "well_pms_select" ON public.well_pms_records;
CREATE POLICY "well_pms_select" ON public.well_pms_records FOR SELECT TO authenticated
USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "well_pms_insert" ON public.well_pms_records;
CREATE POLICY "well_pms_insert" ON public.well_pms_records FOR INSERT TO authenticated
WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 3. Manager-wide writes become plant-scoped ──────────────────────────────

-- plants: any signed-in user can still read (plants_select_authenticated);
-- creating a plant is Admin-only, a Manager may only edit/delete their own.
DROP POLICY IF EXISTS "plants_write_admin_manager" ON public.plants;
DROP POLICY IF EXISTS "plants_insert_admin" ON public.plants;
DROP POLICY IF EXISTS "plants_update_scoped" ON public.plants;
DROP POLICY IF EXISTS "plants_delete_scoped" ON public.plants;

CREATE POLICY "plants_insert_admin" ON public.plants FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "plants_update_scoped" ON public.plants FOR UPDATE TO authenticated
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(id))
WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(id));

CREATE POLICY "plants_delete_scoped" ON public.plants FOR DELETE TO authenticated
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(id));

DROP POLICY IF EXISTS "power_meter_changes_manager_all" ON public.power_meter_changes;
CREATE POLICY "power_meter_changes_manager_all" ON public.power_meter_changes
FOR ALL
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "meter_events_insert_manager_admin_analyst" ON public.meter_events;
CREATE POLICY "meter_events_insert_manager_admin_analyst" ON public.meter_events
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
    OR (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  )
);

-- Rows without a plant (global defaults) are Admin-only.
DROP POLICY IF EXISTS "power_tariffs_write" ON public.power_tariffs;
CREATE POLICY "power_tariffs_write" ON public.power_tariffs
FOR ALL TO authenticated
USING (public.is_admin(auth.uid())
       OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id)))
WITH CHECK (public.is_admin(auth.uid())
       OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id)));

DROP POLICY IF EXISTS "checklist_templates_write" ON public.checklist_templates;
CREATE POLICY "checklist_templates_write" ON public.checklist_templates
FOR ALL TO authenticated
USING (public.is_admin(auth.uid())
       OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id)))
WITH CHECK (public.is_admin(auth.uid())
       OR (public.is_manager_or_admin(auth.uid()) AND plant_id IS NOT NULL AND public.user_has_plant_access(plant_id)));

