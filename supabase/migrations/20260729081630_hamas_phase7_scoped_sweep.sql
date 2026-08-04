-- =============================================================================
-- BACKFILL MIGRATION — applied live on 2026-07-29, never committed until now.
-- Recovered verbatim from supabase_migrations.schema_migrations during the
-- HAMAS all-zero-history investigation (2026-08-01/02).
--
-- Scopes fn_sweep_derived_meters_for_date() to only touch a (locator, date)
-- pair that's either today or has an open review flag
-- (locator_derived_review_flags) for that date, so a manual override on any
-- other date is never silently overwritten just because the routine sweep
-- ran again. Also (re)introduces fn_sweep_derived_meters(p_date,
-- p_lookback_days) as a thin dispatcher: sweeps the normal lookback window
-- day-by-day, then works through any additional flagged dates outside that
-- window (capped at 90 per call).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters_for_date(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today           date        := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_day_start       timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end         timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt      timestamptz := v_day_end - interval '1 second';

  r_loc             RECORD;
  v_mother_vol      numeric;
  v_others_vol      numeric;
  v_residual        numeric;
  v_prev_cumulative numeric;
  v_new_current     numeric;

  v_lr_id           uuid;
  v_old_daily_vol   numeric;
  v_changed         boolean;

  v_mirror                  RECORD;
  v_mirror_id               uuid;
  v_first_mirror_id         uuid;
  v_mirror_prev_cumulative  numeric;
  v_mirror_new_current      numeric;

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
    IF p_date <> v_today AND NOT EXISTS (
      SELECT 1 FROM public.locator_derived_review_flags
       WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'not today and no open review flag for this date — left untouched'
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

    SELECT COALESCE(SUM(COALESCE(lr.daily_volume, 0)), 0) INTO v_others_vol
    FROM public.locator_readings lr
    JOIN public.locators sib ON sib.id = lr.locator_id
    WHERE sib.product_meter_id = r_loc.derived_from_meter_id
      AND sib.is_derived = false
      AND lr.reading_datetime >= v_day_start AND lr.reading_datetime < v_day_end;

    v_residual := GREATEST(0, v_mother_vol - v_others_vol);

    SELECT current_reading INTO v_prev_cumulative
    FROM public.locator_readings
    WHERE locator_id = r_loc.id AND reading_datetime < v_day_start
    ORDER BY reading_datetime DESC LIMIT 1;
    v_prev_cumulative := COALESCE(v_prev_cumulative, 0);
    v_new_current := v_prev_cumulative + v_residual;

    SELECT id, daily_volume INTO v_lr_id, v_old_daily_vol
    FROM public.locator_readings
    WHERE locator_id = r_loc.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_lr_id IS NOT NULL THEN
      UPDATE public.locator_readings
      SET current_reading = v_new_current, previous_reading = v_prev_cumulative, is_estimated = true
      WHERE id = v_lr_id;
      v_changed := (v_old_daily_vol IS DISTINCT FROM v_residual);
    ELSE
      INSERT INTO public.locator_readings
        (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
      VALUES
        (r_loc.id, r_loc.plant_id, v_reading_dt, v_new_current, v_prev_cumulative, true)
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

      SELECT current_reading INTO v_mirror_prev_cumulative
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND norm_status NOT IN ('retracted', 'pending_review')
        AND reading_datetime < v_day_start
      ORDER BY reading_datetime DESC LIMIT 1;
      v_mirror_prev_cumulative := COALESCE(v_mirror_prev_cumulative, 0);
      v_mirror_new_current := v_mirror_prev_cumulative + v_residual;

      SELECT id INTO v_mirror_id
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
      ORDER BY reading_datetime DESC LIMIT 1;

      IF v_mirror_id IS NOT NULL THEN
        UPDATE public.product_meter_readings
        SET current_reading  = v_mirror_new_current,
            previous_reading = v_mirror_prev_cumulative,
            daily_volume     = v_residual,
            is_estimated     = true
        WHERE id = v_mirror_id;
      ELSE
        INSERT INTO public.product_meter_readings
          (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
        VALUES
          (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_mirror_new_current, v_mirror_prev_cumulative, v_residual, true);
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
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters(p_date date DEFAULT NULL::date, p_lookback_days integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_end_date   date    := COALESCE(p_date, ((now() AT TIME ZONE 'Asia/Manila')::date - 1));
  v_lookback   integer := LEAST(GREATEST(COALESCE(p_lookback_days, 1), 1), 30);
  v_start_date date    := v_end_date - (v_lookback - 1);
  v_cursor     date    := v_start_date;
  v_days       jsonb   := '[]'::jsonb;
  v_flagged    date;
  v_extra      integer := 0;
BEGIN
  WHILE v_cursor <= v_end_date LOOP
    v_days := v_days || public.fn_sweep_derived_meters_for_date(v_cursor);
    v_cursor := v_cursor + 1;
  END LOOP;

  FOR v_flagged IN
    SELECT DISTINCT date_key FROM public.locator_derived_review_flags
     WHERE resolved_at IS NULL
       AND date_key NOT BETWEEN v_start_date AND v_end_date
     ORDER BY date_key
     LIMIT 90
  LOOP
    v_days := v_days || public.fn_sweep_derived_meters_for_date(v_flagged);
    v_extra := v_extra + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'from', v_start_date,
    'to', v_end_date,
    'extra_flagged_dates_swept', v_extra,
    'finished_at', now(),
    'days', v_days
  );
END;
$function$;
