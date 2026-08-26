-- =============================================================================
-- Migration: 20260721_missing_rls_policies.sql
--
-- Adds missing RLS policies to tables that have ALTER TABLE … ENABLE ROW
-- LEVEL SECURITY but zero CREATE POLICY statements, and adds RLS entirely to
-- status_checks (which had neither).
--
-- With RLS enabled but no policies, Supabase defaults to DENY ALL for
-- authenticated users. This migration fixes the silent read/write failures
-- these tables currently cause in the app.
-- =============================================================================

-- ── Tables that all follow the user_has_plant_access(plant_id) pattern ────────

-- afm_readings
DROP POLICY IF EXISTS "afm_readings_plant_access" ON afm_readings;
CREATE POLICY "afm_readings_plant_access" ON afm_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- cartridge_readings
DROP POLICY IF EXISTS "cartridge_readings_plant_access" ON cartridge_readings;
CREATE POLICY "cartridge_readings_plant_access" ON cartridge_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- checklist_executions (plant_id nullable; fall back to plant_id IS NULL for global templates)
DROP POLICY IF EXISTS "checklist_executions_plant_access" ON checklist_executions;
CREATE POLICY "checklist_executions_plant_access" ON checklist_executions
  FOR ALL TO authenticated
  USING  (plant_id IS NULL OR public.user_has_plant_access(plant_id))
  WITH CHECK (plant_id IS NULL OR public.user_has_plant_access(plant_id));

-- chemical_dosing_logs
DROP POLICY IF EXISTS "chemical_dosing_logs_plant_access" ON chemical_dosing_logs;
CREATE POLICY "chemical_dosing_logs_plant_access" ON chemical_dosing_logs
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- chemical_inventory
DROP POLICY IF EXISTS "chemical_inventory_plant_access" ON chemical_inventory;
CREATE POLICY "chemical_inventory_plant_access" ON chemical_inventory
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- cip_logs
DROP POLICY IF EXISTS "cip_logs_plant_access" ON cip_logs;
CREATE POLICY "cip_logs_plant_access" ON cip_logs
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- incidents
DROP POLICY IF EXISTS "incidents_plant_access" ON incidents;
CREATE POLICY "incidents_plant_access" ON incidents
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- locator_meter_replacements
DROP POLICY IF EXISTS "locator_meter_replacements_plant_access" ON locator_meter_replacements;
CREATE POLICY "locator_meter_replacements_plant_access" ON locator_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- power_readings
DROP POLICY IF EXISTS "power_readings_plant_access" ON power_readings;
CREATE POLICY "power_readings_plant_access" ON power_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- pump_readings
DROP POLICY IF EXISTS "pump_readings_plant_access" ON pump_readings;
CREATE POLICY "pump_readings_plant_access" ON pump_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ro_train_readings
DROP POLICY IF EXISTS "ro_train_readings_plant_access" ON ro_train_readings;
CREATE POLICY "ro_train_readings_plant_access" ON ro_train_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- well_meter_replacements
DROP POLICY IF EXISTS "well_meter_replacements_plant_access" ON well_meter_replacements;
CREATE POLICY "well_meter_replacements_plant_access" ON well_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- well_pms_records
DROP POLICY IF EXISTS "well_pms_records_plant_access" ON well_pms_records;
CREATE POLICY "well_pms_records_plant_access" ON well_pms_records
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── Audit-log tables: read = admin only, write = service role ─────────────────

-- reading_edit_audit_log
DROP POLICY IF EXISTS "reading_edit_audit_log_read" ON reading_edit_audit_log;
CREATE POLICY "reading_edit_audit_log_read" ON reading_edit_audit_log
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "reading_edit_audit_log_write" ON reading_edit_audit_log;
CREATE POLICY "reading_edit_audit_log_write" ON reading_edit_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- deletion_audit_log  (admin-read only; writes via service-role backend)
DROP POLICY IF EXISTS "deletion_audit_log_admin_read" ON deletion_audit_log;
CREATE POLICY "deletion_audit_log_admin_read" ON deletion_audit_log
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- import_analysis  (admin-read only)
DROP POLICY IF EXISTS "import_analysis_admin_read" ON import_analysis;
CREATE POLICY "import_analysis_admin_read" ON import_analysis
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

DROP POLICY IF EXISTS "import_analysis_write" ON import_analysis;
CREATE POLICY "import_analysis_write" ON import_analysis
  FOR ALL TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- login_attempts  (admin-read only; written by auth triggers / service role)
DROP POLICY IF EXISTS "login_attempts_admin_read" ON login_attempts;
CREATE POLICY "login_attempts_admin_read" ON login_attempts
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- ── status_checks: add RLS (currently has none at all) ────────────────────────
-- This is an internal heartbeat table — any authenticated user can insert a
-- row; reads are admin-only.
ALTER TABLE status_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_checks_write" ON status_checks;
CREATE POLICY "status_checks_write" ON status_checks
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "status_checks_admin_read" ON status_checks;
CREATE POLICY "status_checks_admin_read" ON status_checks
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));
