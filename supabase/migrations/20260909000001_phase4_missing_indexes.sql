-- =============================================================================
-- Phase 4: Database Hardening - Missing Indexes
-- =============================================================================
-- Add missing indexes identified in the roadmap for query performance.
-- These should be applied after the baseline migration.

-- Well readings: primary query pattern is by well_id + reading_datetime
CREATE INDEX IF NOT EXISTS idx_well_readings_well_id_reading_datetime_desc 
  ON public.well_readings (well_id, reading_datetime DESC);

-- Locator readings: primary query pattern is by locator_id + reading_datetime  
CREATE INDEX IF NOT EXISTS idx_locator_readings_locator_id_reading_datetime_desc
  ON public.locator_readings (locator_id, reading_datetime DESC);

-- RO train readings: primary query pattern is by train_id + reading_datetime
CREATE INDEX IF NOT EXISTS idx_ro_train_readings_train_id_reading_datetime_desc
  ON public.ro_train_readings (train_id, reading_datetime DESC);

-- Product meter readings: primary query pattern is by meter_id + reading_datetime
CREATE INDEX IF NOT EXISTS idx_product_meter_readings_meter_id_reading_datetime_desc
  ON public.product_meter_readings (meter_id, reading_datetime DESC);

-- Power readings: primary query pattern is by plant_id + reading_datetime (for cost calcs)
CREATE INDEX IF NOT EXISTS idx_power_readings_plant_id_reading_datetime_desc
  ON public.power_readings (plant_id, reading_datetime DESC);

-- Well readings: also need plant_id + reading_datetime for fleet queries
CREATE INDEX IF NOT EXISTS idx_well_readings_plant_id_reading_datetime_desc
  ON public.well_readings (plant_id, reading_datetime DESC);

-- Locator readings: also need plant_id + reading_datetime for fleet queries
CREATE INDEX IF NOT EXISTS idx_locator_readings_plant_id_reading_datetime_desc
  ON public.locator_readings (plant_id, reading_datetime DESC);

-- RO train readings: also need plant_id + reading_datetime for fleet queries
CREATE INDEX IF NOT EXISTS idx_ro_train_readings_plant_id_reading_datetime_desc
  ON public.ro_train_readings (plant_id, reading_datetime DESC);

-- Product meter readings: also need plant_id + reading_datetime
CREATE INDEX IF NOT EXISTS idx_product_meter_readings_plant_id_reading_datetime_desc
  ON public.product_meter_readings (plant_id, reading_datetime DESC);

-- Additional: composite indexes for common filter combinations
-- Well readings: status + plant_id for active well lists
CREATE INDEX IF NOT EXISTS idx_wells_plant_status 
  ON public.wells (plant_id, status) WHERE status = 'Active';

-- Locator readings: status + plant_id for active locator lists
CREATE INDEX IF NOT EXISTS idx_locators_plant_status
  ON public.locators (plant_id, status) WHERE status = 'Active';

-- RO trains: status + plant_id for active train lists
CREATE INDEX IF NOT EXISTS idx_ro_trains_plant_status
  ON public.ro_trains (plant_id, status) WHERE status IN ('Running', 'Maintenance');

-- Product meters: status + plant_id for active meter lists
CREATE INDEX IF NOT EXISTS idx_product_meters_plant_status
  ON public.product_meters (plant_id, status) WHERE status = 'Active';

-- Audit logs: entity_type + entity_id for history queries
CREATE INDEX IF NOT EXISTS idx_reading_edit_audit_log_entity
  ON public.reading_edit_audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_entity
  ON public.deletion_audit_log (entity_type, entity_id);

-- Compliance: plant + date for snapshots
CREATE INDEX IF NOT EXISTS idx_compliance_snapshots_plant_date
  ON public.compliance_snapshots (plant_id, snapshot_date DESC);

-- Production costs: plant + date for cost analysis
CREATE INDEX IF NOT EXISTS idx_production_costs_plant_date
  ON public.production_costs (plant_id, cost_date DESC);

-- Electric bills: plant + month for billing queries
CREATE INDEX IF NOT EXISTS idx_electric_bills_plant_month
  ON public.electric_bills (plant_id, billing_month DESC);

-- =============================================================================
-- END OF MISSING INDEXES
-- =============================================================================