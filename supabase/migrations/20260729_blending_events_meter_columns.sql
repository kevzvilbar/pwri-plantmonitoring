-- =============================================================================
-- Migration: 20260729_blending_events_meter_columns.sql
--
-- Formally adds two columns to blending_events that were created ad-hoc via
-- the Supabase dashboard and therefore absent from all migrations — same
-- root cause already fixed for well_readings in
-- 20260722_well_readings_optional_columns.sql. Missing from migrations means:
--   1. A DB rebuild from migrations loses the columns silently.
--   2. PostgREST's schema cache may be stale (no NOTIFY was ever sent after
--      adding them ad-hoc), causing UPDATE/INSERT payloads that include
--      these columns to fail with the misleading error:
--        "relation 'blending_events' does not exist"
--
-- CONTEXT — pairs with the Operations > Blending fix that removed the
-- "Direct m³" input mode (frontend/src/pages/operations/blending/
-- BlendingSection.tsx): every blending well is physically metered, so
-- volume_m3 is now always a delta computed from two raw_meter_reading
-- values, never a directly-typed figure. raw_meter_reading being nullable
-- pre-fix is exactly how rows with no meter reading on record (Direct-mode
-- saves) got into the table with only a volume_m3 figure and no way to
-- verify or recompute it — see ReadingHistoryDialog.tsx's "Reading" column
-- for blending, which surfaces this gap today. NOT NULL isn't applied here
-- because existing Direct-mode rows already violate it; a follow-up
-- data-repair pass should backfill or flag those before tightening this
-- to NOT NULL.
--
-- Affected frontend: BlendingSection.tsx (BlendingForm, BlendingRow, CSV
--                     import), ReadingHistoryDialog.tsx (blending module).
--
-- All ADD COLUMN statements use IF NOT EXISTS — safe against any DB that
-- already has the columns from the prior ad-hoc additions.
-- =============================================================================

-- ── 1. raw_meter_reading ─────────────────────────────────────────────────────
-- The cumulative meter reading the operator read off the physical meter.
-- volume_m3 (the daily delta) is derived from this minus the previous
-- reading — the app has no way to compute a trustworthy volume without it.
ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS raw_meter_reading NUMERIC
    CHECK (raw_meter_reading IS NULL OR raw_meter_reading >= 0);

COMMENT ON COLUMN public.blending_events.raw_meter_reading IS
  'Cumulative meter reading at time of entry. volume_m3 is this minus the '
  'previous reading for the same well. Nullable only for legacy rows saved '
  'before the Direct-m³ input mode was removed — new rows should always '
  'populate this.';

-- ── 2. is_meter_replacement ──────────────────────────────────────────────────
-- Flags readings where the meter was physically replaced. When true, the
-- volume_m3 delta is treated as 0 so dashboards don't miscount the new
-- meter's lower reading as a production loss — same convention as
-- well_readings.is_meter_replacement (20260722_well_readings_optional_columns.sql).
ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.blending_events.is_meter_replacement IS
  'True when this reading immediately follows a physical meter swap. '
  'volume_m3 is treated as 0 for this row.';

-- ── 3. UPDATE / DELETE RLS policies ──────────────────────────────────────────
-- blending_events was created (20260515_supabase_only_and_data_analysis.sql)
-- with only SELECT and INSERT policies — every other operational readings
-- table (well_readings, locator_readings, ro_train_readings, etc.) got a
-- FOR ALL "{table}_plant_access" policy via the DO-block loop in
-- 20260419_initial_schema_enums_and_roles.sql, but blending_events was never
-- added to that array.
--
-- Effect in production today: ReadingHistoryDialog.tsx's Edit/Delete buttons
-- render unconditionally for blending (canEditDelete = true, no frontend role
-- gate — see line ~568) and call .update()/.delete() against blending_events,
-- but with no UPDATE/DELETE policy those calls affect 0 rows and are caught
-- by the component's own defensive "returned 0 rows. Add policy…" console
-- warnings. So this has been silently broken for every user, and is a direct
-- blocker for fixing the corrupted-volume rows that motivated this migration
-- (rows with volume_m3 holding a raw cumulative reading instead of a delta —
-- see BlendingSection.tsx's removal of the Direct-m³ input mode).
--
-- Matches the plant-access convention used for the other readings tables:
-- any authenticated user with access to the well's plant may write, exactly
-- like well_readings_plant_access / locator_readings_plant_access.
DROP POLICY IF EXISTS "blending_events_update" ON public.blending_events;
CREATE POLICY "blending_events_update" ON public.blending_events
  FOR UPDATE TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "blending_events_delete" ON public.blending_events;
CREATE POLICY "blending_events_delete" ON public.blending_events
  FOR DELETE TO authenticated
  USING (public.user_has_plant_access(plant_id));

-- ── 4. Reload PostgREST schema cache ─────────────────────────────────────────
-- Without this, PostgREST keeps its stale in-memory schema and UPDATE/INSERT
-- payloads that include the new columns are rejected with:
--   "relation 'blending_events' does not exist"
-- This NOTIFY unblocks the issue immediately without needing a server restart.
NOTIFY pgrst, 'reload schema';
