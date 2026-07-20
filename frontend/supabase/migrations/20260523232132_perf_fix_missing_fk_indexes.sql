-- Migration: 20260523232132_perf_fix_missing_fk_indexes.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ============================================================
-- PERFORMANCE FIX 3: Add indexes for unindexed foreign keys.
-- Prioritised on tables with real data (readings, logs, etc.)
-- ============================================================

-- well_readings (3,179 rows)
CREATE INDEX IF NOT EXISTS idx_well_readings_well_id      ON public.well_readings (well_id);
CREATE INDEX IF NOT EXISTS idx_well_readings_recorded_by  ON public.well_readings (recorded_by);

-- locator_readings (4,830 rows)
CREATE INDEX IF NOT EXISTS idx_locator_readings_recorded_by ON public.locator_readings (recorded_by);

-- ro_train_readings (3,779 rows)
CREATE INDEX IF NOT EXISTS idx_ro_train_readings_recorded_by ON public.ro_train_readings (recorded_by);

-- ro_pretreatment_readings (2,962 rows)
CREATE INDEX IF NOT EXISTS idx_ro_pretreatment_readings_plant_id  ON public.ro_pretreatment_readings (plant_id);
CREATE INDEX IF NOT EXISTS idx_ro_pretreatment_readings_train_id  ON public.ro_pretreatment_readings (train_id);

-- product_meter_readings (761 rows)
CREATE INDEX IF NOT EXISTS idx_product_meter_readings_recorded_by ON public.product_meter_readings (recorded_by);

-- chemical_dosing_logs (347 rows)
CREATE INDEX IF NOT EXISTS idx_chemical_dosing_logs_recorded_by ON public.chemical_dosing_logs (recorded_by);

-- chemical_residual_samples (185 rows)
CREATE INDEX IF NOT EXISTS idx_chemical_residual_samples_plant_id ON public.chemical_residual_samples (plant_id);

-- train_status_log (143 rows)
CREATE INDEX IF NOT EXISTS idx_train_status_log_plant_id ON public.train_status_log (plant_id);

-- power_readings (331 rows)
CREATE INDEX IF NOT EXISTS idx_power_readings_recorded_by ON public.power_readings (recorded_by);

-- locators (39 rows)
CREATE INDEX IF NOT EXISTS idx_locators_product_meter_id ON public.locators (product_meter_id);

-- user_profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_immediate_head_id ON public.user_profiles (immediate_head_id);

-- wells
CREATE INDEX IF NOT EXISTS idx_wells_plant_id ON public.wells (plant_id);

-- locator_meter_replacements
CREATE INDEX IF NOT EXISTS idx_locator_meter_replacements_plant_id    ON public.locator_meter_replacements (plant_id);
CREATE INDEX IF NOT EXISTS idx_locator_meter_replacements_locator_id  ON public.locator_meter_replacements (locator_id);

-- well_meter_replacements
CREATE INDEX IF NOT EXISTS idx_well_meter_replacements_well_id    ON public.well_meter_replacements (well_id);
CREATE INDEX IF NOT EXISTS idx_well_meter_replacements_plant_id   ON public.well_meter_replacements (plant_id);

-- incidents
CREATE INDEX IF NOT EXISTS idx_incidents_plant_id      ON public.incidents (plant_id);
CREATE INDEX IF NOT EXISTS idx_incidents_who_reporter  ON public.incidents (who_reporter);
CREATE INDEX IF NOT EXISTS idx_incidents_resolved_by   ON public.incidents (resolved_by);
CREATE INDEX IF NOT EXISTS idx_incidents_closed_by     ON public.incidents (closed_by);

-- audit and misc tables
CREATE INDEX IF NOT EXISTS idx_entity_status_audit_log_plant_id ON public.entity_status_audit_log (plant_id);
CREATE INDEX IF NOT EXISTS idx_entity_status_audit_log_user_id  ON public.entity_status_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_actor_user_id ON public.deletion_audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_import_analysis_plant_id         ON public.import_analysis (plant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_plant_id           ON public.notifications (plant_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_id           ON public.login_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_well_blending_plant_id           ON public.well_blending (plant_id);
CREATE INDEX IF NOT EXISTS idx_regression_results_created_by    ON public.regression_results (created_by);
CREATE INDEX IF NOT EXISTS idx_product_meter_audit_log_user_id  ON public.product_meter_audit_log (user_id);
;
