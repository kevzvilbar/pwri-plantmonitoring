-- Migration: Add multiplier audit columns to meter replacement tables
-- Scope: locator_meter_replacements, well_meter_replacements, product_meter_replacements
-- Supports recording multiplier state snapshot (old and new) during meter replacements

ALTER TABLE public.locator_meter_replacements
  ADD COLUMN IF NOT EXISTS old_multiplier numeric,
  ADD COLUMN IF NOT EXISTS old_multiplier_enabled boolean,
  ADD COLUMN IF NOT EXISTS new_multiplier numeric,
  ADD COLUMN IF NOT EXISTS new_multiplier_enabled boolean;

ALTER TABLE public.well_meter_replacements
  ADD COLUMN IF NOT EXISTS old_multiplier numeric,
  ADD COLUMN IF NOT EXISTS old_multiplier_enabled boolean,
  ADD COLUMN IF NOT EXISTS new_multiplier numeric,
  ADD COLUMN IF NOT EXISTS new_multiplier_enabled boolean;

ALTER TABLE public.product_meter_replacements
  ADD COLUMN IF NOT EXISTS old_multiplier numeric,
  ADD COLUMN IF NOT EXISTS old_multiplier_enabled boolean,
  ADD COLUMN IF NOT EXISTS new_multiplier numeric,
  ADD COLUMN IF NOT EXISTS new_multiplier_enabled boolean;
