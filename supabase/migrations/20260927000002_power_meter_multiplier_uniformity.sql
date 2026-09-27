-- Migration: Power meter multiplier uniformity & audit event typing
-- Scope: power_meter_changes, plant_power_config

-- 1. Add event_type and power_kind to power_meter_changes
ALTER TABLE public.power_meter_changes
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'multiplier_cutover',
  ADD COLUMN IF NOT EXISTS power_kind text NOT NULL DEFAULT 'grid',
  ADD COLUMN IF NOT EXISTS old_multiplier_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS new_multiplier_enabled boolean DEFAULT true;

-- Add check constraints if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'power_meter_changes_event_type_check'
  ) THEN
    ALTER TABLE public.power_meter_changes
      ADD CONSTRAINT power_meter_changes_event_type_check
      CHECK (event_type IN ('physical_replacement', 'multiplier_cutover'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'power_meter_changes_power_kind_check'
  ) THEN
    ALTER TABLE public.power_meter_changes
      ADD CONSTRAINT power_meter_changes_power_kind_check
      CHECK (power_kind IN ('grid', 'solar'));
  END IF;
END $$;

-- 2. Backfill existing power_meter_changes
UPDATE public.power_meter_changes
SET event_type = 'physical_replacement'
WHERE old_meter_final_reading IS NOT NULL AND new_meter_initial_reading IS NOT NULL;

-- 3. Add solar multiplier columns to plant_power_config
ALTER TABLE public.plant_power_config
  ADD COLUMN IF NOT EXISTS solar_meter_multipliers numeric[] DEFAULT '{}'::numeric[] NOT NULL,
  ADD COLUMN IF NOT EXISTS solar_meter_multipliers_enabled boolean[] DEFAULT '{}'::boolean[] NOT NULL,
  ADD COLUMN IF NOT EXISTS grid_meter_multipliers_enabled boolean[] DEFAULT '{}'::boolean[] NOT NULL;
