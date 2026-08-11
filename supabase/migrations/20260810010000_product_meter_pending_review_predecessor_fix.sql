-- =============================================================================
-- Root cause of the Parkmall "500,000+ m3/day" Data Summary / detail-chart
-- bug (reported 2026-08-10, screenshots of Dashboard "Data Summary" >
-- Production tab and the Parkmall meter detail chart).
--
-- fn_product_meter_reading_integrity's predecessor lookup excluded BOTH
-- 'retracted' and 'pending_review' rows. Once one row got flagged
-- pending_review (for any reason — even a transient one), every later
-- insert's predecessor lookup skipped over it and fell back further back
-- in time, producing an ever-larger gap that itself exceeded the 2x-average
-- spike threshold and got flagged pending_review too. Self-reinforcing,
-- no way to self-heal: five real days of Parkmall production (~1,200 m3
-- each) compounded into a single 6,270 m3 "daily" figure by day five,
-- and DataSummaryModal.tsx's computePivotFromReadingsNoCache trusts the
-- stored daily_volume directly (correctly, in general — this was a data
-- problem, not a pivot problem).
--
-- 'retracted' genuinely means "voided, don't use." A 'pending_review' row's
-- raw current_reading is still the best known real meter value and should
-- remain a valid predecessor for the next reading — only its own
-- interpretation is in question, not the reading itself. This mirrors how
-- well_readings' and locator_readings' chain-repair already work (no
-- status filtering at all in their predecessor lookups).
--
-- Companion migration 20260810020000 adds the AFTER-trigger cascade repair
-- (product_meter_readings never had one) for defense in depth against
-- out-of-order inserts/edits going forward.
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
    AND  (norm_status IS NULL OR norm_status <> 'retracted')
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

-- ── Data repair ───────────────────────────────────────────────────────────
-- Clears the false pending_review flags this cascade left on Parkmall and
-- Coke (both at Guizo — same plant, same window; Coke's inflated numbers
-- were smaller and less visually obvious but the same bug). The chain
-- cascade trigger in the companion migration must run first so
-- previous_reading/daily_volume are already correct before this clears
-- the flag; run this repair block AFTER applying 20260810020000.
--
-- UPDATE product_meter_readings
-- SET norm_status = 'normal'
-- WHERE meter_id IN (
--   (SELECT id FROM product_meters WHERE name = 'Parkmall'),
--   (SELECT id FROM product_meters WHERE name = 'Coke')
-- )
-- AND norm_status = 'pending_review'
-- AND reading_datetime >= '2026-08-06' AND reading_datetime <= '2026-08-10 23:59:59';
