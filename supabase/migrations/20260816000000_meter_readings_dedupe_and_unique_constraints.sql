-- =============================================================================
-- Migration: 20260816000000_meter_readings_dedupe_and_unique_constraints.sql
--
-- CONTEXT: well_readings, locator_readings and product_meter_readings have
-- never had a uniqueness guarantee on (entity_id, reading_datetime) — the
-- same gap blending_events had before 20260809_blending_events_dedupe_and_
-- unique_constraint.sql. WellSection.tsx and LocatorSection.tsx's save()
-- already contain a `error.code === '23505'` handler with a friendly
-- "already submitted within the last hour" toast — that code has been dead
-- since it was written, because no constraint exists to ever raise a 23505
-- here. ProductSection.tsx's ProductMeterRow.save() never got that handling
-- at all.
--
-- The actual failure mode (confirmed against live data): after a successful
-- save, the reading input re-fills with the just-saved value (deliberate —
-- "start from the real odometer value"). If the operator isn't sure the
-- save registered, the field shows the *same* number they just entered.
-- Re-tapping Save resubmits current_reading === previous_reading, quietly
-- creating a genuine, zero-delta duplicate row rather than being rejected.
-- Confirmed live on well_readings, locator_readings and product_meter_
-- readings (~30 existing collisions across all three, oldest from May 2026);
-- power_readings shows no exact-timestamp collisions currently (submitMeter
-- already pre-checks for a same-day row via findExistingReading() and
-- merges into it instead of inserting) so it's left out of this migration.
--
-- This migration:
--   1. Deduplicates existing (entity_id, reading_datetime) collisions per
--      table, keeping the most-recently-entered row (highest created_at) in
--      each group — same tiebreak as the blending_events precedent. Most
--      groups are exact duplicates (identical current_reading) where the
--      choice is moot; a smaller number are two *different* values entered
--      moments apart, which this treats as "the later entry is the
--      operator's corrected/final one." Full list of removed rows reported
--      separately for review, since that assumption isn't verifiable from
--      the data alone.
--   2. Adds a UNIQUE index on (entity_id, reading_datetime) per table so
--      Postgres rejects any future duplicate outright, race or not.
--
-- Deliberately NOT adding an atomic upsert RPC (contrast fn_blending_
-- upsert_reading): blending wants "latest value wins" for one row per
-- well/day. Meter readings don't — two different values at the same
-- timestamp are a conflict to surface to the operator, not silently
-- resolve by overwrite. Insert + 23505 + friendly toast (already written on
-- the Well/Locator side) is the right shape here; Product just needs that
-- same handling added, which is a frontend-only change.
-- =============================================================================

-- ── 1. Dedupe existing collisions ───────────────────────────────────────────
DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY well_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.well_readings
  ),
  deleted AS (
    DELETE FROM public.well_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'well_readings dedupe: removed % duplicate row(s) for (well_id, reading_datetime)', dup_count;
END $$;

DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY locator_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.locator_readings
  ),
  deleted AS (
    DELETE FROM public.locator_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'locator_readings dedupe: removed % duplicate row(s) for (locator_id, reading_datetime)', dup_count;
END $$;

DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY meter_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.product_meter_readings
  ),
  deleted AS (
    DELETE FROM public.product_meter_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'product_meter_readings dedupe: removed % duplicate row(s) for (meter_id, reading_datetime)', dup_count;
END $$;

-- ── 2. Enforce it going forward ─────────────────────────────────────────────
ALTER TABLE public.well_readings
  DROP CONSTRAINT IF EXISTS well_readings_well_datetime_uniq;
ALTER TABLE public.well_readings
  ADD CONSTRAINT well_readings_well_datetime_uniq UNIQUE (well_id, reading_datetime);

ALTER TABLE public.locator_readings
  DROP CONSTRAINT IF EXISTS locator_readings_locator_datetime_uniq;
ALTER TABLE public.locator_readings
  ADD CONSTRAINT locator_readings_locator_datetime_uniq UNIQUE (locator_id, reading_datetime);

ALTER TABLE public.product_meter_readings
  DROP CONSTRAINT IF EXISTS product_meter_readings_meter_datetime_uniq;
ALTER TABLE public.product_meter_readings
  ADD CONSTRAINT product_meter_readings_meter_datetime_uniq UNIQUE (meter_id, reading_datetime);

NOTIFY pgrst, 'reload schema';
