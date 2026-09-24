-- =============================================================================
-- Migration: 20260924000002_alert_events_analyst_and_fk_fix.sql
-- Description: 
--   1. Fix foreign key constraint contradiction on public.alert_events
--      (user_id is NOT NULL, so ON DELETE SET NULL was invalid; replace with
--      ON DELETE CASCADE).
--   2. Update RLS policies for alert_events (SELECT and INSERT) to allow
--      public.is_manager_or_analyst_or_admin(auth.uid()), ensuring unassigned
--      Managers and Data Analysts can view and act on alerts across all plants (D5).
--   3. Update public.get_alert_statuses RPC to include
--      public.is_manager_or_analyst_or_admin(auth.uid()) in the plant access filter.
-- =============================================================================

-- ── 1. Fix Foreign Key Constraint ───────────────────────────────────────────
ALTER TABLE public.alert_events
  DROP CONSTRAINT IF EXISTS alert_events_user_id_fkey;

ALTER TABLE public.alert_events
  ADD CONSTRAINT alert_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── 2. Update RLS Policies ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "alert_events_select_plant" ON public.alert_events;
CREATE POLICY "alert_events_select_plant" ON public.alert_events
  FOR SELECT TO authenticated
  USING (
    plant_id IS NULL
    OR public.user_has_plant_access(plant_id)
    OR public.is_manager_or_analyst_or_admin(auth.uid())
  );

DROP POLICY IF EXISTS "alert_events_insert_own" ON public.alert_events;
CREATE POLICY "alert_events_insert_own" ON public.alert_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      plant_id IS NULL
      OR public.user_has_plant_access(plant_id)
      OR public.is_manager_or_analyst_or_admin(auth.uid())
    )
  );

-- ── 3. Update get_alert_statuses RPC ────────────────────────────────────────
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
    WHERE (
      e.plant_id IS NULL
      OR public.user_has_plant_access(e.plant_id)
      OR public.is_manager_or_analyst_or_admin(auth.uid())
    )
      AND (p_plant_ids IS NULL OR e.plant_id IS NULL OR e.plant_id = ANY(p_plant_ids))
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
  'Latest alert action per alert_key scoped by user_has_plant_access and is_manager_or_analyst_or_admin, snooze-expiry applied.';

GRANT EXECUTE ON FUNCTION public.get_alert_statuses(uuid[]) TO authenticated;
