-- =============================================================================
-- Migration: 20260908000003_003_hamas_meter_wiring.sql
-- Baseline 003: HAMAS Meter Wiring & Input Modes (July–Aug 2026)
-- Partition of baseline schema covering archived migrations #37 to #60
-- =============================================================================

-- >>>>>>> BEGIN ARCHIVED: 20260727000001_hamas_phase0_roles_and_audit.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase0_roles_and_audit.sql
-- Phase 0 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- Adds:
--   1. is_manager_or_analyst_or_admin() — a NEW helper (Admin+Manager+Data
--      Analyst). Deliberately NOT a rewrite of the existing
--      is_manager_or_admin() (Admin+Manager only), which is used in ~34 RLS
--      policies across 11 other migrations — changing its semantics would
--      silently change permissions everywhere else it's referenced.
--   2. fn_notify_derived_review() — shared notification fan-out used by both
--      the Phase 2 sweep function and the Phase 3 staleness trigger, so the
--      "who gets notified" logic lives in exactly one place.
--   3. Extends reading_edit_audit_log.table_name to allow 'locator_readings',
--      so Hamas overrides reuse the existing audit trail (logReadingEdit() /
--      diffFields() in frontend/src/pages/ro-trains/helpers.tsx) instead of a
--      new parallel logging mechanism.
-- =============================================================================

-- ── 1. Role helper: Admin, Manager, OR Data Analyst ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_manager_or_analyst_or_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('Admin','Manager','Data Analyst')
  );
$$;

COMMENT ON FUNCTION public.is_manager_or_analyst_or_admin(UUID) IS
  'Admin, Manager, or Data Analyst. Used to gate who may override a derived '
  '(is_derived) locator''s value — deliberately separate from '
  'is_manager_or_admin(), which several unrelated RLS policies already rely '
  'on excluding Data Analyst.';

-- ── 2. Shared notification fan-out for derived-locator review events ───────
-- Notifies every Active user who is Admin, Manager, or Data Analyst AND has
-- access to the locator's plant (Admins implicitly have access to all
-- plants, matching user_has_plant_access()'s own logic).
--
-- _kind: 'stale'      — a sibling locator or the mother meter changed; the
--                        derived value for _date may no longer be correct.
--        'superseded' — the sweep recomputed a date that held a manual
--                        override and the new value differs from it.
CREATE OR REPLACE FUNCTION public.fn_notify_derived_review(
  _locator_id UUID,
  _date       DATE,
  _kind       TEXT,
  _detail     TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locator   RECORD;
  v_title     TEXT;
  v_message   TEXT;
  v_severity  public.severity_level;
  v_recipient RECORD;
BEGIN
  SELECT l.id, l.name, l.plant_id, p.name AS plant_name
    INTO v_locator
    FROM public.locators l
    JOIN public.plants   p ON p.id = l.plant_id
   WHERE l.id = _locator_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF _kind = 'superseded' THEN
    v_title    := v_locator.name || ' override superseded';
    v_severity := 'High';
    v_message  := COALESCE(_detail,
      'The sweep recomputed ' || v_locator.name || ' (' || v_locator.plant_name ||
      ') for ' || to_char(_date, 'Mon DD, YYYY') ||
      ' and replaced a manually-entered value with a fresh calculation.');
  ELSE
    v_title    := v_locator.name || ' needs review';
    v_severity := 'Medium';
    v_message  := COALESCE(_detail,
      v_locator.name || ' (' || v_locator.plant_name || ') has new sibling or ' ||
      'mother-meter data for ' || to_char(_date, 'Mon DD, YYYY') ||
      ' — its computed value may be out of date until the next sweep or a manual recalculation.');
  END IF;

  FOR v_recipient IN
    SELECT up.id
      FROM public.user_profiles up
     WHERE up.status = 'Active'
       AND public.is_manager_or_analyst_or_admin(up.id)
       AND (public.is_admin(up.id) OR v_locator.plant_id = ANY(up.plant_assignments))
  LOOP
    INSERT INTO public.notifications (user_id, plant_id, alert_type, severity, title, message, link_path)
    VALUES (v_recipient.id, v_locator.plant_id, 'derived_meter_review', v_severity, v_title, v_message, '/operations?tab=locator');
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_derived_review(UUID, DATE, TEXT, TEXT) IS
  'Fans out a notification to every Active Admin/Manager/Data Analyst with '
  'access to a derived locator''s plant. Called from the Phase 3 staleness '
  'trigger (_kind=stale) and the Phase 2 sweep function (_kind=superseded).';

-- ── 3. Extend the audit log to cover locator_readings ───────────────────────
ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'locator_readings'
  ));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260727000001_hamas_phase0_roles_and_audit.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000002_hamas_phase1_default_input_mode.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase1_default_input_mode.sql
-- Phase 1 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   The "Direct m³ / Raw Meter" toggle in Operations > Locator was never
--   persisted server-side — LocatorSection.tsx read/wrote it to
--   localStorage.getItem('loc-mode-' + locatorId) (see BlendingSection.tsx /
--   PowerSection.tsx for the equivalent pattern in those two tabs, which are
--   NOT touched by this migration — they write to different tables and are
--   out of scope here). That meant two operators on two different devices
--   could see two different modes for the same locator, with no record of
--   which one is actually correct for that meter.
--
--   This column makes the mode a real, plant-config-owned setting: something
--   a Manager/Admin sets once for the locator (mirroring the existing
--   canEdit = isManager || isAdmin convention in ProductMeters.tsx), which
--   Operations then just reads. No new RLS policy is needed — the existing
--   "locators_write" policy (Admin/Manager + plant access) already covers
--   UPDATEs to this new column since it's just another column on `locators`.
-- =============================================================================

ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS default_input_mode TEXT NOT NULL DEFAULT 'raw'
    CHECK (default_input_mode IN ('raw', 'direct'));

COMMENT ON COLUMN public.locators.default_input_mode IS
  'raw = operator enters the cumulative meter reading (delta computed by the '
  'DB). direct = operator enters the day''s volume directly. Set once per '
  'locator by Manager/Admin in Plant config; Operations reads this instead '
  'of a per-device localStorage toggle.';

-- Per this project's own convention (see 20260722_z_pgrst_schema_reload.sql):
-- new columns need this or PostgREST can reject requests referencing them
-- with a misleading error until its next periodic cache reload.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260727000002_hamas_phase1_default_input_mode.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000003_hamas_phase2_sweep_function.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase2_sweep_function.sql
-- Phase 2 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   .github/workflows/derived-meter-sweep.yml already exists and has been
--   calling POST {SUPABASE_URL}/rest/v1/rpc/fn_sweep_derived_meters on a
--   schedule since it was added — but the function itself was never created
--   (the migration it depends on, 20260726_sweep_derived_meters.sql, does
--   not exist in this repo). Every scheduled run has been failing with a
--   Postgres "function does not exist" error. This migration creates that
--   function, matching the exact RPC signature (p_date, p_lookback_days) and
--   JSON response shape ({"ok": true, ...}) the workflow already expects, so
--   no workflow changes are needed beyond the cadence update in Phase 2's
--   accompanying .github/workflows edit.
--
-- FORMULA:
--   For each is_derived locator L with mother meter M = L.derived_from_meter_id,
--   for each date in [p_date - p_lookback_days + 1, p_date]:
--     residual = SUM(M's product_meter_readings.daily_volume that day)
--              − SUM(daily_volume of L's non-derived sibling locators that day)
--   Both source daily_volume columns are already rollover-aware / normalized
--   by the application, so the sweep reads them directly rather than
--   re-deriving current − previous itself.
--
--   Days are bucketed by Asia/Manila calendar date, matching the "yesterday
--   PHT" convention .github/workflows/nightly-summary.yml already uses and
--   the 5-minutes-earlier scheduling comment in derived-meter-sweep.yml.
--
-- WRITE BEHAVIOR (the "supersede" decision from the Hamas planning thread):
--   • No existing reading for that locator/date  → INSERT (is_estimated=true).
--   • Existing reading is sweep-computed (is_estimated=true) and the new
--     residual differs → UPDATE it in place.
--   • Existing reading is a human override (is_estimated=false) and the new
--     residual differs → UPDATE it (supersede), flip back to
--     is_estimated=true, and notify Admin/Manager/Data Analyst via
--     fn_notify_derived_review(..., 'superseded', ...) — "your override was
--     replaced." If the new residual matches the override, it's left alone.
--   • Any successful compute (mother meter had data that day) resolves an
--     open review flag for that locator/date, whether or not the value
--     actually moved.
--   • If a product_meters row mirrors this locator (derived_from_locator_id),
--     the same value is written into that meter's product_meter_readings —
--     it may belong to a different plant (the Hamas/Mambaling case).
--
-- SECURITY:
--   SECURITY DEFINER so it can write across locator_readings /
--   product_meter_readings / derived_meter_sweep_log / notifications
--   regardless of caller. Matches the existing workflow, which calls this
--   using the anon key (no user session) — there is no authenticated caller
--   to check a role against at that call site. The Phase 4 migration
--   separately restricts *direct table writes* to derived-locator readings
--   to Manager/Analyst/Admin; that restriction does not apply to this
--   function's own internal writes. p_lookback_days is capped defensively
--   since this function performs writes and is callable without auth.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters(
  p_date          DATE,
  p_lookback_days INT DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lookback        INT := LEAST(GREATEST(COALESCE(p_lookback_days, 3), 1), 30);
  v_locator         RECORD;
  v_mirror          RECORD;
  v_day             DATE;
  v_mother_vol      NUMERIC;
  v_siblings_vol    NUMERIC;
  v_new_value       NUMERIC;
  v_existing        RECORD;
  v_reading_dt      TIMESTAMPTZ;
  v_changed         BOOLEAN;
  v_was_override    BOOLEAN;
  v_locators_seen   INT := 0;
  v_rows_changed    INT := 0;
BEGIN
  FOR v_locator IN
    SELECT id, name, plant_id, derived_from_meter_id
      FROM public.locators
     WHERE is_derived = TRUE AND derived_from_meter_id IS NOT NULL
  LOOP
    v_locators_seen := v_locators_seen + 1;

    FOR v_day IN
      SELECT generate_series(p_date - (v_lookback - 1), p_date, INTERVAL '1 day')::date
    LOOP
      v_reading_dt := (v_day + TIME '23:59:00') AT TIME ZONE 'Asia/Manila';

      SELECT SUM(COALESCE(pmr.daily_volume, pmr.current_reading - pmr.previous_reading))
        INTO v_mother_vol
        FROM public.product_meter_readings pmr
       WHERE pmr.meter_id = v_locator.derived_from_meter_id
         AND (pmr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;

      -- Can't compute a residual without the mother meter's reading for that day.
      IF v_mother_vol IS NULL THEN
        CONTINUE;
      END IF;

      SELECT SUM(lr.daily_volume)
        INTO v_siblings_vol
        FROM public.locator_readings lr
        JOIN public.locators sib ON sib.id = lr.locator_id
       WHERE sib.product_meter_id = v_locator.derived_from_meter_id
         AND sib.is_derived = FALSE
         AND (lr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;

      v_new_value := v_mother_vol - COALESCE(v_siblings_vol, 0);

      SELECT lr.id, lr.daily_volume, lr.is_estimated
        INTO v_existing
        FROM public.locator_readings lr
       WHERE lr.locator_id = v_locator.id
         AND (lr.reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day
       ORDER BY lr.reading_datetime DESC
       LIMIT 1;

      v_changed      := FALSE;
      v_was_override := FOUND AND v_existing.is_estimated = FALSE;

      IF NOT FOUND THEN
        INSERT INTO public.locator_readings
          (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
        VALUES
          (v_locator.id, v_locator.plant_id, v_reading_dt, v_new_value, 0, TRUE);
        v_changed := TRUE;

      ELSIF ABS(COALESCE(v_existing.daily_volume, 0) - v_new_value) > 0.005 THEN
        UPDATE public.locator_readings
           SET current_reading = v_new_value, previous_reading = 0, is_estimated = TRUE
         WHERE id = v_existing.id;
        v_changed := TRUE;
      END IF;

      IF v_changed AND v_was_override THEN
        PERFORM public.fn_notify_derived_review(v_locator.id, v_day, 'superseded', NULL);
      END IF;

      INSERT INTO public.derived_meter_sweep_log
        (locator_id, date_key, old_value, new_value, changed)
      VALUES
        (v_locator.id, v_day, v_existing.daily_volume, v_new_value, v_changed);

      IF v_changed THEN
        v_rows_changed := v_rows_changed + 1;
      END IF;

      -- A successful compute resolves any open "needs review" flag for this
      -- date, whether or not the stored value actually moved.
      -- NOTE: locator_derived_review_flags is created in Phase 3
      -- (20260727_hamas_phase3_review_flags_and_notify.sql), which must run
      -- after this migration. plpgsql doesn't validate table references in a
      -- function body at CREATE time, only at execution — and this function
      -- is never called until well after all five phase migrations have run
      -- (via the cron workflow or the "Recalculate now" button), so the
      -- ordering is safe. It would NOT be safe to call this function
      -- manually between applying Phase 2 and Phase 3.
      UPDATE public.locator_derived_review_flags
         SET resolved_at = now()
       WHERE locator_id = v_locator.id AND date_key = v_day AND resolved_at IS NULL;

      -- Mirror into any product_meters row that mirrors this locator's value
      -- (may belong to a different plant — the Hamas/Mambaling case).
      FOR v_mirror IN
        SELECT id, plant_id FROM public.product_meters WHERE derived_from_locator_id = v_locator.id
      LOOP
        IF EXISTS (
          SELECT 1 FROM public.product_meter_readings
           WHERE meter_id = v_mirror.id
             AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day
        ) THEN
          UPDATE public.product_meter_readings
             SET current_reading = v_new_value, previous_reading = 0,
                 daily_volume = v_new_value, is_estimated = TRUE
           WHERE meter_id = v_mirror.id
             AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = v_day;
        ELSE
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_new_value, 0, v_new_value, TRUE);
        END IF;
      END LOOP;

    END LOOP; -- days
  END LOOP; -- derived locators

  RETURN jsonb_build_object(
    'ok', true,
    'date', p_date,
    'lookback_days', v_lookback,
    'derived_locators_seen', v_locators_seen,
    'rows_changed', v_rows_changed
  );
END;
$$;

COMMENT ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) IS
  'Recomputes residual volume (mother meter minus sibling locators) for every '
  'is_derived locator over a rolling lookback window, mirrors the result into '
  'any linked product_meters row, and notifies Admin/Manager/Data Analyst if '
  'a manual override gets superseded. Called on a schedule by '
  '.github/workflows/derived-meter-sweep.yml and on demand by the '
  '"Recalculate now" button in Operations > Locator.';

-- Callable both by the GitHub Actions cron (anon key, no user session) and by
-- authenticated users clicking "Recalculate now" in the UI.
GRANT EXECUTE ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260727000003_hamas_phase2_sweep_function.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000004_hamas_phase3_review_flags_and_notify.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260727000004_hamas_phase3_review_flags_and_notify.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000005_hamas_phase4_override_rls.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_hamas_phase4_override_rls.sql
-- Phase 4 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   locator_readings' existing "locator_readings_plant_access" policy is
--   FOR ALL TO authenticated USING (user_has_plant_access(plant_id)) — i.e.
--   role-agnostic. Today, any authenticated user with plant access can
--   already INSERT/UPDATE/DELETE any locator_readings row, including for
--   is_derived locators; only the frontend hiding the input has been
--   preventing it. This migration adds real DB-level enforcement.
--
--   Postgres RLS policies are additive (OR'd) within the same command, so a
--   normal PERMISSIVE policy can't narrow what locator_readings_plant_access
--   already allows. RESTRICTIVE policies are the correct tool: they AND on
--   top of whatever permissive policies already allow, without touching or
--   risking the existing broad policy that lets operators submit their own
--   (non-derived) readings.
--
--   Three separate policies are required — CREATE POLICY takes exactly one
--   command per statement (no "FOR INSERT, UPDATE" shorthand).
-- =============================================================================

DROP POLICY IF EXISTS "derived_locator_readings_insert_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_insert_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "derived_locator_readings_update_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_update_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  )
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "derived_locator_readings_delete_gate" ON public.locator_readings;
CREATE POLICY "derived_locator_readings_delete_gate" ON public.locator_readings
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.locators l WHERE l.id = locator_readings.locator_id AND l.is_derived)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

-- Note: these three RESTRICTIVE policies apply only to normal authenticated
-- client sessions. fn_sweep_derived_meters() (Phase 2) is SECURITY DEFINER
-- and bypasses RLS entirely, as does the reading-integrity trigger — neither
-- is affected by this change.

-- <<<<<<< END ARCHIVED: 20260727000005_hamas_phase4_override_rls.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260727000006_meter_replacement_wiring.sql >>>>>>>
-- =============================================================================
-- Migration: 20260727_meter_replacement_wiring.sql
--
-- Wires "Replace Meter" into the actual reading-history UI across all four
-- meter-bearing modules (Wells, Locators, Product Meters, RO Trains), instead
-- of the current bare "Repl." checkbox that just flips is_meter_replacement
-- with no record of what the old/new meter actually was.
--
--   1. reading_id on well_meter_replacements / locator_meter_replacements
--      — links a replacement record back to the specific reading that
--        triggered it (was previously untracked).
--   2. product_meters already has meter_brand/size/serial/installed_date
--      (added ad-hoc, codified in 20260721_product_meters_and_readings.sql)
--      but had no replacements table to log swaps against — added here as
--      product_meter_replacements, mirroring locator_meter_replacements.
--   3. ro_trains gets 12 new per-meter identity columns (feed/permeate/reject
--      × brand/size/serial/installed_date) — previously trains had zero
--      meter-identity fields despite already tracking per-meter prev/delta
--      readings.
--   4. ro_train_readings gets three granular replacement flags
--      (is_feed/permeate/reject_meter_replacement) so a Feed meter swap no
--      longer has to share one flag with a Permeate or Reject swap. Existing
--      is_meter_replacement rows are backfilled onto is_permeate_meter_replacement
--      (the only meter type whose delta the app actually recomputed before
--      this migration), and is_meter_replacement itself is kept as a
--      generated OR of the three granular flags so every existing downstream
--      consumer (Dashboard, TrendChart, DataSummaryModal, CSV exports,
--      helpers.recalculateTrainDeltas, etc.) keeps working unchanged.
--   5. ro_train_meter_replacements — new table, one row per train per meter
--      swap, parallel to well/locator/product_meter_replacements.
--
-- All statements use IF NOT EXISTS / OR REPLACE so this is safe to re-run.
-- =============================================================================

-- ── 1. reading_id on the existing well/locator replacement tables ───────────

ALTER TABLE public.well_meter_replacements
  ADD COLUMN IF NOT EXISTS reading_id UUID REFERENCES public.well_readings(id) ON DELETE SET NULL;

ALTER TABLE public.locator_meter_replacements
  ADD COLUMN IF NOT EXISTS reading_id UUID REFERENCES public.locator_readings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wmr_reading ON public.well_meter_replacements(reading_id);
CREATE INDEX IF NOT EXISTS idx_lmr_reading ON public.locator_meter_replacements(reading_id);

-- ── 2. product_meter_replacements ────────────────────────────────────────────
-- Mirrors locator_meter_replacements' column naming (product_meters uses the
-- same meter_brand/meter_size/meter_serial/meter_installed_date shape as
-- locators, not wells' unprefixed brand/size/serial).

CREATE TABLE IF NOT EXISTS public.product_meter_replacements (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id                  UUID        NOT NULL REFERENCES public.product_meters(id) ON DELETE CASCADE,
  plant_id                  UUID        NOT NULL REFERENCES public.plants(id),
  reading_id                UUID        REFERENCES public.product_meter_readings(id) ON DELETE SET NULL,
  replacement_date          DATE        NOT NULL,
  old_meter_brand           TEXT,
  old_meter_size            TEXT,
  old_meter_serial          TEXT,
  old_meter_final_reading   NUMERIC,
  new_meter_brand           TEXT,
  new_meter_size            TEXT,
  new_meter_serial          TEXT,
  new_meter_initial_reading NUMERIC,
  new_meter_installed_date  DATE,
  replaced_by               UUID        REFERENCES public.user_profiles(id),
  remarks                   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pmr_repl_meter   ON public.product_meter_replacements(meter_id);
CREATE INDEX IF NOT EXISTS idx_pmr_repl_reading ON public.product_meter_replacements(reading_id);

ALTER TABLE public.product_meter_replacements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_meter_replacements_plant_access" ON public.product_meter_replacements;
CREATE POLICY "product_meter_replacements_plant_access" ON public.product_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 3. ro_trains — per-meter identity columns ────────────────────────────────

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS feed_meter_brand              TEXT,
  ADD COLUMN IF NOT EXISTS feed_meter_size                TEXT,
  ADD COLUMN IF NOT EXISTS feed_meter_serial              TEXT,
  ADD COLUMN IF NOT EXISTS feed_meter_installed_date      DATE,
  ADD COLUMN IF NOT EXISTS permeate_meter_brand           TEXT,
  ADD COLUMN IF NOT EXISTS permeate_meter_size            TEXT,
  ADD COLUMN IF NOT EXISTS permeate_meter_serial          TEXT,
  ADD COLUMN IF NOT EXISTS permeate_meter_installed_date  DATE,
  ADD COLUMN IF NOT EXISTS reject_meter_brand             TEXT,
  ADD COLUMN IF NOT EXISTS reject_meter_size              TEXT,
  ADD COLUMN IF NOT EXISTS reject_meter_serial            TEXT,
  ADD COLUMN IF NOT EXISTS reject_meter_installed_date    DATE;

COMMENT ON COLUMN public.ro_trains.feed_meter_serial IS
  'Current feed-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''feed'').';
COMMENT ON COLUMN public.ro_trains.permeate_meter_serial IS
  'Current permeate-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''permeate'').';
COMMENT ON COLUMN public.ro_trains.reject_meter_serial IS
  'Current reject-line flow meter serial. History lives in ro_train_meter_replacements (meter_type = ''reject'').';

-- ── 4. ro_train_readings — granular replacement flags ───────────────────────

ALTER TABLE public.ro_train_readings
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_feed_meter_replacement     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_permeate_meter_replacement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_reject_meter_replacement   BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every pre-existing is_meter_replacement row was set through the
-- old shared toggle, whose only real effect was zeroing permeate_meter_delta
-- (recalculateTrainDeltas never looked at feed/reject) — so backfill those
-- rows onto the permeate flag specifically, not all three.
UPDATE public.ro_train_readings
  SET is_permeate_meter_replacement = true
  WHERE is_meter_replacement = true
    AND is_permeate_meter_replacement = false;

COMMENT ON COLUMN public.ro_train_readings.is_feed_meter_replacement IS
  'True when this reading immediately follows a feed-meter swap.';
COMMENT ON COLUMN public.ro_train_readings.is_permeate_meter_replacement IS
  'True when this reading immediately follows a permeate-meter swap. permeate_meter_delta is treated as 0 for this row.';
COMMENT ON COLUMN public.ro_train_readings.is_reject_meter_replacement IS
  'True when this reading immediately follows a reject-meter swap.';

-- Keep the legacy shared is_meter_replacement column in sync as an OR of the
-- three granular flags, so every existing consumer that still reads
-- is_meter_replacement (Dashboard.tsx, TrendChart.tsx, DataSummaryModal.tsx,
-- CSV export, helpers.recalculateTrainDeltas) continues to see the same
-- true/false it always has, with zero changes required on their end.
--
-- is_meter_replacement is treated as fully DERIVED here — this trigger always
-- overwrites it from the three granular flags and ignores whatever value (if
-- any) was supplied for is_meter_replacement itself in the same statement.
-- (Confirmed the only two writers of this column — TrainLogModal.tsx and
-- TrainDetail.tsx's toggleMeterReplacement — are being updated in this same
-- change to only ever set the granular flags, never is_meter_replacement
-- directly, so this is safe.) A one-way OR that also included the incoming
-- is_meter_replacement value would latch true forever once set, since
-- clearing all three granular flags would never be able to pull a
-- previously-true shared flag back down to false.
CREATE OR REPLACE FUNCTION public.sync_ro_train_reading_meter_replacement_flag()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_meter_replacement := (
    NEW.is_feed_meter_replacement
    OR NEW.is_permeate_meter_replacement
    OR NEW.is_reject_meter_replacement
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ro_train_reading_meter_replacement ON public.ro_train_readings;
CREATE TRIGGER trg_sync_ro_train_reading_meter_replacement
  BEFORE INSERT OR UPDATE ON public.ro_train_readings
  FOR EACH ROW EXECUTE FUNCTION public.sync_ro_train_reading_meter_replacement_flag();

-- ── 5. ro_train_meter_replacements ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ro_train_meter_replacements (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id                  UUID        NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id                  UUID        NOT NULL REFERENCES public.plants(id),
  reading_id                UUID        REFERENCES public.ro_train_readings(id) ON DELETE SET NULL,
  meter_type                TEXT        NOT NULL CHECK (meter_type IN ('feed', 'permeate', 'reject')),
  replacement_date          DATE        NOT NULL,
  old_meter_serial          TEXT,
  old_meter_final_reading   NUMERIC,
  new_meter_brand           TEXT,
  new_meter_size            TEXT,
  new_meter_serial          TEXT,
  new_meter_initial_reading NUMERIC,
  new_meter_installed_date  DATE,
  replaced_by               UUID        REFERENCES public.user_profiles(id),
  remarks                   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rtmr_train   ON public.ro_train_meter_replacements(train_id, meter_type);
CREATE INDEX IF NOT EXISTS idx_rtmr_reading ON public.ro_train_meter_replacements(reading_id);

ALTER TABLE public.ro_train_meter_replacements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ro_train_meter_replacements_plant_access" ON public.ro_train_meter_replacements;
CREATE POLICY "ro_train_meter_replacements_plant_access" ON public.ro_train_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 6. Reload PostgREST schema cache ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260727000006_meter_replacement_wiring.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260728000001_hamas_phase5_input_mode_aware_guard.sql >>>>>>>
-- =============================================================================
-- BACKFILL MIGRATION — applied live on 2026-07-28, never committed until now.
-- Recovered verbatim from supabase_migrations.schema_migrations during the
-- HAMAS all-zero-history investigation (2026-08-01/02). This is the ORIGINAL
-- version, kept for history — see 20260801162405_hamas_phase9_fix_integrity_
-- trigger_direct_mode.sql for the fix applied after the bug it introduced
-- was diagnosed.
--
-- Extended fn_locator_reading_integrity (the general locator_readings
-- validation trigger — spike/backward-reading detection) to be aware of
-- direct-input-mode locators, adding a separate spike check for them. BUG:
-- the pre-existing "NEW.previous_reading := v_prev_reading" override (meant
-- for raw/cumulative meters) was left unconditional, running before the
-- new v_input_mode branch — so it silently clobbered previous_reading on
-- every write to a direct-mode/derived locator (e.g. HAMAS) too. This
-- fought fn_sweep_derived_meters_for_date()'s own explicit writes and was
-- the root cause of HAMAS's history showing 0 m³ for extended stretches.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading    NUMERIC;
  v_prev_dt         TIMESTAMPTZ;
  v_computed_vol    NUMERIC;
  v_hours_elapsed   NUMERIC;
  v_flow_rate       NUMERIC;
  v_avg_flow_rate   NUMERIC;
  v_input_mode      TEXT;
BEGIN
  SELECT default_input_mode INTO v_input_mode
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');

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

  NEW.previous_reading := v_prev_reading;

  IF v_input_mode = 'direct' THEN
    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' THEN
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

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

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
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260728000001_hamas_phase5_input_mode_aware_guard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260728000002_hamas_phase5_derive_config_guard.sql >>>>>>>
-- =============================================================================
-- Migration: 20260728_hamas_phase5_derive_config_guard.sql
-- Phase 5 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- CONTEXT:
--   Phases 0-4 built the compute/override/notify engine assuming
--   is_derived=true always comes with a non-null derived_from_meter_id —
--   fn_sweep_derived_meters() (Phase 2) filters on exactly that pair, and a
--   row that violates it just gets silently skipped by the sweep with no
--   error surfaced anywhere.
--
--   Until now the only way to set these two columns was a direct Supabase
--   table edit, so a mismatched pair never actually happened in practice.
--   This phase adds the "Derived / Hamas-style" toggle + mother-meter picker
--   to the Locator dialogs (frontend/src/pages/plants/locators/LocatorDialogs.tsx),
--   which makes it a normal form a Manager/Admin can get wrong — the API
--   layer's own validation (form.is_derived && !form.derived_from_meter_id
--   blocks Save) is a UX convenience, not enforcement. This CHECK constraint
--   is the actual enforcement, matching the project's existing pattern of a
--   client-side check paired with a DB-level one (see e.g. the
--   default_input_mode CHECK from Phase 1).
--
-- NOTE: does not attempt to prevent a derived_from_meter_id that creates a
-- cycle (A derived from a meter that itself mirrors a locator derived from
-- A) — that would need a recursive check across two tables and hasn't come
-- up in practice. Worth a follow-up if this ever gets more than a couple of
-- hops deep.
-- =============================================================================

ALTER TABLE public.locators
  DROP CONSTRAINT IF EXISTS locators_derived_requires_mother_meter;

ALTER TABLE public.locators
  ADD CONSTRAINT locators_derived_requires_mother_meter
  CHECK (NOT is_derived OR derived_from_meter_id IS NOT NULL);

COMMENT ON CONSTRAINT locators_derived_requires_mother_meter ON public.locators IS
  'A derived locator with no mother meter is silently invisible to '
  'fn_sweep_derived_meters() (it filters on is_derived=true AND '
  'derived_from_meter_id IS NOT NULL) — this makes that state impossible '
  'to save instead of failing quietly. Added alongside the Locator-dialog '
  'derive toggle in 20260728 (LocatorDialogs.tsx).';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260728000002_hamas_phase5_derive_config_guard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260728000003_locator_lock_status.sql >>>>>>>
-- =============================================================================
-- Migration: 20260728_locator_lock_status.sql
-- Phase 1 of the locked-meter + illegal-consumption flagging feature.
--
-- Adds a locator-level is_locked flag, independent of the existing Active/
-- Inactive `status` column. Deliberately NOT reusing `status`:
-- LocatorSection.tsx (~line 386), Dashboard.tsx, ReadingCoverageCard.tsx, and
-- PlantTopology.tsx all filter locators on status = 'Active' — a locator set
-- Inactive drops out of the Operations reading-entry list entirely. Since
-- catching illegal consumption on a locked meter requires readings to KEEP
-- being logged against it, the lock state has to live on a column nothing
-- already filters on.
--
-- Covers both a padlocked-but-connected meter and a physically disconnected
-- one under the single is_locked flag — no need to distinguish the two for
-- how this is handled downstream, so this stays a plain boolean (matching
-- the is_derived / is_estimated convention already used on this table)
-- instead of a multi-value status column.
--
-- Why a meter gets locked is a utility/account-level cause (unpaid bill,
-- tampering, vacant property, safety/repair work) — a different domain from
-- the equipment-failure reasons in the existing entity_status_audit_log
-- constraint (pump problem, equipment malfunction, etc.), which exists for
-- the Well/RO Train offline dialogs and the reading-gap dialog. Both sets
-- write into the same reason_category column, so the constraint below
-- extends to allow both. Keep this list in sync with
-- frontend/src/lib/reasonCodes.ts — REASON_CATEGORIES for the first six,
-- LOCK_REASON_CATEGORIES for the last four ('other' is shared, listed once).
--
-- No changes needed to reading_gap_reasons — the meter-lock reason dialog
-- only writes to entity_status_audit_log (via logStatusChange), not to the
-- reading-gap flow, so only that one constraint needs extending.
--
-- Phase 2 (separate migration) adds locator_lock_violation_flags + the
-- AFTER INSERT trigger on locator_readings that actually flags movement,
-- following the pattern in 20260727_hamas_phase0/phase3.
--
-- NOTE: an earlier draft of this migration (already pushed) created a
-- lock_status TEXT column instead. If that ran against this database, drop
-- it first so it doesn't linger unused alongside is_locked:
--   ALTER TABLE public.locators DROP COLUMN IF EXISTS lock_status;
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.locators.is_locked IS
  'Meter is padlocked/sealed or physically disconnected — independent of '
  'status (Active/Inactive). Unlike status=Inactive, this column is never '
  'filtered on when loading locators for reading entry — operators must '
  'keep being able to log readings against a locked meter so movement can '
  'be caught. See the 20260727 hamas migrations for the sibling '
  'review-flag pattern this feature follows.';

-- Partial index: only the (small) set of locked locators is ever queried by
-- name, so no need to index the common false case.
CREATE INDEX IF NOT EXISTS idx_locators_is_locked
  ON public.locators (is_locked) WHERE is_locked = true;

ALTER TABLE public.entity_status_audit_log
  DROP CONSTRAINT IF EXISTS entity_status_audit_log_reason_category_check;
ALTER TABLE public.entity_status_audit_log
  ADD CONSTRAINT entity_status_audit_log_reason_category_check
  CHECK (reason_category IN
    ('pump_problem', 'locked_meter', 'equipment_malfunction',
     'maintenance', 'access_issue', 'other',
     'unpaid_bill', 'tampering', 'vacant_property', 'safety_repair'));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260728000003_locator_lock_status.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000001_hamas_phase6_mirror_reading_integrity_fix.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260729000001_hamas_phase6_mirror_reading_integrity_fix.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000002_hamas_phase7_scoped_sweep.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260729000002_hamas_phase7_scoped_sweep.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000003_hamas_phase8_sibling_netting_fix.sql >>>>>>>
-- =============================================================================
-- BACKFILL MIGRATION — applied live on 2026-07-29, never committed until now.
-- Recovered verbatim from supabase_migrations.schema_migrations during the
-- HAMAS all-zero-history investigation (2026-08-01/02).
--
-- Fixes v_others_vol, which summed the always-NULL locator_readings.
-- daily_volume column instead of computing each sibling's real
-- current-previous delta (with a direct-mode-aware branch, since a direct
-- locator's current_reading already IS its volume). Before this fix the
-- residual mirrored the mother meter's entire volume rather than netting
-- out sibling consumption.
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
      'mother_vol', v_mother_vol, 'others_vol', v_others_vol,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260729000003_hamas_phase8_sibling_netting_fix.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000004_blending_events_meter_columns.sql >>>>>>>
-- =============================================================================
-- Migration: 20260729_blending_events_meter_columns.sql
--
-- Formally adds two columns to blending_events that were created ad-hoc via
-- the Supabase dashboard and therefore absent from all migrations — same
-- root cause already fixed for well_readings in
-- 20260722_well_readings_optional_columns.sql. Missing from migrations means:
--   1. A DB rebuild from migrations loses the columns silently.
--   2. PostgREST's schema cache may be stale (no NOTIFY was ever sent after
--      adding them ad-hoc), causing UPDATE/INSERT payloads that include
--      these columns to fail with the misleading error:
--        "relation 'blending_events' does not exist"
--
-- CONTEXT — pairs with the Operations > Blending fix that removed the
-- "Direct m³" input mode (frontend/src/pages/operations/blending/
-- BlendingSection.tsx): every blending well is physically metered, so
-- volume_m3 is now always a delta computed from two raw_meter_reading
-- values, never a directly-typed figure. raw_meter_reading being nullable
-- pre-fix is exactly how rows with no meter reading on record (Direct-mode
-- saves) got into the table with only a volume_m3 figure and no way to
-- verify or recompute it — see ReadingHistoryDialog.tsx's "Reading" column
-- for blending, which surfaces this gap today. NOT NULL isn't applied here
-- because existing Direct-mode rows already violate it; a follow-up
-- data-repair pass should backfill or flag those before tightening this
-- to NOT NULL.
--
-- Affected frontend: BlendingSection.tsx (BlendingForm, BlendingRow, CSV
--                     import), ReadingHistoryDialog.tsx (blending module).
--
-- All ADD COLUMN statements use IF NOT EXISTS — safe against any DB that
-- already has the columns from the prior ad-hoc additions.
-- =============================================================================

-- ── 1. raw_meter_reading ─────────────────────────────────────────────────────
-- The cumulative meter reading the operator read off the physical meter.
-- volume_m3 (the daily delta) is derived from this minus the previous
-- reading — the app has no way to compute a trustworthy volume without it.
ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS raw_meter_reading NUMERIC
    CHECK (raw_meter_reading IS NULL OR raw_meter_reading >= 0);

COMMENT ON COLUMN public.blending_events.raw_meter_reading IS
  'Cumulative meter reading at time of entry. volume_m3 is this minus the '
  'previous reading for the same well. Nullable only for legacy rows saved '
  'before the Direct-m³ input mode was removed — new rows should always '
  'populate this.';

-- ── 2. is_meter_replacement ──────────────────────────────────────────────────
-- Flags readings where the meter was physically replaced. When true, the
-- volume_m3 delta is treated as 0 so dashboards don't miscount the new
-- meter's lower reading as a production loss — same convention as
-- well_readings.is_meter_replacement (20260722_well_readings_optional_columns.sql).
ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.blending_events.is_meter_replacement IS
  'True when this reading immediately follows a physical meter swap. '
  'volume_m3 is treated as 0 for this row.';

-- ── 3. UPDATE / DELETE RLS policies ──────────────────────────────────────────
-- blending_events was created (20260515_supabase_only_and_data_analysis.sql)
-- with only SELECT and INSERT policies — every other operational readings
-- table (well_readings, locator_readings, ro_train_readings, etc.) got a
-- FOR ALL "{table}_plant_access" policy via the DO-block loop in
-- 20260419_initial_schema_enums_and_roles.sql, but blending_events was never
-- added to that array.
--
-- Effect in production today: ReadingHistoryDialog.tsx's Edit/Delete buttons
-- render unconditionally for blending (canEditDelete = true, no frontend role
-- gate — see line ~568) and call .update()/.delete() against blending_events,
-- but with no UPDATE/DELETE policy those calls affect 0 rows and are caught
-- by the component's own defensive "returned 0 rows. Add policy…" console
-- warnings. So this has been silently broken for every user, and is a direct
-- blocker for fixing the corrupted-volume rows that motivated this migration
-- (rows with volume_m3 holding a raw cumulative reading instead of a delta —
-- see BlendingSection.tsx's removal of the Direct-m³ input mode).
--
-- Matches the plant-access convention used for the other readings tables:
-- any authenticated user with access to the well's plant may write, exactly
-- like well_readings_plant_access / locator_readings_plant_access.
DROP POLICY IF EXISTS "blending_events_update" ON public.blending_events;
CREATE POLICY "blending_events_update" ON public.blending_events
  FOR UPDATE TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "blending_events_delete" ON public.blending_events;
CREATE POLICY "blending_events_delete" ON public.blending_events
  FOR DELETE TO authenticated
  USING (public.user_has_plant_access(plant_id));

-- ── 4. Reload PostgREST schema cache ─────────────────────────────────────────
-- Without this, PostgREST keeps its stale in-memory schema and UPDATE/INSERT
-- payloads that include the new columns are rejected with:
--   "relation 'blending_events' does not exist"
-- This NOTIFY unblocks the issue immediately without needing a server restart.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260729000004_blending_events_meter_columns.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000005_blending_previous_reading_trigger.sql >>>>>>>
-- =============================================================================
-- Migration: 20260729_blending_previous_reading_trigger.sql
--
-- MUST RUN AFTER: 20260729_blending_events_meter_columns.sql (adds
-- raw_meter_reading / is_meter_replacement as real columns, plus the
-- UPDATE/DELETE RLS policies this migration's trigger needs in order for
-- non-admin writes to actually take effect). Safe to run standalone too —
-- the ADD COLUMN IF NOT EXISTS lines below repeat those two columns
-- defensively in case ordering ever gets reversed.
--
-- CONTEXT: removing the "Direct m³" input mode (BlendingSection.tsx) stopped
-- operators from *choosing* to bypass the meter, but the mechanism that
-- actually corrupted volume_m3 historically is still live even after that
-- fix. BlendingRow resolves "previous cumulative reading" from localStorage
-- and computes the delta client-side; when no previous reading is found —
-- a new device, a cleared cache, a different field operator's phone, the
-- first save of the session — it still falls back to storing the raw meter
-- reading itself as if it were the day's volume. A fresh browser has no
-- localStorage entry, so this can still happen for any entry made today,
-- not just the historical rows already sitting in the table.
--
-- This migration moves "what is today's volume" out of the client entirely.
-- previous_reading becomes a real, DB-owned column. The client only ever
-- sends raw_meter_reading (+ reading_datetime, is_meter_replacement); the
-- trigger below resolves previous_reading from the well's own last
-- blending_events row and computes volume_m3 itself, on every INSERT and
-- UPDATE — a client can no longer set volume_m3 directly. A well's
-- first-ever reading now correctly logs 0 m³ today (nothing to diff against
-- yet) instead of dumping the full cumulative reading into "today's
-- volume" — that fallback was the bug.
--
-- Also discovered while writing this: reading_datetime on blending_events
-- has never appeared in any committed migration either (same ad-hoc-via-
-- dashboard pattern already found and fixed for raw_meter_reading /
-- is_meter_replacement in 20260729_blending_events_meter_columns.sql), even
-- though BlendingSection.tsx and ReadingHistoryDialog.tsx have been
-- reading/writing it against this table all along. Added defensively below.
--
-- COMPANION CHANGE: backend/blending_repair_audit.py's --apply path now also
-- writes previous_reading explicitly for every row it corrects (see that
-- file's diff). Without that, this trigger would treat the second row of a
-- repaired run as a fresh baseline — its own predecessor is still
-- unresolved with raw_meter_reading = NULL at that point — and re-zero the
-- exact delta the script just fixed. Run the repair script's --apply only
-- after both this migration and its own updated version are in place.
-- =============================================================================

ALTER TABLE public.blending_events
  ADD COLUMN IF NOT EXISTS raw_meter_reading NUMERIC
    CHECK (raw_meter_reading IS NULL OR raw_meter_reading >= 0),
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reading_datetime TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS previous_reading NUMERIC;

COMMENT ON COLUMN public.blending_events.previous_reading IS
  'Cumulative reading from this well''s prior blending_events row. Resolved '
  'server-side by trg_blending_set_reading on INSERT when not explicitly '
  'supplied — never trust a client-computed value for this. Left NULL means '
  'this row is this well''s baseline (no prior reading exists yet).';

-- ── Server-side previous_reading resolution + volume_m3 ownership ──────────
CREATE OR REPLACE FUNCTION public.fn_blending_set_reading()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_meter_reading IS NULL THEN
    RAISE EXCEPTION 'blending_events.raw_meter_reading is required — blending wells are meter-fed, direct volume entry is not supported';
  END IF;

  -- Only auto-resolve on INSERT, and only when the caller didn't supply one.
  -- An UPDATE that omits previous_reading simply keeps whatever is already
  -- stored (Postgres carries OLD values forward for columns not present in
  -- the UPDATE's SET list) — so a plain "fix a typo'd reading" edit via
  -- ReadingHistoryDialog never gets silently re-baselined.
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
    -- New meter, nothing to diff against — delta zeroed, this reading
    -- becomes the anchor for future deltas.
    NEW.volume_m3 := 0;
  ELSIF NEW.previous_reading IS NULL THEN
    -- No prior reading exists anywhere for this well — genuine baseline.
    -- This is the actual fix: 0 m³ logged today, not the full cumulative
    -- reading dumped in as "today's volume".
    NEW.volume_m3 := 0;
  ELSE
    IF NEW.raw_meter_reading < NEW.previous_reading THEN
      RAISE EXCEPTION 'raw_meter_reading (%) is below the previous cumulative reading (%) for this well — check for a meter replacement or entry error', NEW.raw_meter_reading, NEW.previous_reading;
    END IF;
    NEW.volume_m3 := NEW.raw_meter_reading - NEW.previous_reading;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blending_set_reading ON public.blending_events;
CREATE TRIGGER trg_blending_set_reading
  BEFORE INSERT OR UPDATE OF raw_meter_reading, previous_reading, is_meter_replacement
  ON public.blending_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_blending_set_reading();

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260729000005_blending_previous_reading_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000006_filter_replacements.sql >>>>>>>
-- ============================================================================
-- Filter Replacement Tracking (Bag / Cartridge filters)
-- Added 2026-07-29
--
-- Adds a dedicated replacement-event table and wires its cost into the
-- existing production_costs rollup as a third bucket, synced via trigger
-- the same way chemical_dosing_logs / power_readings / well_readings
-- already do.
--
-- Verified against the live schema (2026-07-29):
--   - production_costs.total_cost IS a GENERATED column
--     (chem_cost + power_cost) — see 20260420_power_tariffs.sql. Rebuilt
--     below to include filter_cost.
--   - RLS below uses this project's real helper functions,
--     public.user_has_plant_access(plant_id) and
--     public.is_manager_or_admin(auth.uid()), matching
--     chemical_deliveries' policies exactly (20260420_chemical_deliveries.sql).
--   - opex_budgets.filter_budget is intentionally NOT added in this pass —
--     BudgetTab.tsx / useOpexBudget.ts don't read it yet, so it would be an
--     inert column. Add it in a follow-up migration when Budget-tab parity
--     for Filters is actually wired up in the frontend.
-- ============================================================================

-- 0. Catch-up: filter_housing_type was applied directly to the live DB
--    without a committed migration. Idempotent no-op if already present.
ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS filter_media_type text
  CHECK (filter_media_type IN ('AFM', 'Sand', 'Other'));

ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS filter_housing_type text
  CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter'));

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS filter_housing_type text
  CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter'));

-- 1. Replacement event log — modeled on chemical_deliveries
--    (quantity, unit_cost, supplier, delivery_date).
CREATE TABLE IF NOT EXISTS public.filter_replacements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id            uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  train_id            uuid REFERENCES public.ro_trains(id) ON DELETE SET NULL,
  replacement_date    date NOT NULL,
  -- Snapshot, not a live lookup: history must not shift retroactively if the
  -- plant/train's configured housing type is ever changed later.
  filter_housing_type text NOT NULL
    CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter')),
  quantity_replaced   integer NOT NULL CHECK (quantity_replaced > 0),
  unit_price          numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  total_cost          numeric(14,2) GENERATED ALWAYS AS (quantity_replaced * unit_price) STORED,
  avg_dp_psi          numeric(6,2),
  supplier            text,
  remarks             text,
  recorded_by         uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_filter_replacements_plant_date
  ON public.filter_replacements (plant_id, replacement_date DESC);

CREATE INDEX IF NOT EXISTS idx_filter_replacements_train
  ON public.filter_replacements (train_id) WHERE train_id IS NOT NULL;

-- 2. Cost rollup wiring — production_costs gains a third bucket.
ALTER TABLE public.production_costs
  ADD COLUMN IF NOT EXISTS filter_cost numeric(14,2) NOT NULL DEFAULT 0;

-- total_cost is GENERATED (chem_cost + power_cost) today — rebuild it to
-- include filter_cost. Safe to run even though production_costs already has
-- rows: DROP/ADD on a generated column recomputes it from existing data,
-- it does not touch chem_cost/power_cost/filter_cost themselves.
ALTER TABLE public.production_costs DROP COLUMN total_cost;
ALTER TABLE public.production_costs ADD COLUMN total_cost numeric(14,2)
  GENERATED ALWAYS AS (chem_cost + power_cost + filter_cost) STORED;

-- 3. Trigger: keep production_costs.filter_cost in sync with the sum of
--    that plant+date's replacements, mirroring the existing chem/power sync
--    pattern (public.trg_recompute_cost / public.recompute_production_cost)
--    so the Rollup view stays correct without app-layer work. This trigger
--    only ever writes the filter_cost column, so it can't race with
--    recompute_production_cost, which only ever writes chem_cost/power_cost/
--    production_m3/cost_per_m3 — the two never fight over the same field.
CREATE OR REPLACE FUNCTION public.fn_sync_filter_cost_to_production_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_plant uuid;
  target_date  date;
  new_total    numeric(14,2);
BEGIN
  target_plant := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  := COALESCE(NEW.replacement_date, OLD.replacement_date);

  SELECT COALESCE(SUM(total_cost), 0) INTO new_total
  FROM public.filter_replacements
  WHERE plant_id = target_plant AND replacement_date = target_date;

  INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, new_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_filter_replacements_sync_cost ON public.filter_replacements;
CREATE TRIGGER trg_filter_replacements_sync_cost
AFTER INSERT OR UPDATE OR DELETE ON public.filter_replacements
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_filter_cost_to_production_costs();

-- 4. RLS — read: anyone with plant access; write: Manager/Admin only.
--    Matches chemical_deliveries' policies exactly (single combined write
--    policy rather than separate INSERT/UPDATE/DELETE grants).
ALTER TABLE public.filter_replacements ENABLE ROW LEVEL SECURITY;

CREATE POLICY filter_replacements_read ON public.filter_replacements
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

CREATE POLICY filter_replacements_write ON public.filter_replacements
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- <<<<<<< END ARCHIVED: 20260729000006_filter_replacements.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000007_plant_meter_config_and_both_production_source.sql >>>>>>>
-- =============================================================================
-- Migration: 20260729_plant_meter_config_and_both_production_source.sql
--
-- CONTEXT:
--   `plant_meter_config` (plant_id, permeate_is_production, config jsonb,
--   updated_at) is already live in Supabase and actively read/written by
--   frontend/src/pages/plants/shared.tsx (usePlantMeterConfig) and consumed
--   by Dashboard.tsx, TrendChart.tsx, and DataSummaryModal.tsx — but it does
--   not appear anywhere in this repo's migrations or in the generated
--   integrations/supabase/types.ts, meaning it was created directly against
--   the database outside of version control at some point. This migration
--   brings it under version control (CREATE TABLE IF NOT EXISTS is a no-op
--   against the existing live table) and fixes a real drift bug found while
--   investigating why a plant's Production tab can go blank even though its
--   Plant Config "Permeate readings are production" switch is on:
--   `saveConfig()` (shared.tsx) only ever upserts the `config` jsonb column —
--   it never writes the top-level `permeate_is_production` column that
--   Dashboard.tsx / DataSummaryModal.tsx query directly. If that column was
--   seeded once by hand and never kept in sync, toggling the switch in the
--   UI updates `config.permeate_is_production` but leaves the stale
--   top-level column behind, and every dashboard query silently falls back
--   to treating the plant as NOT using permeate. The trigger below makes the
--   top-level column a generated mirror of the jsonb value so this can't
--   drift again, regardless of which column a given write touches.
--
--   Also widens `ro_production_source` (stored inside the `config` jsonb
--   blob — see frontend/src/pages/plants/shared.tsx PlantMeterConfig type)
--   to allow a new 'both' value: a plant that has two genuinely independent
--   production inputs (e.g. a dedicated/mirrored product meter — such as a
--   "mother meter" pair from the Hamas derived-locator feature — PLUS its
--   own RO train permeate) whose volumes must be ADDED together, distinct
--   from 'permeate' (product meter EXCLUDED — same water counted once) and
--   'product' (permeate not counted). See MeterConfig.tsx for the UI and
--   Dashboard.tsx / TrendChart.tsx / DataSummaryModal.tsx for the calc side.
--
-- Run this in: Supabase Dashboard → SQL Editor (this project applies
-- migrations manually — see DEPLOYMENT.md).
-- =============================================================================

-- ── 1. Table (no-op if it already exists live) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.plant_meter_config (
  plant_id                UUID PRIMARY KEY REFERENCES public.plants(id) ON DELETE CASCADE,
  permeate_is_production  BOOLEAN NOT NULL DEFAULT false,
  config                  JSONB   NOT NULL DEFAULT '{}'::jsonb,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defensive: add the column if the live table predates it under a different
-- shape than assumed above (no-op if already present).
ALTER TABLE public.plant_meter_config
  ADD COLUMN IF NOT EXISTS permeate_is_production BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.plant_meter_config
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.plant_meter_config
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON TABLE public.plant_meter_config IS
  'One row per plant. `config` is the full PlantMeterConfig JSON blob '
  '(frontend/src/pages/plants/shared.tsx) — the source of truth a Manager/'
  'Admin edits via Plant Config settings. `permeate_is_production` is a '
  'generated-on-write mirror of config->>''permeate_is_production'' (see the '
  'trg_sync_permeate_is_production trigger below) kept as a real column '
  'purely so dashboard queries can filter/select it without unpacking JSON.';

-- ── 2. Data-integrity check on the production-source enum ──────────────────
-- Lives inside the jsonb blob (no dedicated column), so this is a JSON-path
-- CHECK rather than a normal enum constraint. NULL is allowed for plants
-- that have never saved a config yet (client falls back to DEFAULT_METER_CONFIG).
ALTER TABLE public.plant_meter_config
  DROP CONSTRAINT IF EXISTS plant_meter_config_ro_production_source_check;
ALTER TABLE public.plant_meter_config
  ADD CONSTRAINT plant_meter_config_ro_production_source_check
  CHECK (
    (config->>'ro_production_source') IS NULL
    OR (config->>'ro_production_source') IN ('product', 'permeate', 'both')
  );

-- ── 3. Self-healing sync: permeate_is_production always mirrors the jsonb ──
-- Runs on every INSERT/UPDATE regardless of whether the caller wrote the
-- top-level column, the jsonb column, or both — closing the drift gap
-- described above for good.
CREATE OR REPLACE FUNCTION public.fn_sync_permeate_is_production()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.permeate_is_production := COALESCE((NEW.config->>'permeate_is_production')::boolean, false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_permeate_is_production ON public.plant_meter_config;
CREATE TRIGGER trg_sync_permeate_is_production
  BEFORE INSERT OR UPDATE OF config ON public.plant_meter_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_permeate_is_production();

-- One-time backfill so existing rows are correct immediately, not just on
-- their next save. Safe to re-run.
UPDATE public.plant_meter_config
SET permeate_is_production = COALESCE((config->>'permeate_is_production')::boolean, false)
WHERE permeate_is_production IS DISTINCT FROM COALESCE((config->>'permeate_is_production')::boolean, false);

-- ── 4. RLS — mirrors the locators/wells/ro_trains "read by plant access;
--        write by manager/admin with plant access" pattern from
--        20260419_initial_schema_enums_and_roles.sql. No-op additions if
--        equivalent policies already exist under different names (DROP IF
--        EXISTS + CREATE keeps this idempotent either way).
ALTER TABLE public.plant_meter_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plant_meter_config_read" ON public.plant_meter_config;
CREATE POLICY "plant_meter_config_read" ON public.plant_meter_config
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "plant_meter_config_write" ON public.plant_meter_config;
CREATE POLICY "plant_meter_config_write" ON public.plant_meter_config
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260729000007_plant_meter_config_and_both_production_source.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260729000008_filter_usage_tracking.sql >>>>>>>
-- ============================================================================
-- Migration: 20260729000008_filter_usage_tracking.sql
--
-- Reconciles migration drift (roadmap Phase 1, "CI enforcement"): the filter
-- usage/cost tracking feature was applied against the live DB out-of-band
-- and only ever existed in a stray `frontend/supabase/migrations/` tree that
-- the root CLI never applies. Evidence of the live schema: types.ts carries
-- filter_unit_prices / cartridges_changed / fn_filter_unit_price /
-- filter_usage_daily, and src/lib/filterUsage.ts + EditPretreatReadingDialog
-- query them — yet a fresh `supabase start` (or the CI rls-tests job) could
-- not reproduce any of it. This migration brings those pieces under version
-- control. The stray tree itself is deleted in the same change so there is
-- exactly one migration source of truth again.
--
-- DELIBERATE OMISSION vs the stray file: its step 0 (`DROP TABLE
-- filter_replacements` + its trigger/function) is NOT ported. That drop was
-- cleanup for a failed first attempt in the live DB only; in a fresh
-- environment the root migration 20260729000006_filter_replacements.sql
-- legitimately creates filter_replacements, which the app actively uses
-- (src/lib/filterReplacements.ts, useCostComposition.ts, the history UI).
-- Dropping it here would break a fresh environment, not heal it.
--
-- KNOWN COEXISTENCE (left as-is, matching live): production_costs.filter_cost
-- is written by TWO triggers — trg_filter_replacements_sync_cost (from
-- replacement events, 000006) and trg_pretreatment_sync_filter_cost below
-- (from daily usage counts). Whichever fired last owns the day's value.
-- Unifying them is a product decision (which cost basis is canonical?) and
-- is intentionally deferred — see the trigger dependency graph doc.
--
-- Policy note: the stray file used `auth.jwt() ->> 'role'` with a ⚠ "swap
-- for the real role expression" TODO. This port uses the project's real
-- helpers (user_has_plant_access / is_manager_or_admin) exactly as
-- filter_replacements' policies do, and uses DROP POLICY IF EXISTS so the
-- file is idempotent whether the live table already has the old or no
-- policies.
--
-- Everything here is IF NOT EXISTS / OR REPLACE / DROP-IF-EXISTS: safe to
-- run against the live DB (no-op or policy refresh) and against a fresh
-- environment (full apply).
-- ============================================================================

-- 1. Parallel count column to bag_filters_changed (20260420000001), for
--    Cartridge Filter plants. Same habit, one more field on the existing
--    daily Pre-Treatment & RO log form.
ALTER TABLE public.ro_pretreatment_readings
  ADD COLUMN IF NOT EXISTS cartridges_changed integer NOT NULL DEFAULT 0
  CHECK (cartridges_changed >= 0);

-- 2. Effective-dated unit price — deliberately not a single "current price"
--    field: a price change shouldn't silently rewrite last month's cost
--    history. Admin/Manager insert a new row when the price changes; each
--    day's cost uses whatever was in effect on that date.
CREATE TABLE IF NOT EXISTS public.filter_unit_prices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id            uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  filter_housing_type text NOT NULL
    CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter')),
  unit_price          numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  effective_from      date NOT NULL,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plant_id, filter_housing_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_filter_unit_prices_lookup
  ON public.filter_unit_prices (plant_id, filter_housing_type, effective_from DESC);

ALTER TABLE public.filter_unit_prices ENABLE ROW LEVEL SECURITY;

-- Read: anyone with plant access (same as filter_replacements). Write:
-- Manager/Admin with plant access.
DROP POLICY IF EXISTS filter_unit_prices_select ON public.filter_unit_prices;
CREATE POLICY filter_unit_prices_select ON public.filter_unit_prices
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS filter_unit_prices_write ON public.filter_unit_prices;
CREATE POLICY filter_unit_prices_write ON public.filter_unit_prices
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- 3. Price lookup as of a date. STABLE (read-only, safe in index/trigger
--    contexts); search_path pinned per the project's hardening convention.
CREATE OR REPLACE FUNCTION public.fn_filter_unit_price(
  p_plant_id uuid, p_housing_type text, p_as_of date
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT unit_price
  FROM public.filter_unit_prices
  WHERE plant_id = p_plant_id
    AND filter_housing_type = p_housing_type
    AND effective_from <= p_as_of
  ORDER BY effective_from DESC
  LIMIT 1;
$$;

-- 4. Trigger: recompute that plant+date's filter_cost from usage counts
--    whenever a pretreatment reading's changed-counts (or its train/date)
--    change. Recomputes the whole day, not just the changed row, since
--    multiple trains can report the same day with different housing
--    types/prices. ON CONFLICT (plant_id, cost_date) relies on the UNIQUE
--    constraint production_costs has carried since 20260420000002.
CREATE OR REPLACE FUNCTION public.fn_sync_filter_usage_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_plant uuid := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  date  := (COALESCE(NEW.reading_datetime, OLD.reading_datetime))::date;
  day_total    numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(
    CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
      WHEN 'Bag Filter' THEN
        r.bag_filters_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Bag Filter', target_date), 0)
      ELSE
        r.cartridges_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Cartridge Filter', target_date), 0)
    END
  ), 0)
  INTO day_total
  FROM public.ro_pretreatment_readings r
  JOIN public.plants p ON p.id = r.plant_id
  LEFT JOIN public.ro_trains rt ON rt.id = r.train_id
  WHERE r.plant_id = target_plant
    AND r.reading_datetime::date = target_date;

  INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, day_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_pretreatment_sync_filter_cost ON public.ro_pretreatment_readings;
CREATE TRIGGER trg_pretreatment_sync_filter_cost
AFTER INSERT OR DELETE OR UPDATE OF cartridges_changed, bag_filters_changed, train_id, reading_datetime
ON public.ro_pretreatment_readings
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_filter_usage_cost();

-- 5. Read-friendly view for the frontend — one clean source for both the
--    usage chart and the usage history list. security_invoker so the view
--    inherits the underlying tables' RLS (never bypasses it).
CREATE OR REPLACE VIEW public.filter_usage_daily WITH (security_invoker = true) AS
SELECT
  r.id,
  r.plant_id,
  r.train_id,
  r.reading_datetime::date AS reading_date,
  COALESCE(rt.filter_housing_type, p.filter_housing_type) AS filter_housing_type,
  CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
    WHEN 'Bag Filter' THEN r.bag_filters_changed
    ELSE r.cartridges_changed
  END AS quantity_changed,
  CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
    WHEN 'Bag Filter' THEN
      r.bag_filters_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Bag Filter', r.reading_datetime::date), 0)
    ELSE
      r.cartridges_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Cartridge Filter', r.reading_datetime::date), 0)
  END AS cost
FROM public.ro_pretreatment_readings r
JOIN public.plants p ON p.id = r.plant_id
LEFT JOIN public.ro_trains rt ON rt.id = r.train_id;

-- 6. opex_budgets wiring from the stray file is intentionally NOT ported:
--    opex_budgets exists (20260726000001) but BudgetTab.tsx doesn't read
--    filter_budget yet — an inert column, same reasoning 000006 used when
--    it deferred opex wiring for the replacement-event design.

-- <<<<<<< END ARCHIVED: 20260729000008_filter_usage_tracking.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260730000001_hamas_phase6_default_input_mode_guard.sql >>>>>>>
-- =============================================================================
-- Migration: 20260730_hamas_phase6_default_input_mode_guard.sql
-- Phase 6 of the Hamas (derived-locator) override + auto-sweep feature.
--
-- BUG:
--   is_derived (20260722_derived_meter_support.sql) and default_input_mode
--   (20260727_hamas_phase1_default_input_mode.sql) are two independent
--   columns on `locators` with no link between them. default_input_mode is
--   NOT NULL DEFAULT 'raw', and nothing ever set it to 'direct' when a
--   locator became derived — not LocatorDialogs.tsx's own is_derived toggle
--   (it just hides the raw/direct <Select> once is_derived is checked, it
--   never touches the value underneath), and not ProductMeters.tsx's
--   locator-assignment save() (Section: assign/update/unassign loops all set
--   is_derived directly without ever including default_input_mode in the
--   update payload).
--
--   Net effect: a locator can be is_derived = true (no physical meter,
--   value computed by fn_sweep_derived_meters as mother meter − siblings)
--   while default_input_mode is still 'raw' — which sends every reader of
--   this locator (ReadingHistoryDialog, EntityHistoryChart) down the
--   cumulative-meter code path: showing a "Reading" column and computing
--   "Production" as a diff between consecutive rows, for a locator that has
--   no odometer to diff in the first place. This is exactly the state
--   Hamas (SRP) was found in.
--
-- FIX:
--   Same pattern as Phase 5's locators_derived_requires_mother_meter check
--   (client-side convenience + DB-level enforcement) — except a plain CHECK
--   can't self-correct an omitted field, it can only reject the whole write.
--   Since every existing caller already always includes is_derived in its
--   payload but not always default_input_mode, a CHECK constraint would
--   just start throwing on saves that used to succeed. A BEFORE trigger
--   instead auto-corrects default_input_mode to 'direct' whenever
--   is_derived is true, on both INSERT and UPDATE, regardless of which
--   screen (or future screen) is doing the writing.
--
--   The reverse direction (is_derived flips back to false) is intentionally
--   NOT handled by this trigger — a locator coming off derived status needs
--   an admin to actively choose raw vs. direct again (the <Select> reappears
--   in LocatorDialogs.tsx once !is_derived), so the app-code changes
--   accompanying this migration set default_input_mode back to 'raw'
--   explicitly on that transition instead of silently guessing.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_force_direct_mode_when_derived()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_derived THEN
    NEW.default_input_mode := 'direct';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_force_direct_mode_when_derived() IS
  'BEFORE INSERT/UPDATE guard on locators: a derived (no-physical-meter) row '
  'can never be saved with default_input_mode = ''raw''. See Phase 6 header '
  'comment (20260730_hamas_phase6_default_input_mode_guard.sql) for the bug '
  'this closes. Deliberately one-directional — does not reset the mode back '
  'to ''raw'' when is_derived is turned off; the app layer handles that.';

DROP TRIGGER IF EXISTS trg_force_direct_mode ON public.locators;

CREATE TRIGGER trg_force_direct_mode
  BEFORE INSERT OR UPDATE ON public.locators
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_force_direct_mode_when_derived();

-- ── One-time backfill ────────────────────────────────────────────────────────
-- Fixes every already-derived locator caught by this bug today, Hamas (SRP)
-- included, without waiting for someone to re-open and re-save its config.
UPDATE public.locators
   SET default_input_mode = 'direct'
 WHERE is_derived = TRUE
   AND default_input_mode IS DISTINCT FROM 'direct';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260730000001_hamas_phase6_default_input_mode_guard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000001_hamas_phase8_drop_conflicting_prev_reading_guard.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase8_drop_conflicting_prev_reading_guard
-- Applied 2026-08-01 during the HAMAS all-zero-history investigation.
--
-- fn_sweep_derived_meters_for_date() (see phase6/7/8-sibling-netting above —
-- all backfilled from live, previously uncommitted) wrote a real
-- previous_reading (running cumulative) for is_derived locators like HAMAS.
--
-- trg_zz_locator_direct_mode_prev_reading (BEFORE INSERT/UPDATE on
-- locator_readings, fn_locator_direct_mode_prev_reading_guard() — never
-- itself committed to any migration, only discovered via
-- pg_get_functiondef) unconditionally forced previous_reading := 0 for any
-- is_derived or direct-input-mode locator on every write. Because Postgres
-- fires same-timing triggers in name order, this "zz"-prefixed trigger ran
-- AFTER trg_locator_readings_set_daily_volume had already computed
-- daily_volume from the correct previous_reading, then silently clobbered
-- previous_reading back to 0 anyway — leaving current_reading as a real
-- cumulative but previous_reading wrong, and daily_volume stale from
-- whatever it was computed as before the clobber.
--
-- trg_locator_readings_delta (fn_sync_locator_reading_chain, AFTER trigger)
-- would then notice previous_reading didn't match the real chronological
-- predecessor and issue a corrective UPDATE, which re-entered the same
-- BEFORE-trigger gauntlet and got clobbered by the guard again — and also
-- patched the next day's row's previous_reading, cascading corruption
-- forward every time an adjacent date got (re)swept.
--
-- Dropping this guard was the first step; the real fix (making the sweep
-- itself write direct-mode-consistent values, and fixing the OTHER two
-- triggers that were also fighting it) landed in phase9/10/11 below, after
-- this drop alone proved insufficient.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_zz_locator_direct_mode_prev_reading ON public.locator_readings;
DROP FUNCTION IF EXISTS public.fn_locator_direct_mode_prev_reading_guard();

-- <<<<<<< END ARCHIVED: 20260801000001_hamas_phase8_drop_conflicting_prev_reading_guard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000002_hamas_cleanup_drop_legacy_sweep_overload.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_cleanup_drop_legacy_sweep_overload
-- Applied 2026-08-01.
--
-- fn_sweep_derived_meters(p_lookback_days integer DEFAULT 90) was a legacy
-- overload built directly on production (never committed to git, discovered
-- via pg_get_functiondef during the HAMAS all-zero-history investigation).
-- It predates fn_sweep_derived_meters(p_date, p_lookback_days) — the version
-- actually called by LocatorSection.tsx's "Recalculate now" button and by
-- derived-meter-sweep.yml — and used a different, less careful strategy
-- (a naive SUM(daily_volume) sibling calc with no direct-input-mode
-- awareness). Nothing in the frontend, backend, or GitHub workflows calls
-- this specific single-arg signature — confirmed by grepping the full repo.
-- Dropping it removes a second, confusing implementation of "sweep HAMAS"
-- that could be invoked by accident (e.g. from the SQL editor) and produce
-- results inconsistent with the real dispatcher.
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_sweep_derived_meters(integer);

-- <<<<<<< END ARCHIVED: 20260801000002_hamas_cleanup_drop_legacy_sweep_overload.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000003_hamas_phase9_fix_integrity_trigger_direct_mode.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase9_fix_integrity_trigger_direct_mode
-- Applied 2026-08-01, during the HAMAS all-zero-history investigation.
--
-- fn_locator_reading_integrity (see 20260728044216_hamas_phase5_input_mode_
-- aware_guard.sql above) unconditionally overrode NEW.previous_reading from
-- the last non-pending_review predecessor BEFORE checking input mode, even
-- though it already has separate, correct spike-check logic for direct
-- mode further down. This silently clobbered previous_reading on every
-- write to a direct-mode/derived locator (e.g. HAMAS), fighting the sweep
-- function's own explicit writes and was the actual root cause the phase8
-- guard-drop (above) alone didn't fully address. Fix: only override
-- previous_reading for raw (cumulative-meter) locators; direct-mode
-- locators keep whatever previous_reading the caller set (0, per the sweep
-- function as of phase11 below).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading    NUMERIC;
  v_prev_dt         TIMESTAMPTZ;
  v_computed_vol    NUMERIC;
  v_hours_elapsed   NUMERIC;
  v_flow_rate       NUMERIC;
  v_avg_flow_rate   NUMERIC;
  v_input_mode      TEXT;
BEGIN
  SELECT default_input_mode INTO v_input_mode
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');

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
    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' THEN
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

  -- RAW MODE (unchanged) — backward-reading check
  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
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
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260801000003_hamas_phase9_fix_integrity_trigger_direct_mode.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000004_hamas_phase10_chain_sync_skip_direct_mode.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase10_chain_sync_skip_direct_mode
-- Applied 2026-08-01, during the HAMAS all-zero-history investigation.
--
-- fn_sync_locator_reading_chain (trigger trg_locator_readings_delta, AFTER
-- INSERT/UPDATE/DELETE on locator_readings — never itself committed to any
-- migration, only discovered via pg_get_functiondef) maintains a
-- running-cumulative chain (previous_reading = chronological predecessor's
-- current_reading) for raw meters, and patches the successor row's
-- previous_reading whenever any row changes. That concept doesn't apply to
-- direct-mode/derived locators (current_reading IS the period volume,
-- previous_reading is always 0 by design) — applying it there was actively
-- harmful, patching in a real predecessor value and cascading corruption
-- through the chain any time an adjacent date got (re)swept. Make it a
-- no-op for direct-mode locators.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_locator_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locator_id        UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_input_mode        TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_locator_id := OLD.locator_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_locator_id := NEW.locator_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  SELECT default_input_mode INTO v_input_mode FROM public.locators WHERE id = v_locator_id;
  IF v_input_mode = 'direct' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT current_reading
      INTO v_predecessor_read
      FROM public.locator_readings
     WHERE locator_id    = v_locator_id
       AND reading_datetime < v_reading_dt
     ORDER BY reading_datetime DESC
     LIMIT 1;

    IF v_predecessor_read IS NOT NULL
       AND (NEW.previous_reading IS DISTINCT FROM v_predecessor_read) THEN
      UPDATE public.locator_readings
         SET previous_reading = v_predecessor_read
       WHERE id = NEW.id;
    END IF;
  END IF;

  SELECT id
    INTO v_successor_id
    FROM public.locator_readings
   WHERE locator_id      = v_locator_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      UPDATE public.locator_readings
         SET previous_reading = OLD.previous_reading
       WHERE id = v_successor_id;
    ELSE
      UPDATE public.locator_readings
         SET previous_reading = NEW.current_reading
       WHERE id = v_successor_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260801000004_hamas_phase10_chain_sync_skip_direct_mode.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000005_hamas_phase11_sweep_writes_direct_volume_not_cumulative.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase11_sweep_writes_direct_volume_not_cumulative
-- Applied 2026-08-01, during the HAMAS all-zero-history investigation.
--
-- fn_sweep_derived_meters_for_date built current_reading as a running
-- cumulative total (prev_cumulative + residual) for both the locator row
-- and its mirror, since phase6 above. That model is inconsistent with
-- everywhere else this data is used: ReadingHistoryDialog.tsx renders a
-- direct-mode locator's current_reading raw, with no subtraction — it only
-- makes sense if current_reading IS the day's volume. fn_locator_reading_
-- integrity's own direct-mode spike-check (phase5/9) makes the same
-- assumption. This is also what let three separate, uncoordinated live
-- objects (the phase5 guard, the now-dropped zz-guard, and the chain-sync
-- trigger) each silently fight over what previous_reading should mean.
--
-- Simplify: current_reading = the day's residual, previous_reading = 0,
-- for both the locator row and its mirror — matching the "direct mode =
-- already a volume" semantic used consistently everywhere else, and
-- removing the predecessor-cumulative lookups entirely (no longer needed).
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

-- <<<<<<< END ARCHIVED: 20260801000005_hamas_phase11_sweep_writes_direct_volume_not_cumulative.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260801000006_notifications_delete_and_pending_review.sql >>>>>>>
-- =============================================================================
-- Migration: 20260801_notifications_delete_and_pending_review.sql
--
-- 1. notifications has SELECT/UPDATE/INSERT policies (20260419, 20260419_
--    notifications_rls) but no DELETE policy, so the "DB Notifications" list
--    in TopBar.tsx has never been able to offer a working X/close button
--    (unlike "Plant Alerts" above it, which is client-side/Zustand and
--    already supports dismiss). This adds the missing policy, scoped to the
--    user's own notifications only — same ownership rule already used by
--    notifications_own_select / notifications_own_update.
--
-- 2. ro_train_readings already has a norm_status column (added in
--    20260514_normalization.sql) and 'pending_review' has been an allowed
--    value since 20260718_pending_review_and_cascade_correction.sql — but
--    no RO save path has ever written to it (confirmed: no INSERT/UPDATE
--    anywhere in the app sets ro_train_readings.norm_status). This is the
--    "the permeate meter error should be flagged" gap: an operator mis-key
--    (e.g. Aug 1 06:43 permeate meter jumping from ~660,977 to 2,153,677 —
--    a 1,493,203 m3 delta / 409,096.71 m3/h flow rate) is written straight
--    through with no guard, no matter how far outside history it is.
--    This does NOT change fn_cascade_reading_correction (which explicitly
--    rejects ro_train_readings — it uses a 3-meter model, not the single
--    current_reading/previous_reading model that RPC assumes) or the
--    Data Corrections / Pending Review table lists (which are scoped to
--    locator/well/product_meter_readings only) — extending those to fully
--    support RO's 3-meter shape is a larger follow-up, not this fix.
--    The frontend (roReadingGuards.ts + PretreatmentAndROLog.tsx +
--    Dashboard.tsx) is responsible for setting/reading norm_status here;
--    this migration only confirms the constraint already allows it and is
--    a safe no-op if 20260514/20260718 already applied.
-- =============================================================================

-- ── 1. notifications: allow a user to delete their own notifications ────────
DROP POLICY IF EXISTS "notifications_own_delete" ON public.notifications;
CREATE POLICY "notifications_own_delete" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── 2. ro_train_readings.norm_status — confirm column + constraint exist ────
-- Guarded the same way 20260514/20260718 guard it, so this migration is a
-- safe no-op on any DB that already ran those, and self-healing on one that
-- somehow didn't (e.g. ro_train_readings created after 20260514 by a restore).
DO $$ BEGIN
  ALTER TABLE public.ro_train_readings
    ADD COLUMN IF NOT EXISTS norm_status TEXT;
  ALTER TABLE public.ro_train_readings DROP CONSTRAINT IF EXISTS ro_train_readings_norm_status_check;
  ALTER TABLE public.ro_train_readings
    ADD CONSTRAINT ro_train_readings_norm_status_check
    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_rtr_norm_status ON public.ro_train_readings(norm_status)
  WHERE norm_status = 'pending_review';

-- <<<<<<< END ARCHIVED: 20260801000006_notifications_delete_and_pending_review.sql <<<<<<<

