-- =============================================================================
-- 20260916000004_train_offline_email_notify.sql
-- Email notification when a train is marked Offline (RO_TRAIN_ALERT_SYSTEM_
-- RECONCILIATION.md §3 item 2, priority P3 — EMAIL-ONLY edition).
--
-- DESIGN
--   train_status_log INSERT (status='Offline')
--     └─ trigger ─ pg_net.http_post ─▶ Edge Function notify-train-offline
--                                        └─▶ Resend (free tier) ─▶ managers/admins
--
--   The DB is the notification authority, NOT the client: the auto-offline
--   flagger runs in whatever browser tabs happen to be open, and the
--   consolidated writer (lib/trainStatusLogWriter.ts) guarantees every
--   genuine transition lands as exactly one INSERT. So one INSERT = one
--   notification, with NO alert/dedupe table — zero added storage.
--
--   Fully event-driven: nothing here polls, so nothing here adds recurring
--   egress. The trigger fires a handful of times per week at most.
--
--   NO-OP SAFETY: every external dependency is guarded. If pg_net is absent,
--   app.supabase_url / app.supabase_service_role_key are unset, or the edge
--   function's RESEND_API_KEY is missing (checked there), the pipeline
--   silently skips — status-log inserts are never blocked or failed by
--   notification problems.
--
-- CONFIG (per environment, see DEPLOYMENT.md):
--   ALTER DATABASE postgres SET app.supabase_url = 'https://<ref>.supabase.co';
--   ALTER DATABASE postgres SET app.supabase_service_role_key = '<service_role>';
--   supabase secrets set RESEND_API_KEY=re_...  NOTIFY_FROM_EMAIL=alerts@yourdomain
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Recipient resolution ─────────────────────────────────────────────────────
-- Active Manager/Analyst/Admin profiles assigned to the train's plant — the
-- same audience the baseline notification precedent (20260727000001) targets.
-- Roles live in the role-helper functions (user_profiles has no role column);
-- emails live on auth.users, readable here because the function is SECURITY
-- DEFINER.
CREATE OR REPLACE FUNCTION public.get_offline_alert_recipients(p_plant_id uuid)
RETURNS TABLE (email text, display_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT DISTINCT
    u.email::text AS email,
    NULLIF(trim(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), '')::text AS display_name
  FROM public.user_profiles up
  JOIN auth.users u ON u.id = up.id
  WHERE up.status = 'Active'
    AND p_plant_id = ANY (up.plant_assignments)
    AND u.email IS NOT NULL
    AND u.email <> ''
    AND public.is_manager_or_analyst_or_admin(up.id)
$$;

-- ── Trigger: fan a new Offline transition out to the edge function ───────────
CREATE OR REPLACE FUNCTION public.fn_notify_train_offline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NEW.status <> 'Offline' THEN
    RETURN NEW;
  END IF;

  -- Every dependency guarded: an unconfigured environment just skips.
  IF to_regproc('net.http_post') IS NULL THEN
    RAISE WARNING 'notify-train-offline: pg_net not installed — skipping email notification';
    RETURN NEW;
  END IF;

  v_url := current_setting('app.supabase_url', true);
  v_key := current_setting('app.supabase_service_role_key', true);
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'notify-train-offline: app.supabase_url / app.supabase_service_role_key not set — skipping email notification';
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/notify-train-offline',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'row_id',      NEW.id,
        'train_id',    NEW.train_id,
        'plant_id',    NEW.plant_id,
        'reason',      NEW.reason,
        'confirmed_at', NEW.confirmed_at,
        'confirmed_by', NEW.confirmed_by
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- A notification problem must never fail the status-log write.
    RAISE WARNING 'notify-train-offline: http_post failed (%) — notification skipped', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_train_status_log_notify_offline ON public.train_status_log;
CREATE TRIGGER trg_train_status_log_notify_offline
  AFTER INSERT ON public.train_status_log
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_train_offline();
