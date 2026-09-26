-- Meter Multiplier Feature: Locators, Wells, and Product ("Mother") Meters
-- 
-- 1. Adds meter_multiplier and multiplier_enabled to meter entities (locators, wells, product_meters).
-- 2. Adds multiplier_at_reading to reading snapshot rows (locator_readings, well_readings, product_meter_readings).
-- 3. Creates public.meter_events audit table for physical replacements and multiplier cutovers.
-- 4. Updates integrity, daily_volume, and chain-sync triggers to factor in multiplier_at_reading and respect reset boundaries.

-- ── 1. Entity and Reading Column Additions ────────────────────────────────────

ALTER TABLE public.locators 
  ADD COLUMN IF NOT EXISTS meter_multiplier numeric DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS multiplier_enabled boolean DEFAULT false NOT NULL;

ALTER TABLE public.wells 
  ADD COLUMN IF NOT EXISTS meter_multiplier numeric DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS multiplier_enabled boolean DEFAULT false NOT NULL;

ALTER TABLE public.product_meters 
  ADD COLUMN IF NOT EXISTS meter_multiplier numeric DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS multiplier_enabled boolean DEFAULT false NOT NULL;

ALTER TABLE public.locator_readings 
  ADD COLUMN IF NOT EXISTS multiplier_at_reading numeric DEFAULT 1 NOT NULL;

ALTER TABLE public.well_readings 
  ADD COLUMN IF NOT EXISTS multiplier_at_reading numeric DEFAULT 1 NOT NULL;

ALTER TABLE public.product_meter_readings 
  ADD COLUMN IF NOT EXISTS multiplier_at_reading numeric DEFAULT 1 NOT NULL;

-- ── 2. Meter Events Table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meter_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text NOT NULL CHECK (entity_type IN ('locator', 'well', 'product')),
    entity_id uuid NOT NULL,
    plant_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('physical_replacement', 'multiplier_cutover')),
    effective_at timestamptz NOT NULL DEFAULT now(),
    old_reading_value numeric,
    old_reading_convention text CHECK (old_reading_convention IS NULL OR old_reading_convention IN ('raw', 'pre_multiplied')),
    old_meter_serial text,
    new_reading_value numeric,
    new_multiplier numeric NOT NULL DEFAULT 1,
    new_multiplier_enabled boolean NOT NULL DEFAULT false,
    new_meter_serial text,
    performed_by uuid REFERENCES public.user_profiles(id),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meter_events_entity ON public.meter_events (entity_type, entity_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS idx_meter_events_plant ON public.meter_events (plant_id, effective_at DESC);

ALTER TABLE public.meter_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'meter_events' AND policyname = 'meter_events_select_auth'
  ) THEN
    CREATE POLICY "meter_events_select_auth"
      ON public.meter_events FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'meter_events' AND policyname = 'meter_events_insert_manager_admin_analyst'
  ) THEN
    CREATE POLICY "meter_events_insert_manager_admin_analyst"
      ON public.meter_events FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() IS NOT NULL AND (
          public.is_manager_or_admin(auth.uid()) OR
          public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
        )
      );
  END IF;
END $$;

-- ── 3. Locator Reading Triggers ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_prev_reading       NUMERIC;
  v_prev_dt            TIMESTAMPTZ;
  v_computed_vol       NUMERIC;
  v_hours_elapsed      NUMERIC;
  v_flow_rate          NUMERIC;
  v_avg_flow_rate      NUMERIC;
  v_input_mode         TEXT;
  v_is_derived         BOOLEAN;
  v_reviewer_resolving BOOLEAN;
  v_mult               NUMERIC;
BEGIN
  v_reviewer_resolving := (
    TG_OP = 'UPDATE'
    AND OLD.norm_status = 'pending_review'
    AND NEW.norm_status = 'normal'
    AND OLD.current_reading = NEW.current_reading
  );

  SELECT default_input_mode, is_derived, meter_multiplier, multiplier_enabled
  INTO   v_input_mode, v_is_derived, v_mult, v_reviewer_resolving -- reuse boolean temporary
  FROM   public.locators
  WHERE  id = NEW.locator_id;

  v_input_mode := COALESCE(v_input_mode, 'raw');
  v_is_derived := COALESCE(v_is_derived, FALSE);

  -- Auto-populate multiplier_at_reading if unset / default and entity has multiplier enabled
  IF (NEW.multiplier_at_reading IS NULL OR NEW.multiplier_at_reading = 1) THEN
    SELECT COALESCE(meter_multiplier, 1) INTO v_mult
    FROM public.locators
    WHERE id = NEW.locator_id AND multiplier_enabled = true;
    IF v_mult IS NOT NULL THEN
      NEW.multiplier_at_reading := v_mult;
    END IF;
  END IF;

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   public.locator_readings
  WHERE  locator_id   = NEW.locator_id
    AND  plant_id     = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  IF v_input_mode <> 'direct' THEN
    NEW.previous_reading := v_prev_reading;
  END IF;

  IF v_input_mode = 'direct' THEN
    IF v_is_derived THEN
      RETURN NEW;
    END IF;

    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' AND NOT (TG_OP = 'UPDATE' AND OLD.norm_status = 'pending_review' AND NEW.norm_status = 'normal' AND OLD.current_reading = NEW.current_reading) THEN
      SELECT AVG(sub.vol) INTO v_avg_flow_rate
      FROM (
        SELECT current_reading AS vol
        FROM   public.locator_readings
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

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT (TG_OP = 'UPDATE' AND OLD.norm_status = 'pending_review' AND NEW.norm_status = 'normal' AND OLD.current_reading = NEW.current_reading)
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_set_locator_daily_volume() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_mult NUMERIC := COALESCE(NEW.multiplier_at_reading, 1);
BEGIN
  IF COALESCE(NEW.is_meter_replacement, false) = true THEN
    NEW.daily_volume := 0;
  ELSIF NEW.is_meter_rollover AND NEW.meter_rollover_max IS NOT NULL THEN
    NEW.daily_volume := GREATEST(0, ((NEW.meter_rollover_max - COALESCE(NEW.previous_reading, 0)) + NEW.current_reading) * v_mult);
  ELSE
    NEW.daily_volume := GREATEST(0, (NEW.current_reading - COALESCE(NEW.previous_reading, 0)) * v_mult);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Product Meter Reading Triggers ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_prev_reading       NUMERIC;
  v_prev_dt            TIMESTAMPTZ;
  v_computed_vol       NUMERIC;
  v_flow_rate          NUMERIC;
  v_avg_flow_rate      NUMERIC;
  v_is_derived         BOOLEAN;
  v_reviewer_resolving BOOLEAN;
  v_mult               NUMERIC;
BEGIN
  v_reviewer_resolving := (
    TG_OP = 'UPDATE'
    AND OLD.norm_status = 'pending_review'
    AND NEW.norm_status = 'normal'
    AND OLD.current_reading = NEW.current_reading
  );

  SELECT is_derived INTO v_is_derived
  FROM   public.product_meters
  WHERE  id = NEW.meter_id;

  IF COALESCE(v_is_derived, FALSE) THEN
    RETURN NEW;
  END IF;

  -- Auto-populate multiplier_at_reading if unset / default and entity has multiplier enabled
  IF (NEW.multiplier_at_reading IS NULL OR NEW.multiplier_at_reading = 1) THEN
    SELECT COALESCE(meter_multiplier, 1) INTO v_mult
    FROM public.product_meters
    WHERE id = NEW.meter_id AND multiplier_enabled = true;
    IF v_mult IS NOT NULL THEN
      NEW.multiplier_at_reading := v_mult;
    END IF;
  END IF;

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   public.product_meter_readings
  WHERE  meter_id  = NEW.meter_id
    AND  plant_id  = NEW.plant_id
    AND  (norm_status IS NULL OR norm_status <> 'retracted')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF COALESCE(NEW.is_meter_replacement, FALSE) = TRUE THEN
    NEW.daily_volume := 0;
  ELSIF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, (NEW.meter_rollover_max - v_prev_reading + NEW.current_reading) * COALESCE(NEW.multiplier_at_reading, 1));
  ELSE
    NEW.daily_volume := GREATEST(0, (NEW.current_reading - COALESCE(v_prev_reading, 0)) * COALESCE(NEW.multiplier_at_reading, 1));
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_reviewer_resolving
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_product_meter_reading_chain() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_meter_id             UUID;
  v_plant_id             UUID;
  v_reading_dt           TIMESTAMPTZ;
  v_predecessor_read     NUMERIC;
  v_successor_id         UUID;
  v_successor_repl       BOOLEAN;
  v_successor_roll       BOOLEAN;
  v_successor_rollmax    NUMERIC;
  v_new_prev             NUMERIC;
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

  -- ── Step 1: derive previous_reading on inserted/updated row ───────────────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT current_reading
      INTO v_predecessor_read
      FROM public.product_meter_readings
     WHERE meter_id         = v_meter_id
       AND plant_id         = v_plant_id
       AND reading_datetime < v_reading_dt
       AND (norm_status IS NULL OR norm_status <> 'retracted')
     ORDER BY reading_datetime DESC
     LIMIT 1;

    IF v_predecessor_read IS NOT NULL
       AND (NEW.previous_reading IS DISTINCT FROM v_predecessor_read) THEN
      UPDATE public.product_meter_readings
         SET previous_reading = v_predecessor_read,
             daily_volume     = CASE
                                  WHEN COALESCE(NEW.is_meter_replacement, FALSE) THEN 0
                                  WHEN COALESCE(NEW.is_meter_rollover, FALSE)
                                   AND NEW.meter_rollover_max IS NOT NULL
                                   AND v_predecessor_read IS NOT NULL
                                  THEN GREATEST(0, (NEW.meter_rollover_max - v_predecessor_read + NEW.current_reading) * COALESCE(NEW.multiplier_at_reading, 1))
                                  ELSE GREATEST(0, (NEW.current_reading - COALESCE(v_predecessor_read, 0)) * COALESCE(NEW.multiplier_at_reading, 1))
                                END
       WHERE id = NEW.id;
    END IF;
  END IF;

  -- ── Step 2: patch immediate successor ─────────────────────────────────────
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
                                THEN GREATEST(0, (v_successor_rollmax - v_new_prev + pmr.current_reading) * COALESCE(pmr.multiplier_at_reading, 1))
                                ELSE GREATEST(0, (pmr.current_reading - COALESCE(v_new_prev, 0)) * COALESCE(pmr.multiplier_at_reading, 1))
                              END
     WHERE pmr.id = v_successor_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- ── 5. Well Reading Triggers ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_well_reading_integrity() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_prev_reading       NUMERIC;
  v_prev_dt            TIMESTAMPTZ;
  v_computed_vol       NUMERIC;
  v_flow_rate          NUMERIC;
  v_avg_flow_rate      NUMERIC;
  v_reviewer_resolving BOOLEAN;
  v_mult               NUMERIC;
BEGIN
  v_reviewer_resolving := (
    TG_OP = 'UPDATE'
    AND OLD.norm_status = 'pending_review'
    AND NEW.norm_status = 'normal'
    AND OLD.current_reading = NEW.current_reading
  );

  -- Auto-populate multiplier_at_reading if unset / default and entity has multiplier enabled
  IF (NEW.multiplier_at_reading IS NULL OR NEW.multiplier_at_reading = 1) THEN
    SELECT COALESCE(meter_multiplier, 1) INTO v_mult
    FROM public.wells
    WHERE id = NEW.well_id AND multiplier_enabled = true;
    IF v_mult IS NOT NULL THEN
      NEW.multiplier_at_reading := v_mult;
    END IF;
  END IF;

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   public.well_readings
  WHERE  well_id   = NEW.well_id
    AND  plant_id  = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_reviewer_resolving
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.well_readings_compute_daily_volume() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_mult NUMERIC := COALESCE(NEW.multiplier_at_reading, 1);
BEGIN
  IF COALESCE(NEW.is_meter_replacement, false) = true THEN
    NEW.daily_volume := 0;
  ELSIF NEW.current_reading IS NOT NULL AND NEW.previous_reading IS NOT NULL THEN
    NEW.daily_volume := GREATEST(0, (NEW.current_reading - NEW.previous_reading) * v_mult);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.well_readings_compute_delta() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  actual_prev NUMERIC;
  v_mult NUMERIC := COALESCE(NEW.multiplier_at_reading, 1);
BEGIN
  IF NEW.is_meter_replacement IS TRUE THEN
    NEW.daily_volume := 0;
    RETURN NEW;
  END IF;
  SELECT current_reading INTO actual_prev FROM public.well_readings
   WHERE well_id = NEW.well_id AND reading_datetime < NEW.reading_datetime
     AND (is_meter_replacement IS NULL OR is_meter_replacement = FALSE)
   ORDER BY reading_datetime DESC LIMIT 1;
  IF actual_prev IS NOT NULL THEN NEW.previous_reading := actual_prev; END IF;
  IF NEW.daily_volume IS NULL AND actual_prev IS NOT NULL AND NEW.current_reading IS NOT NULL THEN
    NEW.daily_volume := GREATEST(0, (NEW.current_reading - actual_prev) * v_mult);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_well_reading_chain() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_well_id           UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_id    UUID;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
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
                                WHEN COALESCE(NEW.is_meter_replacement, false) = true THEN 0
                                WHEN NEW.current_reading IS NOT NULL
                                 AND v_predecessor_read  IS NOT NULL
                                THEN GREATEST(0, (NEW.current_reading - v_predecessor_read) * COALESCE(NEW.multiplier_at_reading, 1))
                                WHEN NEW.current_reading IS NOT NULL
                                THEN NEW.current_reading * COALESCE(NEW.multiplier_at_reading, 1)
                                ELSE NULL
                              END
     WHERE id = NEW.id;
  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id
    INTO v_successor_id
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
                                WHEN COALESCE(wr.is_meter_replacement, false) = true THEN 0
                                WHEN wr.current_reading IS NOT NULL
                                 AND v_new_prev          IS NOT NULL
                                THEN GREATEST(0, (wr.current_reading - v_new_prev) * COALESCE(wr.multiplier_at_reading, 1))
                                WHEN wr.current_reading IS NOT NULL
                                THEN wr.current_reading * COALESCE(wr.multiplier_at_reading, 1)
                                ELSE NULL
                              END
     WHERE wr.id = v_successor_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
