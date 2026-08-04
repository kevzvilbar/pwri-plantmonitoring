-- =============================================================================
-- Migration: hamas_phase9_fix_integrity_trigger_direct_mode
-- Applied 2026-08-01, during the HAMAS all-zero-history investigation.
--
-- fn_locator_reading_integrity (see 20260728044216_hamas_phase5_input_mode_
-- aware_guard.sql above) unconditionally overrode NEW.previous_reading from
-- the last non-pending_review predecessor BEFORE checking input mode, even
-- though it already has separate, correct spike-check logic for direct
-- mode further down. This silently clobbered previous_reading on every
-- write to a direct-mode/derived locator (e.g. HAMAS), fighting the sweep
-- function's own explicit writes and was the actual root cause the phase8
-- guard-drop (above) alone didn't fully address. Fix: only override
-- previous_reading for raw (cumulative-meter) locators; direct-mode
-- locators keep whatever previous_reading the caller set (0, per the sweep
-- function as of phase11 below).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading    NUMERIC;
  v_prev_dt         TIMESTAMPTZ;
  v_computed_vol    NUMERIC;
  v_hours_elapsed   NUMERIC;
  v_flow_rate       NUMERIC;
  v_avg_flow_rate   NUMERIC;
  v_input_mode      TEXT;
BEGIN
  SELECT default_input_mode INTO v_input_mode
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   locator_readings
  WHERE  locator_id   = NEW.locator_id
    AND  plant_id     = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  -- Only raw (cumulative-meter) locators get previous_reading derived from
  -- the chronological predecessor. Direct-mode locators (current_reading IS
  -- the period volume) keep whatever the caller set.
  IF v_input_mode <> 'direct' THEN
    NEW.previous_reading := v_prev_reading;
  END IF;

  IF v_input_mode = 'direct' THEN
    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' THEN
      SELECT AVG(sub.vol) INTO v_avg_flow_rate
      FROM (
        SELECT current_reading AS vol
        FROM   locator_readings
        WHERE  locator_id = NEW.locator_id
          AND  plant_id   = NEW.plant_id
          AND  norm_status = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
      ) sub;

      IF v_avg_flow_rate IS NOT NULL
         AND v_avg_flow_rate > 0
         AND NEW.current_reading > v_avg_flow_rate * 2.0
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- RAW MODE (unchanged) — backward-reading check
  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  -- Spike detection — flow rate > 2x 7-day average
  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    v_hours_elapsed := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;

    IF v_hours_elapsed > 0 THEN
      v_flow_rate := v_computed_vol / v_hours_elapsed;

      SELECT AVG(sub.flow_rate)
      INTO   v_avg_flow_rate
      FROM (
        SELECT (current_reading - previous_reading)
               / NULLIF(
                   EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0,
                 0)  AS flow_rate
        FROM   locator_readings
        WHERE  locator_id   = NEW.locator_id
          AND  plant_id     = NEW.plant_id
          AND  norm_status  = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
          AND  previous_reading IS NOT NULL
          AND  current_reading > previous_reading
      ) sub
      WHERE sub.flow_rate > 0;

      IF v_avg_flow_rate IS NOT NULL
         AND v_flow_rate > v_avg_flow_rate * 2.0
         AND NEW.norm_status = 'normal'
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
