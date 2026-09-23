-- Migration: 20260923000001_get_alert_statuses_rls_plant_access.sql
-- Fix cross-plant data leak in get_alert_statuses RPC:
-- Ensure SECURITY DEFINER function enforces user_has_plant_access(e.plant_id)
-- so authenticated users only receive alert statuses for plants they are authorized to view.

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
    WHERE (e.plant_id IS NULL OR public.user_has_plant_access(e.plant_id))
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
  'Latest alert action per alert_key scoped by user_has_plant_access, snooze-expiry applied. P3-2/P3-3 security fix.';

GRANT EXECUTE ON FUNCTION public.get_alert_statuses(uuid[]) TO authenticated;

