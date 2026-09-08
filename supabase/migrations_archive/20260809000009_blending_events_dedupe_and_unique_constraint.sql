-- =============================================================================
-- Migration: 20260809_blending_events_dedupe_and_unique_constraint.sql
--
-- CONTEXT: blending_events has never had a uniqueness guarantee on
-- (well_id, event_date). The only protection against two rows for the same
-- well on the same day was app-side: BlendingSection.tsx SELECTs to check
-- whether a row already exists, then branches to INSERT or UPDATE. That's a
-- classic check-then-act race — a double-click, a slow network retry, or
-- two people saving around the same time can each pass the "does it exist?"
-- check before either write has landed, producing two rows for the same
-- well/day. Each row then surfaces as its own card in the notification bell
-- (Dashboard.tsx's blending feed alert), which is what showed up as
-- duplicate "Injected NNN m³" notifications for the same well.
--
-- This migration:
--   1. Deduplicates any existing (well_id, event_date) collisions, keeping
--      one row per group (preferring the row with a real reading_datetime,
--      then the most recently entered one).
--   2. Adds a UNIQUE constraint on (well_id, event_date) so Postgres itself
--      rejects any future duplicate, race or not.
--   3. Adds fn_blending_upsert_reading(), an atomic INSERT ... ON CONFLICT
--      DO UPDATE the frontend can call instead of its old select-then-write
--      pair, closing the race window entirely rather than just detecting it
--      after the fact. SECURITY INVOKER, so existing RLS policies
--      (analyst_write_blending_events / blending_events_update) still apply
--      exactly as they do for direct .insert()/.update() calls.
-- =============================================================================

-- ── 1. Dedupe existing collisions ───────────────────────────────────────────
-- Keep one row per (well_id, event_date): prefer a real reading_datetime
-- over NULL, then the most recently entered (noted_at), then highest id as
-- a final tiebreak. Safe to delete the losers outright — previous_reading
-- on any later row is a value baked in at write time, not a live foreign
-- key, so removing an earlier duplicate can't corrupt a later row's stored
-- delta. reading_edit_audit_log / reading_anomaly_remarks reference
-- blending_events rows by a loosely-typed (table_name, record_id) pair with
-- no FK, so a removed duplicate's audit trail simply stays as history —
-- same as any other hard delete of a blending_events row today.
DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY well_id, event_date
        ORDER BY reading_datetime DESC NULLS LAST, noted_at DESC, id DESC
      ) AS rn
    FROM public.blending_events
  ),
  deleted AS (
    DELETE FROM public.blending_events
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;

  RAISE NOTICE 'blending_events dedupe: removed % duplicate row(s) for (well_id, event_date)', dup_count;
END $$;

-- ── 2. Enforce it going forward ─────────────────────────────────────────────
ALTER TABLE public.blending_events
  DROP CONSTRAINT IF EXISTS blending_events_well_date_uniq;
ALTER TABLE public.blending_events
  ADD CONSTRAINT blending_events_well_date_uniq UNIQUE (well_id, event_date);

-- ── 3. Atomic upsert, replacing the racy select-then-write pair ────────────
-- p_update_previous_reading controls whether previous_reading is allowed to
-- overwrite an EXISTING row (the ON CONFLICT DO UPDATE branch):
--   - CSV import (BlendingSection.tsx) always passes previous_reading
--     through on overwrite when it has one, so it passes true.
--   - Manual entry (BlendingRow.save) never wants to re-baseline an
--     existing row from a client-tracked cumulative value, so it passes
--     false — matching the old manual UPDATE branch, which omitted
--     previous_reading entirely.
-- Either way, previous_reading is still used to seed a genuine new row on
-- INSERT; when omitted (NULL), trg_blending_set_reading resolves it from
-- the well's own last row exactly as it already does today.
CREATE OR REPLACE FUNCTION public.fn_blending_upsert_reading(
  p_well_id                 UUID,
  p_plant_id                UUID,
  p_well_name               TEXT,
  p_plant_name              TEXT,
  p_event_date              DATE,
  p_reading_datetime        TIMESTAMPTZ,
  p_raw_meter_reading       NUMERIC,
  p_previous_reading        NUMERIC DEFAULT NULL,
  p_update_previous_reading BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.blending_events
    (well_id, plant_id, well_name, plant_name, event_date, reading_datetime,
     raw_meter_reading, previous_reading)
  VALUES
    (p_well_id, p_plant_id, p_well_name, p_plant_name, p_event_date, p_reading_datetime,
     p_raw_meter_reading, p_previous_reading)
  ON CONFLICT (well_id, event_date) DO UPDATE SET
    plant_id          = EXCLUDED.plant_id,
    well_name         = EXCLUDED.well_name,
    plant_name        = EXCLUDED.plant_name,
    reading_datetime   = COALESCE(EXCLUDED.reading_datetime, public.blending_events.reading_datetime),
    raw_meter_reading = EXCLUDED.raw_meter_reading,
    previous_reading  = CASE
                           WHEN p_update_previous_reading AND EXCLUDED.previous_reading IS NOT NULL
                             THEN EXCLUDED.previous_reading
                           ELSE public.blending_events.previous_reading
                         END
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_blending_upsert_reading(
  UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, NUMERIC, NUMERIC, BOOLEAN
) TO authenticated;

NOTIFY pgrst, 'reload schema';
