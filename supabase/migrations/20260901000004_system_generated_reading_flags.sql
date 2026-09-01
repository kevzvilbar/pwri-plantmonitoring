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
    ALTER TABLE public.power_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 4. ro_train_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ro_train_readings') THEN
    ALTER TABLE public.ro_train_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 5. product_meter_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_meter_readings') THEN
    ALTER TABLE public.product_meter_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- 6. locator_readings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'locator_readings') THEN
    ALTER TABLE public.locator_readings ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

