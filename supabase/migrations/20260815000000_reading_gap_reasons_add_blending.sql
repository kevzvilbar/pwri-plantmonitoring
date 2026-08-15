-- =============================================================================
-- Migration: 20260815000000_reading_gap_reasons_add_blending.sql
-- Extends reading_gap_reasons (see 20260719_offline_reason_tracking.sql) to
-- accept entity_type = 'blending'.
--
-- The "No reading — why?" gap-reason dialog exists on the Well and Locator
-- tabs (WellSection.tsx / LocatorSection.tsx) but was never added to the
-- Blending tab, so operators had no way to explain a day with no blending
-- meter reading. blending_events is keyed by well_id, but blending wells are
-- tracked as a distinct entity_type here (not 'well') because a well's
-- regular well_readings gap and its blending_events gap are two different
-- things — a well can be logged for one and not the other on the same day.
-- =============================================================================

ALTER TABLE reading_gap_reasons DROP CONSTRAINT IF EXISTS reading_gap_reasons_entity_type_check;
ALTER TABLE reading_gap_reasons ADD CONSTRAINT reading_gap_reasons_entity_type_check
  CHECK (entity_type IN ('well', 'locator', 'ro_train', 'blending'));
