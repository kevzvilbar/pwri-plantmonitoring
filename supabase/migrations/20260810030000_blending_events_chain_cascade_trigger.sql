-- =============================================================================
-- Root cause of the "Well 2" blending History showing inflated multi-
-- thousand-m3 volumes (reported 2026-08-10, screenshots of two "Well 2 —
-- History" dialogs disagreeing — the blending-events view vs the
-- well_readings meter-history view for the same physical meter).
--
-- blending_events only had fn_blending_set_reading (BEFORE INSERT/UPDATE),
-- which resolves previous_reading ONCE, at insert time, and only when the
-- caller didn't already supply one — with no mechanism to re-walk the
-- chain when an earlier row is backfilled after a later one already
-- exists. A well acting as a blending source doesn't always get same-day
-- entries, so a later row's previous_reading gets stuck pointing at
-- whatever was the most recent row AT INSERT TIME, silently skipping any
-- earlier row backfilled afterward and double- (or triple-) counting
-- those skipped days into one. Adds the same AFTER-trigger chain-repair
-- pattern as well_readings / locator_readings / product_meter_readings.
--
-- The successor-patch step deliberately skips any successor whose
-- raw_meter_reading IS NULL — pre-migration legacy rows that carry a
-- manually-set volume_m3 with no meter reading to diff against. Touching
-- those would both compute a meaningless NULL volume and re-fire
-- fn_blending_set_reading (which also fires on UPDATE OF previous_reading)
-- straight into its "raw_meter_reading is required" guard.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_blending_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_well_id        UUID;
  v_event_date     DATE;
  v_reading_dt     TIMESTAMPTZ;
  v_predecessor    NUMERIC;
  v_successor_id   UUID;
  v_successor_repl BOOLEAN;
  v_successor_raw  NUMERIC;
  v_new_prev       NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_event_date := OLD.event_date;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_event_date := NEW.event_date;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + volume_m3 ─────────
  -- Ordering matches fn_blending_set_reading's own convention: event_date,
  -- then reading_datetime as a tiebreaker within the same date.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT raw_meter_reading INTO v_predecessor
      FROM public.blending_events
     WHERE well_id = v_well_id
       AND id <> NEW.id
       AND (event_date < v_event_date
            OR (event_date = v_event_date AND reading_datetime IS NOT NULL
                AND v_reading_dt IS NOT NULL AND reading_datetime < v_reading_dt))
     ORDER BY event_date DESC, reading_datetime DESC NULLS LAST
     LIMIT 1;

    UPDATE public.blending_events
       SET previous_reading = v_predecessor,
           volume_m3        = CASE
                                WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
                                WHEN v_predecessor IS NULL THEN 0
                                ELSE GREATEST(0, raw_meter_reading - v_predecessor)
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), raw_meter_reading
    INTO v_successor_id, v_successor_repl, v_successor_raw
    FROM public.blending_events
   WHERE well_id = v_well_id
     AND (event_date > v_event_date
          OR (event_date = v_event_date AND reading_datetime IS NOT NULL
              AND v_reading_dt IS NOT NULL AND reading_datetime > v_reading_dt))
   ORDER BY event_date ASC, reading_datetime ASC NULLS LAST
   LIMIT 1;

  IF v_successor_id IS NOT NULL AND v_successor_raw IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.raw_meter_reading;
    END IF;

    UPDATE public.blending_events AS be
       SET previous_reading = v_new_prev,
           volume_m3        = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_new_prev IS NULL THEN 0
                                ELSE GREATEST(0, be.raw_meter_reading - v_new_prev)
                              END
     WHERE be.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_blending_readings_chain ON public.blending_events;
CREATE TRIGGER trg_blending_readings_chain
  AFTER INSERT OR DELETE OR UPDATE OF raw_meter_reading ON public.blending_events
  FOR EACH ROW EXECUTE FUNCTION fn_sync_blending_reading_chain();

-- ── Data repair ───────────────────────────────────────────────────────────
-- Fires the new trigger on every existing row with a raw meter reading, so
-- previous_reading / volume_m3 are recomputed from the true chronological
-- predecessor. EXCLUDES "Inside Well" (Mambaling) rows dated on or before
-- 2026-07-01: that well's early history has event_date and reading_datetime
-- running ~6-7 days apart from each other in a way that isn't consistent
-- enough to auto-repair safely (see reading_chain_drift_audit.sql) — left
-- alone deliberately, flagged for manual review rather than guessed at.
--
-- UPDATE blending_events
-- SET raw_meter_reading = raw_meter_reading
-- WHERE id IN (
--   SELECT id FROM blending_events
--   WHERE raw_meter_reading IS NOT NULL
--     AND NOT (well_id = (SELECT id FROM wells WHERE name = 'Inside Well' AND plant_id =
--                          (SELECT id FROM plants WHERE name = 'Mambaling'))
--              AND event_date <= '2026-07-01')
--   ORDER BY well_id, event_date ASC, reading_datetime ASC
-- );
