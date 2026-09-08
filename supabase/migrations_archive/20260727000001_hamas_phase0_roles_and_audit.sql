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
