-- Performance indexes and cost trigger optimization identified during 2026-09-06 architecture review.
-- Addresses:
--   1. Composite index on well_readings(well_id, reading_datetime DESC) for reading chain synchronization
--   2. Unique constraint index on power_readings(plant_id, reading_datetime) to prevent duplicate submissions
--   3. Foreign key indexes on hardware lifecycle replacement tables
--   4. Column-restricted cost recalculation triggers to eliminate redundant recalculation chains

-- ── 1. Composite & Unique Query Indexes ─────────────────────────────────────

-- Eliminates sequential bitmap scans on well reading chain traversal
CREATE INDEX IF NOT EXISTS idx_well_readings_well_dt
  ON public.well_readings(well_id, reading_datetime DESC);

-- Prevents race-condition duplicate power readings per plant/timestamp
CREATE UNIQUE INDEX IF NOT EXISTS idx_power_readings_plant_dt
  ON public.power_readings(plant_id, reading_datetime);

-- Indexes for meter replacement history joins
CREATE INDEX IF NOT EXISTS idx_well_meter_replacements_well_id
  ON public.well_meter_replacements(well_id);

CREATE INDEX IF NOT EXISTS idx_locator_meter_replacements_plant_id
  ON public.locator_meter_replacements(plant_id);

CREATE INDEX IF NOT EXISTS idx_product_meter_replacements_meter_id
  ON public.product_meter_replacements(meter_id);

-- ── 2. Cost Trigger Recalculation Optimization ──────────────────────────────
-- Restrict UPDATE triggers to only fire when relevant numeric/date columns change,
-- preventing write amplification during audit logs, status updates, or remarks edits.

DROP TRIGGER IF EXISTS trg_well_cost ON public.well_readings;
CREATE TRIGGER trg_well_cost
  AFTER INSERT OR DELETE OR UPDATE OF daily_volume, reading_datetime, well_id
  ON public.well_readings
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();

DROP TRIGGER IF EXISTS trg_power_cost ON public.power_readings;
CREATE TRIGGER trg_power_cost
  AFTER INSERT OR DELETE OR UPDATE OF total_kwh, total_cost, reading_datetime, plant_id
  ON public.power_readings
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();

DROP TRIGGER IF EXISTS trg_chem_cost ON public.chemical_dosing_logs;
CREATE TRIGGER trg_chem_cost
  AFTER INSERT OR DELETE OR UPDATE OF amount_used_kg, cost_php, date, plant_id
  ON public.chemical_dosing_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_cost();
