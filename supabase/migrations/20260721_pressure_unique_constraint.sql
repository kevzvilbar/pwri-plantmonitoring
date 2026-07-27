-- =============================================================================
-- Migration: 20260721_pressure_unique_constraint.sql
--
-- Codifies the `uix_well_one_per_user_per_hour` unique index that was created
-- directly in the Supabase dashboard (ad-hoc) and therefore missing from
-- migrations. Without this migration, a full DB rebuild from migrations would
-- silently lose the constraint.
--
-- Constraint intent: prevent an operator from inserting two separate
-- well_readings rows for the same well within the same clock-hour. Updates
-- to an existing row are not affected.
--
-- Uses IF NOT EXISTS — safe to run against a DB that already has the index.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uix_well_one_per_user_per_hour
  ON well_readings (well_id, recorded_by, date_trunc('hour', reading_datetime));
