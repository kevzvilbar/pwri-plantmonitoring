-- =============================================================================
-- Migration: hamas_phase15_derived_locators_skip_generic_spike
--
-- Context: derived, direct-mode locators (locators.is_derived = true, e.g.
-- HAMAS) get their daily value written by fn_sweep_derived_meters_for_date(),
-- not by an operator. fn_locator_reading_integrity's direct-mode branch
-- (phase9) applies the same ">2x trailing 7-day average" spike check to this
-- swept output as it does to operator-entered direct-mode readings, which
-- routes normal sweep results into the same Pending Review queue operators
-- use — with no way to tell, from that queue, that the row was never
-- human-entered in the first place.
--
-- Derived locators already have a purpose-built review path:
-- locator_derived_review_flags / fn_flag_derived_review() (phase3), which
-- opens a flag specifically when a sibling locator or the mother meter was
-- edited in a way that could change this locator's residual — surfaced via
-- fn_notify_derived_review(). That mechanism is scoped to the actual risk
-- (an upstream edit), rather than to the resulting number's size, so it
-- doesn't fire on a legitimate large-but-correct swing (e.g. after a long
-- gap in siblings is backfilled) the way the generic spike check does.
--
-- Change: skip the generic >2x spike flag when NEW's locator is derived.
-- Sweep output for derived locators is now always written norm_status =
-- 'normal' by this trigger; any review need is carried entirely by
-- locator_derived_review_flags/fn_flag_derived_review(), not by landing in
-- Pending Review.
--
-- Trade-off, on purpose left as-is rather than "fixed" further: this does
-- remove the safety net that has, in practice, been catching bugs in the
-- sweep pipeline itself (phases 6/8/9/10/11/12/13/14 were all fixes to that
-- pipeline, several same-day). If sweep bugs are still active, consider
-- holding off on this migration, or additionally hardening
-- fn_flag_derived_review()/the sweep function's own internal checks before
-- removing this net. Revert by re-running phase9's CREATE OR REPLACE if
-- needed — this migration only adds the is_derived branch on top of it.
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
  v_is_derived      BOOLEAN;
BEGIN
  SELECT default_input_mode, is_derived
  INTO   v_input_mode, v_is_derived
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');
  v_is_derived := COALESCE(v_is_derived, FALSE);

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
    -- Derived locators (HAMAS-style): review need is already carried by
    -- locator_derived_review_flags / fn_flag_derived_review(), keyed to the
    -- actual upstream edit rather than the resulting number's size. Skip
    -- the generic spike check so a legitimate large swing doesn't land in
    -- the operator-facing Pending Review queue with no indication it was
    -- machine-generated.
    IF v_is_derived THEN
      RETURN NEW;
    END IF;

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
