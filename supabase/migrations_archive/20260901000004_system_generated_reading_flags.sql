-- =============================================================================
-- Migration: 20260901000004_system_generated_reading_flags.sql
--
-- Purpose:
--   Ensures `is_estimated` column is present across all reading / telemetry
--   tables: well_readings, blending_events, power_readings, ro_train_readings,
--   product_meter_readings, and locator_readings.
--
--   This flag identifies system-generated / backfilled / auto-estimated readings,
--   distinguishing them visually from operator entries and ensuring they are
--   excluded from operator accomplishment counts.
-- =============================================================================

DO $$
BEGIN
  -- 1. well_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'well_readings') THEN
    ALTER TABLE public.well_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 2. blending_events
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blending_events') THEN
    ALTER TABLE public.blending_events ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 3. power_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'power_readings') THEN
    ALTER TABLE public.power_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.power_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 4. ro_train_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ro_train_readings') THEN
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS permeate_meter_delta NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS permeate_meter_prev NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS feed_meter_delta NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS feed_meter_prev NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS reject_meter_delta NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS reject_meter_prev NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS permeate_production_date DATE;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS power_meter_reading_kwh NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS power_delta_kwh NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS power_avg_kw NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS specific_energy_kwh_m3 NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS shared_power_meter_group TEXT;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS chlorine_residual_mg_l NUMERIC;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS incomplete_reason TEXT;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS remarks TEXT;
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN DEFAULT false;
  END IF;

  -- 5. product_meter_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_meter_readings') THEN
    ALTER TABLE public.product_meter_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 6. locator_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'locator_readings') THEN
    ALTER TABLE public.locator_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.locator_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Refresh ro_train_readings_latest view if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'ro_train_readings_latest') THEN
    CREATE OR REPLACE VIEW public.ro_train_readings_latest
    WITH (security_invoker = true) AS
    SELECT DISTINCT ON (train_id) *
    FROM public.ro_train_readings
    ORDER BY train_id, reading_datetime DESC;
  END IF;
END $$;

