-- =============================================================================
-- BACKFILL MIGRATION — already applied live, never committed until now.
-- Recovered verbatim from the live database (project sosfbfxovtleuvahxvpm)
-- during the Parkmall / "Well 2" Data Summary investigation (2026-08-10).
--
-- Gives well_readings the same AFTER-trigger chain-repair that
-- locator_readings already has (fn_sync_locator_reading_chain): re-derives
-- previous_reading + daily_volume fresh on every insert/update/delete and
-- heals the immediate successor, so an out-of-order backfill or edit
-- doesn't leave a later row's previous_reading permanently stale.
--
-- NOTE: this fixes the trigger going forward only. It does not retroactively
-- repair rows that drifted before this trigger existed — see
-- reading_chain_drift_audit.sql (committed the same day) for the current
-- scale of that backlog across wells. That backlog is a separate, larger
-- cleanup (several wells show real drift, some of it possibly tangled up
-- with un-flagged meter replacements) and is NOT touched by this migration
-- or by the two migrations that follow it today.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_well_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
/*
  Called AFTER INSERT, UPDATE, or DELETE on well_readings.

  Same chain-repair strategy as locator_readings, but because daily_volume
  is a plain column we write all three derived values (previous_reading,
  daily_volume) directly on the mutated row and then heal the successor.

  current_reading may be NULL on well rows (partial reading entry) —
  we guard with NULLIF to avoid writing a nonsensical delta.
*/
DECLARE
  v_well_id           UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_id    UUID;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_new_prev          NUMERIC;
BEGIN

  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + daily_volume ──────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT id, current_reading
      INTO v_predecessor_id, v_predecessor_read
      FROM public.well_readings
     WHERE well_id          = v_well_id
       AND reading_datetime < v_reading_dt
       AND current_reading IS NOT NULL           -- skip partial rows as predecessors
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.well_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN NEW.current_reading IS NOT NULL
                                 AND v_predecessor_read  IS NOT NULL
                                THEN GREATEST(0, NEW.current_reading - v_predecessor_read)
                                WHEN NEW.current_reading IS NOT NULL
                                THEN NEW.current_reading        -- first reading in chain
                                ELSE NULL
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id
    INTO v_successor_id
    FROM public.well_readings
   WHERE well_id          = v_well_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      -- Successor's predecessor is now OLD's predecessor.
      v_new_prev := OLD.previous_reading;
    ELSE
      -- Successor's predecessor is this row's current_reading.
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.well_readings AS wr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN wr.current_reading IS NOT NULL
                                 AND v_new_prev          IS NOT NULL
                                THEN GREATEST(0, wr.current_reading - v_new_prev)
                                WHEN wr.current_reading IS NOT NULL
                                THEN wr.current_reading
                                ELSE NULL
                              END
     WHERE wr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_well_readings_delta ON public.well_readings;
CREATE TRIGGER trg_well_readings_delta
  AFTER INSERT OR DELETE OR UPDATE OF current_reading ON public.well_readings
  FOR EACH ROW EXECUTE FUNCTION fn_sync_well_reading_chain();
