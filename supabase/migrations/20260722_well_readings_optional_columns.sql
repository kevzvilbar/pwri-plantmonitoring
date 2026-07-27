-- =============================================================================
-- Migration: 20260722_well_readings_optional_columns.sql
--
-- Formally adds four columns to well_readings that were created ad-hoc via
-- the Supabase dashboard and therefore absent from all migrations.  Missing
-- from migrations means:
--   1. A DB rebuild from migrations loses the columns silently.
--   2. PostgREST's schema cache may be stale (no NOTIFY was ever sent after
--      adding them ad-hoc), causing UPDATE payloads that include these columns
--      to fail with the misleading error:
--        "relation 'well_readings' does not exist"
--
-- Affected frontend:  ReadingHistoryDialog.tsx → saveEdit() (well module)
--                     WellSection.tsx → saveTds(), saveNtu(), savePressure()
--
-- All ADD COLUMN statements use IF NOT EXISTS — safe against any DB that
-- already has the columns from the prior ad-hoc additions.
-- =============================================================================

-- ── 1. tds_ppm ────────────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS tds_ppm NUMERIC
    CHECK (tds_ppm IS NULL OR tds_ppm >= 0);

COMMENT ON COLUMN public.well_readings.tds_ppm IS
  'Total dissolved solids in parts-per-million. Measured at point of well discharge.';

-- ── 2. turbidity_ntu ─────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS turbidity_ntu NUMERIC
    CHECK (turbidity_ntu IS NULL OR turbidity_ntu >= 0);

COMMENT ON COLUMN public.well_readings.turbidity_ntu IS
  'Water turbidity in Nephelometric Turbidity Units.';

-- ── 3. pressure_psi ──────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS pressure_psi NUMERIC
    CHECK (pressure_psi IS NULL OR pressure_psi >= 0);

COMMENT ON COLUMN public.well_readings.pressure_psi IS
  'Wellhead pressure in pounds per square inch.';

-- ── 4. is_meter_replacement ──────────────────────────────────────────────────
-- Flags readings where the meter was physically replaced.  When true, the
-- daily_volume delta is zeroed so dashboards do not miscount the new meter's
-- lower reading as a production loss.
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.well_readings.is_meter_replacement IS
  'True when this reading immediately follows a physical meter swap. daily_volume is treated as 0 for this row.';

-- ── 5. Index — TDS / NTU queries for water quality reports ──────────────────
CREATE INDEX IF NOT EXISTS idx_well_readings_water_quality
  ON public.well_readings (well_id, reading_datetime DESC)
  WHERE tds_ppm IS NOT NULL OR turbidity_ntu IS NOT NULL;

-- ── 6. Reload PostgREST schema cache ─────────────────────────────────────────
-- Without this, PostgREST keeps its stale in-memory schema and UPDATE
-- payloads that include the new columns are rejected with:
--   "relation 'well_readings' does not exist"
-- This NOTIFY unblocks the issue immediately without needing a server restart.
NOTIFY pgrst, 'reload schema';
