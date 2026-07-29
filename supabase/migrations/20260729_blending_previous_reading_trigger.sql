-- =============================================================================
-- Migration: 20260729_blending_previous_reading_trigger.sql
--
-- MUST RUN AFTER: 20260729_blending_events_meter_columns.sql (adds
-- raw_meter_reading / is_meter_replacement as real columns, plus the
-- UPDATE/DELETE RLS policies this migration's trigger needs in order for
-- non-admin writes to actually take effect). Safe to run standalone too —
-- the ADD COLUMN IF NOT EXISTS lines below repeat those two columns
-- defensively in case ordering ever gets reversed.
--
-- CONTEXT: removing the "Direct m³" input mode (BlendingSection.tsx) stopped
-- operators from *choosing* to bypass the meter, but the mechanism that
-- actually corrupted volume_m3 historically is still live even after that
-- fix. BlendingRow resolves "previous cumulative reading" from localStorage
-- and computes the delta client-side; when no previous reading is found —
-- a new device, a cleared cache, a different field operator's phone, the
-- first save of the session — it still falls back to storing the raw meter
-- reading itself as if it were the day's volume. A fresh browser has no
-- localStorage entry, so this can still happen for any entry made today,
-- not just the historical rows already sitting in the table.
--
-- This migration moves "what is today's volume" out of the client entirely.
-- previous_reading becomes a real, DB-owned column. The client only ever
-- sends raw_meter_reading (+ reading_datetime, is_meter_replacement); the
-- trigger below resolves previous_reading from the well's own last
-- blending_events row and computes volume_m3 itself, on every INSERT and
-- UPDATE — a client can no longer set volume_m3 directly. A well's
-- first-ever reading now correctly logs 0 m³ today (nothing to diff against
-- yet) instead of dumping the full cumulative reading into "today's
-- volume" — that fallback was the bug.
--
-- Also discovered while writing this: reading_datetime on blending_events
-- has never appeared in any committed migration either (same ad-hoc-via-
-- dashboard pattern already found and fixed for raw_meter_reading /
-- is_meter_replacement in 20260729_blending_events_meter_columns.sql), even
-- though BlendingSection.tsx and ReadingHistoryDialog.tsx have been
-- reading/writing it against this table all along. Added defensively below.
--
-- COMPANION CHANGE: backend/blending_repair_audit.py's --apply path now also
-- writes previous_reading explicitly for every row it corrects (see that
-- file's diff). Without that, this trigger would treat the second row of a
-- repaired run as a fresh baseline — its own predecessor is still
-- unresolved with raw_meter_reading = NULL at that point — and re-zero the
-- exact delta the script just fixed. Run the repair script's --apply only
-- after both this migration and its own updated version are in place.
-- =============================================================================

ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS raw_meter_reading NUMERIC
    CHECK (raw_meter_reading IS NULL OR raw_meter_reading >= 0),
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reading_datetime TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_reading NUMERIC;

COMMENT ON COLUMN public.blending_events.previous_reading IS
  'Cumulative reading from this well''s prior blending_events row. Resolved '
  'server-side by trg_blending_set_reading on INSERT when not explicitly '
  'supplied — never trust a client-computed value for this. Left NULL means '
  'this row is this well''s baseline (no prior reading exists yet).';

-- ── Server-side previous_reading resolution + volume_m3 ownership ──────────
CREATE OR REPLACE FUNCTION public.fn_blending_set_reading()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_meter_reading IS NULL THEN
    RAISE EXCEPTION 'blending_events.raw_meter_reading is required — blending wells are meter-fed, direct volume entry is not supported';
  END IF;

  -- Only auto-resolve on INSERT, and only when the caller didn't supply one.
  -- An UPDATE that omits previous_reading simply keeps whatever is already
  -- stored (Postgres carries OLD values forward for columns not present in
  -- the UPDATE's SET list) — so a plain "fix a typo'd reading" edit via
  -- ReadingHistoryDialog never gets silently re-baselined.
  IF TG_OP = 'INSERT' AND NEW.previous_reading IS NULL THEN
    SELECT raw_meter_reading INTO NEW.previous_reading
    FROM public.blending_events
    WHERE well_id = NEW.well_id
      AND id <> NEW.id
      AND (event_date < NEW.event_date
           OR (event_date = NEW.event_date AND reading_datetime IS NOT NULL
               AND NEW.reading_datetime IS NOT NULL AND reading_datetime < NEW.reading_datetime))
    ORDER BY event_date DESC, reading_datetime DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF NEW.is_meter_replacement THEN
    -- New meter, nothing to diff against — delta zeroed, this reading
    -- becomes the anchor for future deltas.
    NEW.volume_m3 := 0;
  ELSIF NEW.previous_reading IS NULL THEN
    -- No prior reading exists anywhere for this well — genuine baseline.
    -- This is the actual fix: 0 m³ logged today, not the full cumulative
    -- reading dumped in as "today's volume".
    NEW.volume_m3 := 0;
  ELSE
    IF NEW.raw_meter_reading < NEW.previous_reading THEN
      RAISE EXCEPTION 'raw_meter_reading (%) is below the previous cumulative reading (%) for this well — check for a meter replacement or entry error', NEW.raw_meter_reading, NEW.previous_reading;
    END IF;
    NEW.volume_m3 := NEW.raw_meter_reading - NEW.previous_reading;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blending_set_reading ON public.blending_events;
CREATE TRIGGER trg_blending_set_reading
  BEFORE INSERT OR UPDATE OF raw_meter_reading, previous_reading, is_meter_replacement
  ON public.blending_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_blending_set_reading();

NOTIFY pgrst, 'reload schema';
