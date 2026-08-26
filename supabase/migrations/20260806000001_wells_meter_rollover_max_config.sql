-- =============================================================================
-- Migration: 20260806143000_wells_meter_rollover_max_config.sql
-- Per-well meter rollover config (gap #2 from the meter-rollover diagnostic
-- alongside 20260720_recursive_cascade_and_meter_rollover.sql and
-- 20260806*_meter_rollover_backfill.sql).
--
-- Context: the "meter rollover" checkbox at reading-entry time
-- (frontend/src/pages/operations/wells/WellSection.tsx) defaults the wrap
-- point to a hardcoded '99999' that the operator has to overtype by hand
-- every time. Nothing records what a given well's meter actually wraps at,
-- so that default is frequently wrong (e.g. Well 9's 6-digit register wraps
-- at 999999.99, not 99999.99) and easy to enter incorrectly under pressure
-- during a live reading.
--
-- This column is a per-well source of truth for that wrap point:
--   - WellSection.tsx's entry-time default reads it instead of the literal.
--   - Admin → Edit Well exposes it so it can be set once and reused.
--   - Data Corrections' "Mark as rollover" action (Pending Review tab) can
--     eventually default to it too, though today it still uses a guessed
--     digit-count heuristic per row, same as the backfill script's Step 1 —
--     wiring the two together is a follow-up, not required for either to work.
--
-- NULL means "not configured yet" — callers keep falling back to the
-- guessed/hardcoded default, so this is purely additive and never required.
-- =============================================================================

ALTER TABLE wells
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

COMMENT ON COLUMN wells.meter_rollover_max IS
  'Physical meter register wrap point for this well (e.g. 999999.99 for a 6-digit odometer). NULL = not configured; callers fall back to a guessed or hardcoded default. Used to pre-fill the rollover checkbox at reading entry (WellSection.tsx) and, going forward, the Data Corrections "Mark as rollover" action.';

-- Per this project's convention (see 20260722_z_pgrst_schema_reload.sql):
-- new columns need this or PostgREST can reject requests referencing them
-- with a misleading "relation does not exist" error until its next
-- periodic cache reload.
NOTIFY pgrst, 'reload schema';
