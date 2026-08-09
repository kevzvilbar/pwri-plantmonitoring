-- =============================================================================
-- Migration: hamas_phase15_product_meter_integrity_guard_and_mirror_trigger
-- Applied live 2026-08-09 (direct Supabase MCP access, project sosfbfxovtleuvahxvpm).
--
-- ROOT CAUSE (phase15 — a third, independent cause from phase13/14):
--   trg_product_meter_reading_integrity (BEFORE INSERT OR UPDATE ON
--   product_meter_readings, function fn_product_meter_reading_integrity) has
--   always unconditionally recomputed previous_reading/daily_volume by
--   looking up "the most recent non-retracted/non-pending_review row before
--   this one" and taking a delta — the correct model for a real cumulative
--   meter, but wrong for a mirrored is_derived meter like Mambaling's
--   "HAMAS", where current_reading already IS the period volume (phase11's
--   convention: previous_reading pinned at 0). This function never checked
--   product_meters.is_derived, so it silently overwrote whatever a correct
--   writer (fn_sweep_derived_meters_for_date's mirror loop, or the frontend's
--   syncDerivedLocatorMirrors()) had just set, replacing it with a bogus
--   delta against an unrelated old reading.
--
--   This is the same class of bug phase5/6/7/9/10 already fixed on the
--   *locator_readings* side (fn_locator_reading_integrity /
--   fn_sync_locator_reading_chain) — it was simply never mirrored onto the
--   analogous product_meter_readings-side trigger, so the exact same failure
--   mode was reintroduced one table over.
--
--   Symptom observed live: Mambaling's HAMAS history showed 0 m³ for most of
--   the last 30 days and small-but-wrong values (949, 306) for the two most
--   recent days, while SRP's HAMAS was fully correct throughout — because the
--   locator side (fixed in the earlier live session, 2026-08-01) was never
--   touched by this bug, only the mirror side was.
--
--   Consequence for phase13/14: both of those migrations are pure data
--   repairs — their UPDATE/INSERT statements go through this same trigger.
--   Even if run, this trigger would have re-corrupted the very rows they
--   just repaired in the same statement. phase15 is the reason phase13/14
--   can actually hold.
--
-- FIX PART 1 — fn_product_meter_reading_integrity gets an is_derived guard,
--   mirroring the pattern already used in fn_locator_reading_integrity: for
--   a derived (mirrored) product meter, previous_reading/daily_volume/
--   norm_status are left exactly as the caller set them. A mirror row is
--   never independently "recorded," so it doesn't need — and must not get —
--   its own delta/spike computation; correctness lives entirely upstream in
--   the source locator, which already has its own integrity checks.
--
-- FIX PART 2 — new trigger trg_sync_derived_locator_mirror on
--   locator_readings (AFTER INSERT OR UPDATE OR DELETE), scoped to
--   is_derived locators. Whatever locator_readings ends up with for a given
--   Asia/Manila calendar day — sweep-computed or manually overridden via
--   DerivedMeterOverrideDialog / the CSV bulk-override path — is copied
--   verbatim to every linked product_meters mirror (derived_from_locator_id)
--   for that same day; a delete on the source removes the mirror row too.
--   This makes "HAMAS (SRP) = HAMAS (Mambaling), always" a database-level
--   invariant instead of something each call site has to remember to do.
--
--   This is a deliberate belt-and-suspenders alongside the frontend's own
--   syncDerivedLocatorMirrors() (LocatorSection.tsx, merged same day in
--   correction-fixes-v2.patch): that call only fires from saveOverride() /
--   insertDerivedOverrideRows(), so it can't catch a delete (the History
--   dialog's row-level "X" delete has never called it) or any future write
--   path that forgets to call it. mirror is_estimated is hardcoded true
--   either way — a mirror row is never itself "directly recorded," matching
--   the convention already used by both fn_sweep_derived_meters_for_date and
--   syncDerivedLocatorMirrors.
--
-- DATA REPAIR: performed live for all ~222 days of HAMAS history plus
--   today, using locator_readings as ground truth (re-verified against the
--   screenshots: SRP and Mambaling now match exactly, day for day). Not
--   repeated as a DO block here — phase13/14 already carry that exact
--   repair and are idempotent, so running them after this migration is a
--   safe no-op / confirmation pass, not a second repair.
--
--   One pre-existing, untouched oddity found and *not* repaired here:
--   product_meter_readings has one row for meter b5546271-4302-46c4-aaf4-
--   c495ef96d448 (Mambaling HAMAS) dated 2026-07-01 (current_reading
--   2,721,182.44 — a stale cumulative-style value, daily_volume 4,654) with
--   no corresponding locator_readings row on the SRP side at all. Flagged
--   for Kevz rather than deleted, since it predates the mirror-link backfill
--   and its correct disposition (delete vs. backfill a real SRP value for
--   that date) isn't determinable from data alone.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading  NUMERIC;
  v_prev_dt       TIMESTAMPTZ;
  v_computed_vol  NUMERIC;
  v_flow_rate     NUMERIC;
  v_avg_flow_rate NUMERIC;
  v_is_derived    BOOLEAN;
BEGIN
  SELECT is_derived INTO v_is_derived
  FROM   product_meters
  WHERE  id = NEW.meter_id;

  IF COALESCE(v_is_derived, FALSE) THEN
    RETURN NEW;
  END IF;

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   product_meter_readings
  WHERE  meter_id  = NEW.meter_id
    AND  plant_id  = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := GREATEST(0, NEW.current_reading - COALESCE(v_prev_reading, 0));
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    DECLARE v_hrs NUMERIC := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;
    BEGIN
      IF v_hrs > 0 THEN
        v_flow_rate := v_computed_vol / v_hrs;
        SELECT AVG(sub.fr) INTO v_avg_flow_rate FROM (
          SELECT (current_reading - previous_reading)
                 / NULLIF(EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0, 0) AS fr
          FROM   product_meter_readings
          WHERE  meter_id = NEW.meter_id AND plant_id = NEW.plant_id
            AND  norm_status = 'normal'
            AND  reading_datetime >= NOW() - INTERVAL '7 days'
            AND  reading_datetime < NEW.reading_datetime
            AND  previous_reading IS NOT NULL
            AND  current_reading  > previous_reading
        ) sub WHERE sub.fr > 0;

        IF v_avg_flow_rate IS NOT NULL AND v_flow_rate > v_avg_flow_rate * 2.0 AND NEW.norm_status = 'normal' THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_derived_locator_mirror()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locator_id  uuid := COALESCE(NEW.locator_id, OLD.locator_id);
  v_is_derived  boolean;
  v_day         date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_reading_dt  timestamptz;
  v_mirror      RECORD;
  v_mirror_id   uuid;
BEGIN
  SELECT is_derived INTO v_is_derived FROM public.locators WHERE id = v_locator_id;
  IF NOT COALESCE(v_is_derived, FALSE) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_day        := (COALESCE(NEW.reading_datetime, OLD.reading_datetime) AT TIME ZONE 'Asia/Manila')::date;
  v_day_start  := (v_day::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end    := ((v_day + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt := v_day_end - interval '1 second';

  FOR v_mirror IN
    SELECT id, plant_id FROM public.product_meters
    WHERE derived_from_locator_id = v_locator_id AND is_derived = true
  LOOP
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;
      CONTINUE;
    END IF;

    SELECT id INTO v_mirror_id
    FROM public.product_meter_readings
    WHERE meter_id = v_mirror.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_mirror_id IS NOT NULL THEN
      UPDATE public.product_meter_readings
      SET current_reading  = NEW.current_reading,
          previous_reading = 0,
          daily_volume     = NEW.current_reading,
          is_estimated     = true
      WHERE id = v_mirror_id;
    ELSE
      INSERT INTO public.product_meter_readings
        (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
      VALUES
        (v_mirror.id, v_mirror.plant_id, v_reading_dt, NEW.current_reading, 0, NEW.current_reading, true);
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_derived_locator_mirror ON public.locator_readings;
CREATE TRIGGER trg_sync_derived_locator_mirror
AFTER INSERT OR UPDATE OR DELETE ON public.locator_readings
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_derived_locator_mirror();
