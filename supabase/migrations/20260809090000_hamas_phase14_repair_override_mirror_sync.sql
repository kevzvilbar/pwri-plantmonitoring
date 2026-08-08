-- =============================================================================
-- Migration: hamas_phase14_repair_override_mirror_sync
-- Applied 2026-08-09.
--
-- ROOT CAUSE (phase14):
--   saveOverride() and insertDerivedOverrideRows() in LocatorSection.tsx only
--   ever wrote to locator_readings. When an operator overrode the derived
--   locator value (e.g. SRP's "HAMAS (Mambaling)" locator → set to 5,294),
--   the corresponding mirror product_meter_readings row (Mambaling's "HAMAS"
--   product meter) was never touched. The sweep's phase12 CONTINUE guard then
--   protects the locator row (is_estimated = false) from re-computation —
--   which is correct — but that same CONTINUE also skips the mirror update
--   for the same iteration, leaving the mirror permanently at whatever the
--   sweep last computed (e.g. 306) rather than the override value (5,294).
--   The locator and mirror stayed diverged indefinitely.
--
--   phase13 (20260808100000) addressed only the historical data at the time it
--   ran. Any override applied after phase13 ran re-introduced the divergence.
--   The matching frontend fix (saveOverride / insertDerivedOverrideRows now
--   call syncDerivedLocatorMirrors) stops future divergence. This migration
--   repairs the current divergence for all dates in locator_readings, whether
--   the value was written by the sweep (is_estimated = true) or by a human
--   override (is_estimated = false).
--
-- WHAT THIS DOES:
--   For every active derived locator:
--     For every date's locator_reading row (sweep or override):
--       Find the mirror product_meter_readings row for the same Asia/Manila
--       calendar day and update it to current_reading = daily_volume =
--       locator_reading.daily_volume. If no mirror row exists for that date,
--       insert one.
--
-- IDEMPOTENT: re-running after a full repair is a no-op (0 rows changed/inserted).
-- =============================================================================

DO $$
DECLARE
  r_loc            RECORD;
  r_lr             RECORD;
  v_mirror         RECORD;
  v_day_start      timestamptz;
  v_day_end        timestamptz;
  v_mirror_id      uuid;
  v_mirror_cur     numeric;
  v_mirror_prev    numeric;
  v_mirror_vol     numeric;
  v_checked        integer := 0;
  v_changed        integer := 0;
  v_inserted       integer := 0;
BEGIN
  FOR r_loc IN
    SELECT id, name
    FROM public.locators
    WHERE is_derived = true
      AND status = 'Active'
  LOOP
    FOR r_lr IN
      SELECT reading_datetime, daily_volume, is_estimated
      FROM public.locator_readings
      WHERE locator_id = r_loc.id
      ORDER BY reading_datetime
    LOOP
      -- Same day-window convention as fn_sweep_derived_meters_for_date:
      -- Asia/Manila calendar day boundaries.
      v_day_start := date_trunc('day', r_lr.reading_datetime AT TIME ZONE 'Asia/Manila')
                       AT TIME ZONE 'Asia/Manila';
      v_day_end   := v_day_start + interval '1 day';

      FOR v_mirror IN
        SELECT id, plant_id
        FROM public.product_meters
        WHERE derived_from_locator_id = r_loc.id
          AND is_derived = true
      LOOP
        v_checked := v_checked + 1;

        SELECT id, current_reading, previous_reading, daily_volume
          INTO v_mirror_id, v_mirror_cur, v_mirror_prev, v_mirror_vol
        FROM public.product_meter_readings
        WHERE meter_id = v_mirror.id
          AND reading_datetime >= v_day_start
          AND reading_datetime <  v_day_end
        ORDER BY reading_datetime DESC
        LIMIT 1;

        IF v_mirror_id IS NOT NULL THEN
          -- Only write if stale to keep the log noise down.
          IF v_mirror_cur  IS DISTINCT FROM r_lr.daily_volume
          OR v_mirror_prev IS DISTINCT FROM 0
          OR v_mirror_vol  IS DISTINCT FROM r_lr.daily_volume THEN
            UPDATE public.product_meter_readings
               SET current_reading  = r_lr.daily_volume,
                   previous_reading = 0,
                   daily_volume     = r_lr.daily_volume,
                   is_estimated     = true
             WHERE id = v_mirror_id;
            v_changed := v_changed + 1;
          END IF;
        ELSE
          -- Locator has a reading for this day but the mirror never got one
          -- (sweep never ran for that date at the mirror, or the row was deleted).
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime,
             current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id,
             v_day_end - interval '1 second',   -- 23:59:59 Manila, matching sweep convention
             r_lr.daily_volume, 0, r_lr.daily_volume, true);
          v_inserted := v_inserted + 1;
        END IF;

        -- Reset scalars so a zero-row SELECT on the next iteration doesn't
        -- re-use the previous iteration's values.
        v_mirror_id   := NULL;
        v_mirror_cur  := NULL;
        v_mirror_prev := NULL;
        v_mirror_vol  := NULL;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE
    'hamas_phase14: checked % mirror-day pairs, repaired % existing rows, inserted % missing rows',
    v_checked, v_changed, v_inserted;
END $$;
