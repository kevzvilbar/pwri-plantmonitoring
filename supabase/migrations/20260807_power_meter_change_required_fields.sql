-- =============================================================================
-- Migration: 20260807_power_meter_change_required_fields.sql
--
-- Brings power meter replacement in line with the well / locator / product /
-- RO-train pattern from 20260727_meter_replacement_wiring.sql. Until now,
-- power_meter_changes only recorded the CT multiplier change (old_multiplier /
-- new_multiplier) — there was nowhere to record what the OLD physical meter
-- last read and what the NEW physical meter started at.
--
-- Adds:
--   old_meter_final_reading    — cumulative kWh the old meter last read
--   new_meter_initial_reading  — cumulative kWh the new meter read at install
--                                 (this becomes meter_reading_kwh on the
--                                 swap-point power_readings row instead of
--                                 blindly carrying the old value forward)
--   reading_id                 — links back to the specific power_readings row
--                                 the swap produced (new-swap flow) or the
--                                 existing row a post-hoc edit flags (matches
--                                 well_meter_replacements.reading_id /
--                                 locator_meter_replacements.reading_id /
--                                 product_meter_replacements.reading_id).
-- =============================================================================

ALTER TABLE public.power_meter_changes
  ADD COLUMN IF NOT EXISTS old_meter_final_reading   NUMERIC,
  ADD COLUMN IF NOT EXISTS new_meter_initial_reading NUMERIC,
  ADD COLUMN IF NOT EXISTS reading_id UUID REFERENCES public.power_readings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_power_meter_changes_reading_id
  ON public.power_meter_changes(reading_id);

COMMENT ON COLUMN public.power_meter_changes.old_meter_final_reading IS
  'Cumulative kWh the OLD physical meter last read before it was swapped out. Required in the UI.';
COMMENT ON COLUMN public.power_meter_changes.new_meter_initial_reading IS
  'Cumulative kWh the NEW physical meter read at install. Required in the UI; becomes meter_reading_kwh on the swap-point power_readings row.';
COMMENT ON COLUMN public.power_meter_changes.reading_id IS
  'The power_readings row this change produced (live swap) or was retroactively flagged against (history edit).';

NOTIFY pgrst, 'reload schema';
