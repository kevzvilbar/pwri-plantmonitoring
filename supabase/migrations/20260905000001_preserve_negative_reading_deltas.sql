-- =============================================================================
-- Migration: 20260905000001_preserve_negative_reading_deltas.sql
--
-- Unclamp negative reading deltas across all meter modules:
-- 1. locators (locator_readings.daily_volume generated column)
-- 2. wells (fn_sync_well_reading_chain)
-- 3. product meters (fn_product_meter_reading_integrity, fn_sync_product_meter_reading_chain)
-- 4. blending (blending_events rollover columns, fn_blending_set_reading, fn_sync_blending_reading_chain)
-- 5. cascade reading correction (fn_cascade_reading_correction)
--
-- Erroneous drops (current < previous) will preserve negative deltas and remain
-- flagged / quarantined for supervisor review, rather than silently clamped to 0.
-- Mechanical rollovers and meter replacements continue to be handled with their
-- true wrap arithmetic and zero-baseline transitions respectively.
-- =============================================================================

-- ── 1. LOCATORS: rebuild daily_volume generated column without GREATEST(0, ...) ─
DROP VIEW IF EXISTS public.locator_readings_latest CASCADE;

ALTER TABLE public.locator_readings DROP COLUMN IF EXISTS daily_volume;
ALTER TABLE public.locator_readings ADD COLUMN daily_volume NUMERIC GENERATED ALWAYS AS (
  CASE
    WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
    WHEN COALESCE(is_meter_rollover, FALSE) AND meter_rollover_max IS NOT NULL THEN
      GREATEST(0, (meter_rollover_max - COALESCE(previous_reading, 0)) + current_reading)
    ELSE
      current_reading - COALESCE(previous_reading, 0)
  END
) STORED;

CREATE OR REPLACE VIEW public.locator_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (locator_id) *
FROM public.locator_readings
WHERE norm_status IS NULL OR norm_status NOT IN ('retracted', 'pending_review')
ORDER BY locator_id, reading_datetime DESC;

GRANT SELECT ON public.locator_readings_latest TO authenticated, anon;

-- ── 2. WELLS: update fn_sync_well_reading_chain ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_well_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_well_id           UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_id    UUID;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_successor_repl    BOOLEAN;
  v_successor_roll    BOOLEAN;
  v_successor_rollmax NUMERIC;
  v_successor_curr    NUMERIC;
  v_new_prev          NUMERIC;
BEGIN

  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + daily_volume ──────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT id, current_reading
      INTO v_predecessor_id, v_predecessor_read
      FROM public.well_readings
     WHERE well_id          = v_well_id
       AND reading_datetime < v_reading_dt
       AND current_reading IS NOT NULL
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.well_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN COALESCE(NEW.is_meter_replacement, FALSE) THEN 0
                                WHEN COALESCE(NEW.is_meter_rollover, FALSE)
                                 AND NEW.meter_rollover_max IS NOT NULL
                                 AND v_predecessor_read IS NOT NULL
                                THEN GREATEST(0, (NEW.meter_rollover_max - v_predecessor_read) + NEW.current_reading)
                                WHEN NEW.current_reading IS NOT NULL
                                 AND v_predecessor_read IS NOT NULL
                                THEN NEW.current_reading - v_predecessor_read
                                WHEN NEW.current_reading IS NOT NULL
                                THEN NEW.current_reading
                                ELSE NULL
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), COALESCE(is_meter_rollover, FALSE), meter_rollover_max, current_reading
    INTO v_successor_id, v_successor_repl, v_successor_roll, v_successor_rollmax, v_successor_curr
    FROM public.well_readings
   WHERE well_id          = v_well_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.well_readings AS wr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_successor_roll AND v_successor_rollmax IS NOT NULL AND v_new_prev IS NOT NULL
                                THEN GREATEST(0, (v_successor_rollmax - v_new_prev) + wr.current_reading)
                                WHEN wr.current_reading IS NOT NULL
                                 AND v_new_prev IS NOT NULL
                                THEN wr.current_reading - v_new_prev
                                WHEN wr.current_reading IS NOT NULL
                                THEN wr.current_reading
                                ELSE NULL
                              END
     WHERE wr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

-- ── 3. PRODUCT METERS: unclamp daily_volume in integrity & chain triggers ─────
CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading           NUMERIC;
  v_prev_dt                TIMESTAMPTZ;
  v_computed_vol           NUMERIC;
  v_flow_rate               NUMERIC;
  v_avg_flow_rate           NUMERIC;
  v_is_derived              BOOLEAN;
  v_resolving_from_pending  BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_resolving_from_pending := (OLD.norm_status = 'pending_review');
  END IF;

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

  IF COALESCE(NEW.is_meter_replacement, FALSE) THEN
    NEW.daily_volume := 0;
  ELSIF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := NEW.current_reading - COALESCE(v_prev_reading, 0);
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_resolving_from_pending
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

        IF v_avg_flow_rate IS NOT NULL
           AND v_flow_rate > v_avg_flow_rate * 2.0
           AND NEW.norm_status = 'normal'
           AND NOT v_resolving_from_pending
        THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_product_meter_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meter_id          UUID;
  v_plant_id          UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_is_derived        BOOLEAN;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_successor_repl    BOOLEAN;
  v_successor_roll    BOOLEAN;
  v_successor_rollmax NUMERIC;
  v_new_prev          NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_meter_id   := OLD.meter_id;
    v_plant_id   := OLD.plant_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_meter_id   := NEW.meter_id;
    v_plant_id   := NEW.plant_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  SELECT is_derived INTO v_is_derived FROM public.product_meters WHERE id = v_meter_id;
  IF COALESCE(v_is_derived, FALSE) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + daily_volume ──────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT current_reading INTO v_predecessor_read
      FROM public.product_meter_readings
     WHERE meter_id         = v_meter_id
       AND plant_id         = v_plant_id
       AND reading_datetime < v_reading_dt
       AND (norm_status IS NULL OR norm_status <> 'retracted')
       AND id <> NEW.id
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.product_meter_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
                                WHEN COALESCE(is_meter_rollover, FALSE)
                                 AND meter_rollover_max IS NOT NULL
                                 AND v_predecessor_read IS NOT NULL
                                THEN GREATEST(0, meter_rollover_max - v_predecessor_read + current_reading)
                                ELSE current_reading - COALESCE(v_predecessor_read, 0)
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), COALESCE(is_meter_rollover, FALSE), meter_rollover_max
    INTO v_successor_id, v_successor_repl, v_successor_roll, v_successor_rollmax
    FROM public.product_meter_readings
   WHERE meter_id         = v_meter_id
     AND plant_id         = v_plant_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.product_meter_readings AS pmr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_successor_roll AND v_successor_rollmax IS NOT NULL AND v_new_prev IS NOT NULL
                                THEN GREATEST(0, v_successor_rollmax - v_new_prev + pmr.current_reading)
                                ELSE pmr.current_reading - COALESCE(v_new_prev, 0)
                              END
     WHERE pmr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

-- ── 4. BLENDING: add rollover columns & unclamp volume_m3 in triggers ─────────
ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

CREATE OR REPLACE FUNCTION public.fn_blending_set_reading()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_meter_reading IS NULL THEN
    RAISE EXCEPTION 'blending_events.raw_meter_reading is required — blending wells are meter-fed, direct volume entry is not supported';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.previous_reading IS NULL THEN
    SELECT raw_meter_reading INTO NEW.previous_reading
    FROM public.blending_events
    WHERE well_id = NEW.well_id
      AND id <> NEW.id
      AND (event_date < NEW.event_date
           OR (event_date = NEW.event_date AND reading_datetime IS NOT NULL
               AND NEW.reading_datetime IS NOT NULL AND reading_datetime < NEW.reading_datetime))
    ORDER BY event_date DESC, reading_datetime DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF NEW.is_meter_replacement THEN
    NEW.volume_m3 := 0;
  ELSIF NEW.is_meter_rollover AND NEW.meter_rollover_max IS NOT NULL AND NEW.previous_reading IS NOT NULL THEN
    NEW.volume_m3 := GREATEST(0, (NEW.meter_rollover_max - NEW.previous_reading) + NEW.raw_meter_reading);
  ELSIF NEW.previous_reading IS NULL THEN
    NEW.volume_m3 := 0;
  ELSE
    -- Unclamped: preserve negative delta so drops are immediately visible in red
    NEW.volume_m3 := NEW.raw_meter_reading - NEW.previous_reading;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_blending_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_well_id           UUID;
  v_event_date        DATE;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor       NUMERIC;
  v_successor_id      UUID;
  v_successor_repl    BOOLEAN;
  v_successor_roll    BOOLEAN;
  v_successor_rollmax NUMERIC;
  v_successor_raw     NUMERIC;
  v_new_prev          NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_event_date := OLD.event_date;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_event_date := NEW.event_date;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + volume_m3 ─────────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT raw_meter_reading INTO v_predecessor
      FROM public.blending_events
     WHERE well_id = v_well_id
       AND id <> NEW.id
       AND (event_date < v_event_date
            OR (event_date = v_event_date AND reading_datetime IS NOT NULL
                AND v_reading_dt IS NOT NULL AND reading_datetime < v_reading_dt))
     ORDER BY event_date DESC, reading_datetime DESC NULLS LAST
     LIMIT 1;

    UPDATE public.blending_events
       SET previous_reading = v_predecessor,
           volume_m3        = CASE
                                WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
                                WHEN COALESCE(is_meter_rollover, FALSE)
                                 AND meter_rollover_max IS NOT NULL
                                 AND v_predecessor IS NOT NULL
                                THEN GREATEST(0, (meter_rollover_max - v_predecessor) + raw_meter_reading)
                                WHEN v_predecessor IS NULL THEN 0
                                ELSE raw_meter_reading - v_predecessor
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), COALESCE(is_meter_rollover, FALSE), meter_rollover_max, raw_meter_reading
    INTO v_successor_id, v_successor_repl, v_successor_roll, v_successor_rollmax, v_successor_raw
    FROM public.blending_events
   WHERE well_id = v_well_id
     AND (event_date > v_event_date
          OR (event_date = v_event_date AND reading_datetime IS NOT NULL
              AND v_reading_dt IS NOT NULL AND reading_datetime > v_reading_dt))
   ORDER BY event_date ASC, reading_datetime ASC NULLS LAST
   LIMIT 1;

  IF v_successor_id IS NOT NULL AND v_successor_raw IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.raw_meter_reading;
    END IF;

    UPDATE public.blending_events AS be
       SET previous_reading = v_new_prev,
           volume_m3        = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_successor_roll AND v_successor_rollmax IS NOT NULL AND v_new_prev IS NOT NULL
                                THEN GREATEST(0, (v_successor_rollmax - v_new_prev) + be.raw_meter_reading)
                                WHEN v_new_prev IS NULL THEN 0
                                ELSE be.raw_meter_reading - v_new_prev
                              END
     WHERE be.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

-- ── 5. CASCADE CORRECTIONS: unclamp v_new_daily_vol and v_iter_daily_vol ─────
CREATE OR REPLACE FUNCTION public.fn_cascade_reading_correction(
  p_table       TEXT,
  p_row_id      UUID,
  p_new_current NUMERIC,
  p_admin_id    UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_col      TEXT;
  v_has_stored_vol  BOOLEAN;
  v_old_current     NUMERIC;
  v_prev_reading    NUMERIC;
  v_entity_id       UUID;
  v_reading_dt      TIMESTAMPTZ;
  v_new_daily_vol   NUMERIC;
  v_role            TEXT;

  -- Walk state for the recursive downstream repair.
  v_cursor_current  NUMERIC;      -- the "true" current_reading to propagate forward
  v_cursor_dt       TIMESTAMPTZ;  -- reading_datetime of the row we just fixed
  v_iter_id         UUID;
  v_iter_prev       NUMERIC;
  v_iter_current    NUMERIC;
  v_iter_dt         TIMESTAMPTZ;
  v_iter_rollover   BOOLEAN;
  v_iter_max        NUMERIC;
  v_iter_daily_vol  NUMERIC;
  v_cascade_ids     UUID[] := ARRAY[]::UUID[];
  v_hops            INT := 0;
  v_max_hops        CONSTANT INT := 500;  -- safety cap against runaway loops on corrupt data
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'Admin')
    OR public.has_role(auth.uid(), 'Data Analyst')
    OR public.has_role(auth.uid(), 'Manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to correct readings';
  END IF;

  IF p_table NOT IN ('locator_readings', 'well_readings', 'product_meter_readings', 'ro_train_readings') THEN
    RAISE EXCEPTION 'Unknown source table: %', p_table;
  END IF;

  IF p_table = 'ro_train_readings' THEN
    RAISE EXCEPTION 'ro_train_readings does not use the single-value cascade correction model';
  END IF;

  v_entity_col := CASE p_table
    WHEN 'locator_readings' THEN 'locator_id'
    WHEN 'well_readings' THEN 'well_id'
    WHEN 'product_meter_readings' THEN 'meter_id'
  END;

  v_has_stored_vol := (p_table <> 'locator_readings');

  EXECUTE format(
    'SELECT current_reading, previous_reading, reading_datetime, %I FROM %I WHERE id = $1',
    v_entity_col, p_table
  ) INTO v_old_current, v_prev_reading, v_reading_dt, v_entity_id
  USING p_row_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reading % not found in %', p_row_id, p_table;
  END IF;

  IF v_has_stored_vol THEN
    -- Unclamped: allow negative volume if new current reading is below previous
    v_new_daily_vol := p_new_current - COALESCE(v_prev_reading, 0);
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, daily_volume = $2, norm_status = ''normalized'' WHERE id = $3',
      p_table
    ) USING p_new_current, v_new_daily_vol, p_row_id;
  ELSE
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, norm_status = ''normalized'' WHERE id = $2',
      p_table
    ) USING p_new_current, p_row_id;
  END IF;

  -- ── Recursive cascade ────────────────────────────────────────────────────
  v_cursor_current := p_new_current;
  v_cursor_dt := v_reading_dt;

  LOOP
    v_hops := v_hops + 1;
    EXIT WHEN v_hops > v_max_hops;

    EXECUTE format(
      'SELECT id, previous_reading, current_reading, reading_datetime, is_meter_rollover, meter_rollover_max
         FROM %I WHERE %I = $1 AND reading_datetime > $2 ORDER BY reading_datetime ASC LIMIT 1',
      p_table, v_entity_col
    ) INTO v_iter_id, v_iter_prev, v_iter_current, v_iter_dt, v_iter_rollover, v_iter_max
    USING v_entity_id, v_cursor_dt;

    EXIT WHEN v_iter_id IS NULL;

    EXIT WHEN v_iter_prev IS NOT DISTINCT FROM v_cursor_current;

    IF v_has_stored_vol THEN
      IF v_iter_rollover AND v_iter_max IS NOT NULL THEN
        v_iter_daily_vol := GREATEST(0, (v_iter_max - v_cursor_current) + v_iter_current);
      ELSE
        -- Unclamped: allow negative volume on downstream links
        v_iter_daily_vol := v_iter_current - v_cursor_current;
      END IF;
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = $2 WHERE id = $3',
        p_table
      ) USING v_cursor_current, v_iter_daily_vol, v_iter_id;
    ELSE
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING v_cursor_current, v_iter_id;
    END IF;

    v_cascade_ids := array_append(v_cascade_ids, v_iter_id);

    v_cursor_current := v_iter_current;
    v_cursor_dt := v_iter_dt;
  END LOOP;

  SELECT role INTO v_role FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Data Analyst' THEN 2 WHEN 'Manager' THEN 3 ELSE 4 END
    LIMIT 1;

  INSERT INTO public.reading_normalizations (
    source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role
  ) VALUES (
    p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason,
    COALESCE(auth.uid(), p_admin_id), COALESCE(v_role, 'Admin')
  );

  RETURN jsonb_build_object(
    'success', true,
    'old_value', v_old_current,
    'new_value', p_new_current,
    'table', p_table,
    'id', p_row_id,
    'cascaded_hops', v_hops - 1,
    'cascaded_ids', v_cascade_ids
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
