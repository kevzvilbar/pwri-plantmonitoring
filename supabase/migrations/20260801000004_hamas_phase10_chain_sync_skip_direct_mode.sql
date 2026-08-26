-- =============================================================================
-- Migration: hamas_phase10_chain_sync_skip_direct_mode
-- Applied 2026-08-01, during the HAMAS all-zero-history investigation.
--
-- fn_sync_locator_reading_chain (trigger trg_locator_readings_delta, AFTER
-- INSERT/UPDATE/DELETE on locator_readings — never itself committed to any
-- migration, only discovered via pg_get_functiondef) maintains a
-- running-cumulative chain (previous_reading = chronological predecessor's
-- current_reading) for raw meters, and patches the successor row's
-- previous_reading whenever any row changes. That concept doesn't apply to
-- direct-mode/derived locators (current_reading IS the period volume,
-- previous_reading is always 0 by design) — applying it there was actively
-- harmful, patching in a real predecessor value and cascading corruption
-- through the chain any time an adjacent date got (re)swept. Make it a
-- no-op for direct-mode locators.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_locator_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locator_id        UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_input_mode        TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_locator_id := OLD.locator_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_locator_id := NEW.locator_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  SELECT default_input_mode INTO v_input_mode FROM public.locators WHERE id = v_locator_id;
  IF v_input_mode = 'direct' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT current_reading
      INTO v_predecessor_read
      FROM public.locator_readings
     WHERE locator_id    = v_locator_id
       AND reading_datetime < v_reading_dt
     ORDER BY reading_datetime DESC
     LIMIT 1;

    IF v_predecessor_read IS NOT NULL
       AND (NEW.previous_reading IS DISTINCT FROM v_predecessor_read) THEN
      UPDATE public.locator_readings
         SET previous_reading = v_predecessor_read
       WHERE id = NEW.id;
    END IF;
  END IF;

  SELECT id
    INTO v_successor_id
    FROM public.locator_readings
   WHERE locator_id      = v_locator_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      UPDATE public.locator_readings
         SET previous_reading = OLD.previous_reading
       WHERE id = v_successor_id;
    ELSE
      UPDATE public.locator_readings
         SET previous_reading = NEW.current_reading
       WHERE id = v_successor_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
