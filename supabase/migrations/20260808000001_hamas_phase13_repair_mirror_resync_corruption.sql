-- =============================================================================
-- Migration: hamas_phase13_repair_mirror_resync_corruption
-- Applied 2026-08-08.
--
-- ROOT CAUSE (frontend — not covered by phases 0-12, which were all
-- backend/SQL):
--   ProductSection.tsx's ProductMeterHistoryDialog has a client-side
--   resyncMeterChain() helper that walks every product_meter_readings row
--   for a meter in chronological order and recomputes:
--     previous_reading = the PRIOR row's raw current_reading
--     daily_volume      = GREATEST(0, current_reading - previous_reading)
--   That's the right model for a normal, monotonically-increasing cumulative
--   meter, but is_derived (mirrored) meters — e.g. Mambaling's "HAMAS",
--   mirrored from SRP's derived "HAMAS (Mambaling)" locator — don't work
--   that way: fn_sweep_derived_meters_for_date() (phase11/phase12) writes
--   each day's own volume directly into current_reading and pins
--   previous_reading at 0, so consecutive rows are independent, not
--   cumulative. resyncMeterChain never checked meter.is_derived, so any
--   edit, delete, or "mark as meter replacement" toggle on this dialog
--   re-walked the whole history as if it were cumulative and clobbered
--   daily_volume back down to ~0 for nearly every day — while SRP's own
--   derived locator kept computing correctly the whole time, because
--   locator_readings.daily_volume is a GENERATED column resyncMeterChain
--   never touches. This is why HAMAS (SRP) and HAMAS (Mambaling) diverged:
--   the sweep's mirror write was always correct, this resync silently
--   overwrote it afterwards. The matching frontend fix guards
--   resyncMeterChain (and saveEdit) against is_derived meters so this can't
--   recur.
--
-- FIX (this migration):
--   One-time data repair, not a new code path. For every is_derived locator,
--   re-derive its mirror product_meter_readings rows directly from the
--   (never-corrupted) locator_readings rows, matched by calendar day in
--   Asia/Manila. This is a straight copy, not a recompute — it's guaranteed
--   to leave every mirror row exactly equal to its source locator for every
--   day that's ever been swept, which is the whole point of the mirror
--   (HAMAS (SRP) = HAMAS (Mambaling)).
--
-- Idempotent: only writes a row when its stored values actually differ from
-- the source locator's; re-running after a successful repair is a no-op and
-- reports 0 rows changed.
-- =============================================================================

DO $$
DECLARE
  r_loc          RECORD;
  r_lr           RECORD;
  v_mirror       RECORD;
  v_day_start    timestamptz;
  v_day_end      timestamptz;
  -- Scalar (not RECORD) OUT targets for the existence-check SELECT below —
  -- a bare RECORD variable that's never yet been assigned a row raises
  -- "record ... is not assigned yet" the first time a zero-row SELECT INTO
  -- hits it, which a plain first lookup easily could. Scalars just come back
  -- NULL, no gotcha, matching how phase12's fn_sweep_derived_meters_for_date
  -- already does this same existence check (v_lr_id / v_old_daily_vol).
  v_mirror_id        uuid;
  v_mirror_cur       numeric;
  v_mirror_prev      numeric;
  v_mirror_vol       numeric;
  v_mirror_estimated boolean;
  v_checked      integer := 0;
  v_changed      integer := 0;
  v_inserted     integer := 0;
BEGIN
  FOR r_loc IN
    SELECT id, name FROM public.locators WHERE is_derived = true
  LOOP
    FOR r_lr IN
      SELECT reading_datetime, daily_volume, is_estimated
      FROM public.locator_readings
      WHERE locator_id = r_loc.id
      ORDER BY reading_datetime
    LOOP
      -- Calendar-day bounds in Asia/Manila, same convention
      -- fn_sweep_derived_meters_for_date() uses for v_day_start/v_day_end.
      v_day_start := date_trunc('day', r_lr.reading_datetime AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila';
      v_day_end   := v_day_start + interval '1 day';

      FOR v_mirror IN
        SELECT id, plant_id FROM public.product_meters
        WHERE derived_from_locator_id = r_loc.id AND is_derived = true
      LOOP
        v_checked := v_checked + 1;

        SELECT id, current_reading, previous_reading, daily_volume, is_estimated
          INTO v_mirror_id, v_mirror_cur, v_mirror_prev, v_mirror_vol, v_mirror_estimated
        FROM public.product_meter_readings
        WHERE meter_id = v_mirror.id
          AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
        ORDER BY reading_datetime DESC LIMIT 1;

        IF v_mirror_id IS NOT NULL THEN
          IF v_mirror_cur  IS DISTINCT FROM r_lr.daily_volume
          OR v_mirror_prev IS DISTINCT FROM 0
          OR v_mirror_vol  IS DISTINCT FROM r_lr.daily_volume THEN
            UPDATE public.product_meter_readings
            SET current_reading  = r_lr.daily_volume,
                previous_reading = 0,
                daily_volume     = r_lr.daily_volume,
                is_estimated     = r_lr.is_estimated
            WHERE id = v_mirror_id;
            v_changed := v_changed + 1;
          END IF;
        ELSE
          -- Source locator has a reading for this day but the mirror never
          -- got one at all (e.g. the derived_from_locator_id link was added
          -- after that day's sweep, or the row was deleted outright).
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id, r_lr.reading_datetime, r_lr.daily_volume, 0, r_lr.daily_volume, r_lr.is_estimated);
          v_inserted := v_inserted + 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'hamas_phase13: checked % mirror-day pairs, repaired % existing rows, inserted % missing rows',
    v_checked, v_changed, v_inserted;
END $$;
