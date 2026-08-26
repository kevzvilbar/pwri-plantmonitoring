-- =============================================================================
-- Migration: 20260727_hamas_phase3_review_flags_and_notify.sql
-- Phase 3 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- Watches for edits that can change a derived locator's residual formula
-- (mother meter − Σ sibling locators) and flags the affected date as
-- "needs review" + notifies Admin/Manager/Data Analyst — per the Hamas
-- planning decision, this fires on edits to a SIBLING locator's reading OR
-- the mother meter's own reading, not just siblings.
--
-- Deliberately does NOT fire on edits to the derived locator's own row —
-- those are the sweep (Phase 2) or a manual override (Phase 4) writing the
-- answer, not a new input.
--
-- Deliberately does NOT re-flag/re-notify while a flag for that date is
-- already open, so a run of several sibling edits before anyone's reviewed
-- the first one doesn't spam a notification per edit.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.locator_derived_review_flags (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  locator_id  UUID        NOT NULL REFERENCES public.locators(id) ON DELETE CASCADE,
  date_key    DATE        NOT NULL,
  flagged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_review_flags_locator_date
  ON public.locator_derived_review_flags (locator_id, date_key);

-- At most one OPEN flag per (locator, date) — repeated triggers for the same
-- unresolved date just no-op against this instead of piling up rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_review_flag
  ON public.locator_derived_review_flags (locator_id, date_key)
  WHERE resolved_at IS NULL;

ALTER TABLE public.locator_derived_review_flags ENABLE ROW LEVEL SECURITY;

-- Read: same audience as the override capability — Admin/Manager/Data
-- Analyst with access to the locator's plant. No client INSERT/UPDATE
-- policy is defined; only the SECURITY DEFINER trigger function and the
-- SECURITY DEFINER sweep function write to this table (mirroring how
-- derived_meter_sweep_log is service/definer-only).
DROP POLICY IF EXISTS "review_flags_read" ON public.locator_derived_review_flags;
CREATE POLICY "review_flags_read" ON public.locator_derived_review_flags
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.locators l
       WHERE l.id = locator_derived_review_flags.locator_id
         AND public.user_has_plant_access(l.plant_id)
    )
  );

-- ── Trigger function ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_flag_derived_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locator_id UUID;
  v_meter_id   UUID;
  v_day        DATE;
  v_relevant   BOOLEAN := TRUE;
  v_sib        RECORD;
BEGIN
  IF TG_TABLE_NAME = 'locator_readings' THEN
    SELECT is_derived, product_meter_id INTO v_sib
      FROM public.locators WHERE id = COALESCE(NEW.locator_id, OLD.locator_id);

    -- A derived locator's own row being written is the sweep/override
    -- answering, not a new sibling input — ignore it here.
    IF v_sib.is_derived THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    v_meter_id := v_sib.product_meter_id;
    v_day := (COALESCE(NEW.reading_datetime, OLD.reading_datetime) AT TIME ZONE 'Asia/Manila')::date;

    IF TG_OP = 'UPDATE' THEN
      v_relevant := NEW.current_reading    IS DISTINCT FROM OLD.current_reading
                 OR NEW.previous_reading   IS DISTINCT FROM OLD.previous_reading
                 OR NEW.reading_datetime   IS DISTINCT FROM OLD.reading_datetime
                 OR NEW.is_meter_rollover  IS DISTINCT FROM OLD.is_meter_rollover
                 OR NEW.meter_rollover_max IS DISTINCT FROM OLD.meter_rollover_max;
    END IF;

  ELSIF TG_TABLE_NAME = 'product_meter_readings' THEN
    v_meter_id := COALESCE(NEW.meter_id, OLD.meter_id);
    v_day := (COALESCE(NEW.reading_datetime, OLD.reading_datetime) AT TIME ZONE 'Asia/Manila')::date;

    IF TG_OP = 'UPDATE' THEN
      v_relevant := NEW.current_reading  IS DISTINCT FROM OLD.current_reading
                 OR NEW.previous_reading IS DISTINCT FROM OLD.previous_reading
                 OR NEW.daily_volume     IS DISTINCT FROM OLD.daily_volume
                 OR NEW.reading_datetime IS DISTINCT FROM OLD.reading_datetime;
    END IF;

  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT v_relevant OR v_meter_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT id INTO v_locator_id
    FROM public.locators
   WHERE derived_from_meter_id = v_meter_id AND is_derived = TRUE
   LIMIT 1;

  IF v_locator_id IS NULL THEN
    RETURN COALESCE(NEW, OLD); -- this meter has no derived (Hamas-style) locator
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.locator_derived_review_flags
     WHERE locator_id = v_locator_id AND date_key = v_day AND resolved_at IS NULL
  ) THEN
    INSERT INTO public.locator_derived_review_flags (locator_id, date_key)
    VALUES (v_locator_id, v_day);

    PERFORM public.fn_notify_derived_review(v_locator_id, v_day, 'stale', NULL);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_derived_review_locator ON public.locator_readings;
CREATE TRIGGER trg_flag_derived_review_locator
  AFTER INSERT OR UPDATE OR DELETE ON public.locator_readings
  FOR EACH ROW EXECUTE FUNCTION public.fn_flag_derived_review();

DROP TRIGGER IF EXISTS trg_flag_derived_review_meter ON public.product_meter_readings;
CREATE TRIGGER trg_flag_derived_review_meter
  AFTER INSERT OR UPDATE OR DELETE ON public.product_meter_readings
  FOR EACH ROW EXECUTE FUNCTION public.fn_flag_derived_review();

NOTIFY pgrst, 'reload schema';
