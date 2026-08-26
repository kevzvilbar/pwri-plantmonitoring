-- =============================================================================
-- Migration: 20260812090000_fix_approve_reflag_on_pending_review.sql
--
-- BUG REPORTED: Data Corrections → Pending tab — clicking "Approve" on a
-- flagged reading (e.g. Parkmall, Coke — both product_meter_readings,
-- Guizo) shows the "approved" toast, but the row is still there after the
-- list refetches / on next visit.
--
-- ROOT CAUSE: this is NOT the RLS-silently-narrows-the-update failure mode
-- the .select('id') checks in DataCorrections.tsx already guard against
-- (see comments there) — the UPDATE genuinely applies. The problem is what
-- happens next, inside the same statement:
--
--   fn_locator_reading_integrity() and fn_product_meter_reading_integrity()
--   both run BEFORE INSERT OR UPDATE and unconditionally re-derive
--   norm_status from the row's raw current_reading/previous_reading
--   whenever the incoming value is norm_status = 'normal':
--
--     IF v_computed_vol < 0 ... AND NEW.norm_status = 'normal' THEN
--       NEW.norm_status := 'pending_review';
--     END IF;
--
--   "Approve" (DataCorrections.tsx resolveOne / bulkResolve) does exactly
--   `UPDATE ... SET norm_status = 'normal' WHERE id = ...` — it doesn't
--   touch current_reading, because the reading is being approved AS-IS,
--   not corrected. That UPDATE is precisely what the trigger's own
--   condition is watching for. Since the raw values didn't change, the
--   backward/spike check still evaluates true, and the trigger silently
--   flips norm_status right back to 'pending_review' before the row is
--   even written — the admin's decision is overwritten inside their own
--   UPDATE statement, with no error raised anywhere.
--
--   This is also why the other two resolution paths look fine and only
--   plain Approve is broken:
--     - "Edit value" (fn_cascade_reading_correction) sets
--       norm_status = 'normalized', which never matches the trigger's
--       `= 'normal'` check, so it's untouched by this bug.
--     - "Mark as rollover" sets is_meter_rollover = true, which the
--       backward-check condition already explicitly excludes.
--     - "Reject" sets norm_status = 'retracted', which also never matches
--       `= 'normal'`.
--   Only the literal "approve this reading unchanged" action collides with
--   the trigger's own re-check condition.
--
--   well_readings is NOT affected — it has no equivalent integrity trigger
--   that re-derives norm_status (trg_well_readings_delta only recomputes
--   previous_reading/daily_volume, and only fires on
--   `UPDATE OF current_reading`, which a plain Approve never touches).
--
-- FIX: both functions gain a `v_resolving_from_pending` flag — true only
-- when this is an UPDATE and the row's norm_status was already
-- 'pending_review' beforehand. When true, the backward/spike auto-flag is
-- skipped, so an explicit admin/reviewer approval sticks. Fresh inserts
-- (TG_OP = 'INSERT', where OLD doesn't exist) and any other edit path are
-- completely unaffected — they're still checked exactly as before. This is
-- deliberately scoped as narrowly as possible: it only changes behavior for
-- the specific "this row was pending_review and is now being explicitly
-- set to normal" transition, which is the definition of "approve."
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading           NUMERIC;
  v_prev_dt                TIMESTAMPTZ;
  v_computed_vol           NUMERIC;
  v_hours_elapsed          NUMERIC;
  v_flow_rate              NUMERIC;
  v_avg_flow_rate          NUMERIC;
  v_input_mode             TEXT;
  v_is_derived             BOOLEAN;
  -- True only for an UPDATE whose OLD row was already 'pending_review' —
  -- i.e. this statement is resolving an existing flag, not introducing a
  -- fresh one. Computed via IF (not inline `TG_OP = 'UPDATE' AND OLD...`)
  -- so OLD is never referenced outside an UPDATE context.
  v_resolving_from_pending BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_resolving_from_pending := (OLD.norm_status = 'pending_review');
  END IF;

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
    -- locator_derived_review_flags / fn_flag_derived_review(). Skip the
    -- generic spike check.
    IF v_is_derived THEN
      RETURN NEW;
    END IF;

    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' AND NOT v_resolving_from_pending THEN
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

  -- RAW MODE — backward-reading check
  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_resolving_from_pending
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
         AND NOT v_resolving_from_pending
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

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
  -- Same guard as fn_locator_reading_integrity above.
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

-- ── Data repair ───────────────────────────────────────────────────────────
-- One-time clear for rows already stuck by this bug at the time it was
-- found (Parkmall / Coke, Guizo — the exact rows from the bug report).
-- Safe to run any time after the function bodies above are applied: it's a
-- plain UPDATE ... SET norm_status = 'normal', and with the fixed trigger
-- in place that value will no longer be immediately reverted. Genuinely
-- backward/spike rows that still need a real decision are unaffected by
-- this migration — only rows an admin already tried (and failed) to
-- approve should be re-cleared, so this is commented out rather than
-- auto-applied; uncomment and run once if those specific rows are still
-- stuck after deploying the fix above.
--
-- UPDATE product_meter_readings
-- SET norm_status = 'normal'
-- WHERE meter_id IN (
--   (SELECT id FROM product_meters WHERE name = 'Parkmall'),
--   (SELECT id FROM product_meters WHERE name = 'Coke')
-- )
-- AND norm_status = 'pending_review';

NOTIFY pgrst, 'reload schema';
