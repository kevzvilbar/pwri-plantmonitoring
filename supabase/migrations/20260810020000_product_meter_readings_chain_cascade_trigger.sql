-- =============================================================================
-- product_meter_readings never had the AFTER-trigger chain-repair that
-- well_readings (fn_sync_well_reading_chain) and locator_readings
-- (fn_sync_locator_reading_chain) already have. Without it, an
-- out-of-order insert/edit/delete leaves a successor row's
-- previous_reading permanently stale — same class of bug already fixed
-- elsewhere in this schema, now the second half of the Parkmall fix (see
-- 20260810010000, which stops NEW cascades from forming; this one gives
-- every insert/update/delete a self-healing, status-independent recompute
-- + successor patch, for out-of-order backfills going forward).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_product_meter_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meter_id          UUID;
  v_plant_id          UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_is_derived        BOOLEAN;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_successor_repl    BOOLEAN;
  v_successor_roll    BOOLEAN;
  v_successor_rollmax NUMERIC;
  v_new_prev          NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_meter_id   := OLD.meter_id;
    v_plant_id   := OLD.plant_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_meter_id   := NEW.meter_id;
    v_plant_id   := NEW.plant_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- Derived (mirrored) meters get current_reading/daily_volume written
  -- directly by the locator-mirror sweep, not by cumulative-meter diffing
  -- — matches fn_product_meter_reading_integrity's own is_derived guard.
  SELECT is_derived INTO v_is_derived FROM public.product_meters WHERE id = v_meter_id;
  IF COALESCE(v_is_derived, FALSE) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + daily_volume ──────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT current_reading INTO v_predecessor_read
      FROM public.product_meter_readings
     WHERE meter_id         = v_meter_id
       AND plant_id         = v_plant_id
       AND reading_datetime < v_reading_dt
       AND (norm_status IS NULL OR norm_status <> 'retracted')
       AND id <> NEW.id
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.product_meter_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
                                WHEN COALESCE(is_meter_rollover, FALSE)
                                 AND meter_rollover_max IS NOT NULL
                                 AND v_predecessor_read IS NOT NULL
                                THEN GREATEST(0, meter_rollover_max - v_predecessor_read + current_reading)
                                ELSE GREATEST(0, current_reading - COALESCE(v_predecessor_read, 0))
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), COALESCE(is_meter_rollover, FALSE), meter_rollover_max
    INTO v_successor_id, v_successor_repl, v_successor_roll, v_successor_rollmax
    FROM public.product_meter_readings
   WHERE meter_id         = v_meter_id
     AND plant_id         = v_plant_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.product_meter_readings AS pmr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_successor_roll AND v_successor_rollmax IS NOT NULL AND v_new_prev IS NOT NULL
                                THEN GREATEST(0, v_successor_rollmax - v_new_prev + pmr.current_reading)
                                ELSE GREATEST(0, pmr.current_reading - COALESCE(v_new_prev, 0))
                              END
     WHERE pmr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_product_meter_readings_delta ON public.product_meter_readings;
CREATE TRIGGER trg_product_meter_readings_delta
  AFTER INSERT OR DELETE OR UPDATE OF current_reading ON public.product_meter_readings
  FOR EACH ROW EXECUTE FUNCTION fn_sync_product_meter_reading_chain();

-- ── Data repair ───────────────────────────────────────────────────────────
-- Fires the new trigger on every existing row so previous_reading /
-- daily_volume are recomputed from the true chronological predecessor.
-- Safe to run repeatedly (idempotent once the chain is correct).
--
-- UPDATE product_meter_readings
-- SET current_reading = current_reading
-- WHERE id IN (SELECT id FROM product_meter_readings ORDER BY meter_id, reading_datetime ASC);
