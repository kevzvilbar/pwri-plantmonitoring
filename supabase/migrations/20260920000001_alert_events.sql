-- =============================================================================
-- Migration: 20260920000001_alert_events.sql
-- Description: P3-2 of docs/NAV-IA-REMEDIATION-PLAN.md — persist alert
--              acknowledge / resolve / snooze actions so they (a) survive a
--              page reload, (b) survive the next recompute, and (c) are
--              visible to a second user looking at the same plant.
--
--              Before this, `acknowledgeAlert(id, 'current-user')` only
--              mutated in-memory Zustand state: nothing was written to the
--              database, and `addAlerts()` overwrote the status on the next
--              recompute. Alert status becomes derived: the latest event per
--              alert_key, resolved against the snooze window, is the truth.
-- =============================================================================

-- ── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alert_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable alert id from the client, e.g. 'stock-<chemical id>' or
  -- 'high-tds-<trainId>'. Deliberately text: the ids are computed by the
  -- frontend alert rules, not by a table PK.
  alert_key     text        NOT NULL,
  plant_id      uuid        REFERENCES public.plants(id) ON DELETE CASCADE,
  action        text        NOT NULL
                            CHECK (action IN ('acknowledged','resolved','snoozed','reopened')),
  user_id       uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Free text. Required by the UI for 'resolved' (D2), optional otherwise.
  note          text,
  -- Only set for action = 'snoozed'. The client caps this at 24 h and never
  -- allows it for critical alerts (enforced in the UI, see useAlertEvents).
  snooze_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.alert_events IS
  'Append-only audit trail of operator actions on derived plant alerts.';
COMMENT ON COLUMN public.alert_events.alert_key IS
  'Client-computed stable alert id (e.g. high-tds-<trainId>); not a FK.';
COMMENT ON COLUMN public.alert_events.note IS
  'Resolution note. Required by the UI when action = resolved.';

-- "Latest event per alert" is the dominant read pattern; this index serves it
-- for both the per-plant list and the RLS USING clause.
CREATE INDEX IF NOT EXISTS alert_events_alert_key_created_at_idx
  ON public.alert_events (alert_key, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_events_plant_id_created_at_idx
  ON public.alert_events (plant_id, created_at DESC);

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;

-- Read: anyone assigned to the alert's plant, plus Manager/Admin. Mirrors the
-- reading_edit_audit_log policy shape (user_has_plant_access already grants
-- Admin full access via is_admin()).
DROP POLICY IF EXISTS "alert_events_select_plant" ON public.alert_events;
CREATE POLICY "alert_events_select_plant" ON public.alert_events
  FOR SELECT TO authenticated
  USING (
    plant_id IS NULL
    OR public.user_has_plant_access(plant_id)
    OR public.is_manager_or_admin(auth.uid())
  );

-- Insert: only your own rows, and only an action on a plant you can reach.
-- A NULL plant_id is allowed (plant-agnostic alerts) as long as the row is
-- attributed to the caller.
DROP POLICY IF EXISTS "alert_events_insert_own" ON public.alert_events;
CREATE POLICY "alert_events_insert_own" ON public.alert_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (plant_id IS NULL OR public.user_has_plant_access(plant_id))
  );

-- No UPDATE / DELETE policies: this table is append-only by design. A wrong
-- action is corrected by appending a later event (e.g. 'reopened'), which
-- keeps the audit trail intact.

-- ── 3. Derived status helper ────────────────────────────────────────────────
-- Returns the current status of every alert key the caller can see, as a
-- jsonb object keyed by alert_key. A jsonb payload (rather than a set of rows)
-- keeps the client to a single round trip and matches the existing
-- get_dashboard_aggregates() convention.
--
--   status = latest event, with:
--     - 'snoozed' demoted to 'active' once snooze_until has passed
--     - an 'acknowledged' followed by a later 'reopened' returns 'active'
CREATE OR REPLACE FUNCTION public.get_alert_statuses(p_plant_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (e.alert_key)
      e.alert_key,
      e.action,
      e.user_id,
      e.note,
      e.snooze_until,
      e.created_at,
      e.plant_id
    FROM public.alert_events e
    WHERE (p_plant_ids IS NULL OR e.plant_id IS NULL OR e.plant_id = ANY(p_plant_ids))
    ORDER BY e.alert_key, e.created_at DESC
  )
  SELECT COALESCE(
    jsonb_object_agg(
      latest.alert_key,
      jsonb_build_object(
        'status',
          CASE
            WHEN latest.action = 'snoozed' AND latest.snooze_until > now() THEN 'snoozed'
            WHEN latest.action = 'snoozed' THEN 'active'
            WHEN latest.action = 'reopened' THEN 'active'
            ELSE latest.action
          END,
        'user_id',      latest.user_id,
        'note',         latest.note,
        'snooze_until', latest.snooze_until,
        'created_at',   latest.created_at
      )
    ),
    '{}'::jsonb
  )
  FROM latest;
$$;

COMMENT ON FUNCTION public.get_alert_statuses(uuid[]) IS
  'Latest alert action per alert_key, snooze-expiry applied. P3-2/P3-3.';

GRANT EXECUTE ON FUNCTION public.get_alert_statuses(uuid[]) TO authenticated;
