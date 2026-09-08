-- =============================================================================
-- BACKFILL MIGRATION — applied live on 2026-07-29, never committed until now.
-- Recovered verbatim from supabase_migrations.schema_migrations during the
-- HAMAS all-zero-history investigation (2026-08-01/02).
--
-- Fixes fn_sweep_derived_meters_for_date()'s mirror write into
-- product_meter_readings, which left current_reading/previous_reading NULL,
-- causing fn_product_meter_reading_integrity to permanently zero
-- daily_volume for every derived-meter mirror row (e.g. Mambaling's HAMAS,
-- stuck at 0 since 2026-06-29 despite correct residuals being logged in
-- derived_meter_sweep_log). Introduces the running-cumulative model for
-- both the locator row and its mirror (v_prev_cumulative + v_residual) —
-- later found to be inconsistent with how direct-mode locators are read
-- elsewhere in the app; see phase11 for the corrected model.
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

    v_swept := v_swept || jsonb_build_object(
      'locator_id', r_loc.id, 'locator_name', r_loc.name,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;
