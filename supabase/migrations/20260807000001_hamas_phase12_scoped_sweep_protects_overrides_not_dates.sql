-- =============================================================================
-- Migration: hamas_phase12_scoped_sweep_protects_overrides_not_dates
-- Applied 2026-08-07, found while re-investigating SRP↔Mambaling HAMAS still
-- reading 0 for every day after 2026-08-01 despite the phase9-11 fixes.
--
-- ROOT CAUSE:
--   Phase 7's freshness gate is:
--     IF p_date <> v_today AND NOT EXISTS (open review flag for this date)
--       THEN CONTINUE (skip, leave untouched)
--   i.e. it only ever writes a value for TODAY, or for a past date that has
--   an explicit open review flag. Every other past date is permanently
--   frozen at whatever it last held (0, if it was never swept).
--
--   But .github/workflows/derived-meter-sweep.yml — the routine 3x/day
--   cron — is deliberately written to target YESTERDAY (p_date defaults to
--   "yesterday PHT"; see its own header comment: "a sibling correction made
--   during the day shows up in Hamas within 8h"). Yesterday is, by
--   definition, never v_today. So every scheduled run's whole 3-day
--   lookback window (yesterday-2 .. yesterday) hits the gate and gets
--   skipped, every single time — and fn_sweep_derived_meters() still
--   returns {"ok": true}, so the workflow shows green in GitHub Actions
--   while silently doing nothing. This is why HAMAS goes 0 the moment
--   nobody manually intervenes.
--
--   The only path that ever produced a real value was the "Recalculate now"
--   button (LocatorSection.tsx), which passes p_date = today explicitly —
--   but per this same file's phase 2026-07-26 comment, a day's residual is
--   only accurate once that day has *closed* (mother meter + all siblings
--   read for the full day). Recalculating "today" mid-day computes off an
--   incomplete day and, per the note above, that date can then never be
--   corrected later by the routine sweep once the day *does* close —
--   because by then it's no longer "today" and gets skipped.
--
-- FIX:
--   The gate's real intent (see phase7/phase3's own comments) was "don't
--   let a routine re-sweep silently clobber a value a human set on
--   purpose." That's exactly what is_estimated already encodes: sweep
--   writes always set is_estimated = true; every override path
--   (DerivedMeterOverrideDialog's saveOverride, the CSV bulk-override
--   insertDerivedOverrideRows) always sets is_estimated = false. So: skip
--   a (locator, date) pair only if it already holds a human-set
--   (is_estimated = false) value AND nothing has flagged it for review
--   since. Drop the "date must equal today" condition entirely — a date
--   that's never been swept, or one the sweep itself last wrote, is always
--   fair game for the routine catch-up pass, whether that's today or any
--   day in the lookback window. This also means an override made *today*
--   is now protected the same way a past-date override already was
--   (previously it wasn't, since the old gate always fell through for
--   p_date = today regardless of override status).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters_for_date(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day_start       timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end         timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt      timestamptz := v_day_end - interval '1 second';

  r_loc             RECORD;
  v_mother_vol      numeric;
  v_others_vol      numeric;
  v_residual        numeric;
  v_has_override    boolean;

  v_lr_id           uuid;
  v_old_daily_vol   numeric;
  v_changed         boolean;

  v_mirror                  RECORD;
  v_mirror_id               uuid;
  v_first_mirror_id         uuid;

  v_swept           jsonb := '[]'::jsonb;
  v_skipped         jsonb := '[]'::jsonb;
BEGIN
  FOR r_loc IN
    SELECT id, name, plant_id, product_meter_id, derived_from_meter_id
    FROM public.locators
    WHERE is_derived = true
      AND derived_from_meter_id IS NOT NULL
      AND status = 'Active'
  LOOP
    -- Protect a human-set value (is_estimated = false), not a calendar date.
    -- A date the sweep has never touched, or one it last wrote itself
    -- (is_estimated = true), is always eligible for (re)computation.
    SELECT EXISTS (
      SELECT 1 FROM public.locator_readings
       WHERE locator_id = r_loc.id
         AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
         AND is_estimated = false
    ) INTO v_has_override;

    IF v_has_override AND NOT EXISTS (
      SELECT 1 FROM public.locator_derived_review_flags
       WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'manually overridden and no open review flag for this date — left untouched'
      );
      CONTINUE;
    END IF;

    SELECT SUM(COALESCE(daily_volume, 0)) INTO v_mother_vol
    FROM public.product_meter_readings
    WHERE meter_id = r_loc.derived_from_meter_id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;

    IF v_mother_vol IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'mother meter has no reading for this date'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN lr.previous_reading IS NULL THEN 0
        WHEN sib.default_input_mode = 'direct' THEN GREATEST(0, lr.current_reading)
        ELSE GREATEST(0, lr.current_reading - lr.previous_reading)
      END
    ), 0) INTO v_others_vol
    FROM public.locator_readings lr
    JOIN public.locators sib ON sib.id = lr.locator_id
    WHERE sib.product_meter_id = r_loc.derived_from_meter_id
      AND sib.is_derived = false
      AND lr.reading_datetime >= v_day_start AND lr.reading_datetime < v_day_end;

    v_residual := GREATEST(0, v_mother_vol - v_others_vol);

    SELECT id, daily_volume INTO v_lr_id, v_old_daily_vol
    FROM public.locator_readings
    WHERE locator_id = r_loc.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_lr_id IS NOT NULL THEN
      UPDATE public.locator_readings
      SET current_reading = v_residual, previous_reading = 0, is_estimated = true
      WHERE id = v_lr_id;
      v_changed := (v_old_daily_vol IS DISTINCT FROM v_residual);
    ELSE
      INSERT INTO public.locator_readings
        (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
      VALUES
        (r_loc.id, r_loc.plant_id, v_reading_dt, v_residual, 0, true)
      RETURNING id INTO v_lr_id;
      v_old_daily_vol := NULL;
      v_changed := true;
    END IF;

    v_first_mirror_id := NULL;
    FOR v_mirror IN
      SELECT id, plant_id FROM public.product_meters
      WHERE derived_from_locator_id = r_loc.id AND is_derived = true
    LOOP
      IF v_first_mirror_id IS NULL THEN v_first_mirror_id := v_mirror.id; END IF;

      SELECT id INTO v_mirror_id
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
      ORDER BY reading_datetime DESC LIMIT 1;

      IF v_mirror_id IS NOT NULL THEN
        UPDATE public.product_meter_readings
        SET current_reading  = v_residual,
            previous_reading = 0,
            daily_volume     = v_residual,
            is_estimated     = true
        WHERE id = v_mirror_id;
      ELSE
        INSERT INTO public.product_meter_readings
          (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
        VALUES
          (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_residual, 0, v_residual, true);
      END IF;
    END LOOP;

    INSERT INTO public.derived_meter_sweep_log
      (locator_id, date_key, old_value, new_value, changed, mirror_meter_id)
    VALUES
      (r_loc.id, p_date, v_old_daily_vol, v_residual, v_changed, v_first_mirror_id);

    UPDATE public.locator_derived_review_flags
    SET resolved_at = now()
    WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL;

    v_swept := v_swept || jsonb_build_object(
      'locator_id', r_loc.id, 'locator_name', r_loc.name,
      'mother_vol', v_mother_vol, 'others_vol', v_others_vol,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;
