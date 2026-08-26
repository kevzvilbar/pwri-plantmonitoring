-- =============================================================================
-- Migration: 20260822_power_readings_meter_reading_kwh_nullable.sql
--
-- BUG: "A required field is missing: 'meter reading kwh'. Please fill it in
-- and try again." — thrown when backfilling a power reading on a previous
-- date for a multi-meter plant, if the meter being saved first isn't meter 0
-- (e.g. only "Grid Meter 2 Pumphouse" has data for that historical date).
--
-- Root cause: power_readings.meter_reading_kwh was still NOT NULL from the
-- original single-meter schema. Once grid_meter_readings (JSONB, one entry
-- per meter) became the real source of truth for multi-meter plants,
-- meter_reading_kwh was kept only as a backward-compat mirror of meter 0 —
-- but the column constraint was never relaxed to match. A brand-new row
-- (no existing reading that day yet, which is exactly the backfill case)
-- for any meter other than meter 0 has nothing to put in that column, and
-- Postgres rejected the insert outright.
--
-- This was already the intended design elsewhere:
--   - fn_power_readings_before_upsert / fn_trg_recalc_successor: both
--     null-guard meter_reading_kwh before using it and prefer
--     grid_meter_readings when present.
--   - Frontend reads (useDashboardAggregates, useTrendChartData,
--     ReadingHistoryDialog, PowerMeters.tsx) already treat it as optional
--     (`!= null` checks / `??` fallbacks).
-- Only the column constraint itself was out of sync with that design.
-- =============================================================================

ALTER TABLE public.power_readings
  ALTER COLUMN meter_reading_kwh DROP NOT NULL;

COMMENT ON COLUMN public.power_readings.meter_reading_kwh IS
  'Legacy meter-0 cumulative kWh, kept for backward compatibility with dashboards, the CSV importer, and anything else not yet migrated to grid_meter_readings. Nullable since a multi-meter plant''s backfilled row may not include meter 0''s reading at all (e.g. only meters 2/3 entered) — grid_meter_readings is the source of truth. Every trigger reading this column already null-guards it (fn_power_readings_before_upsert, fn_trg_recalc_successor); this just aligns the column constraint with that existing design.';

NOTIFY pgrst, 'reload schema';
