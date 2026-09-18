-- =============================================================================
-- 20260918000002_train_offline_push_notify.sql
-- Web Push notification when a train is marked Offline.
--
-- Completes the alert pipeline started by 20260916000004 (email) and
-- 20260918000001 (push_subscriptions). Until this migration existed, the
-- send-push-notification edge function had NO caller anywhere in the codebase:
-- subscriptions were collected and the function was deployable, but no event
-- ever dispatched a push. This adds the missing producer, mirroring the proven
-- email trigger exactly.
--
-- DESIGN
--   train_status_log INSERT (status='Offline')
--     └─ trigger ─ pg_net.http_post ─▶ Edge Function send-push-notification
--                                        └─▶ RFC 8291/8292 encrypted Web Push
--
--   The DB remains the notification authority (see 20260916000004 header): the
--   consolidated writer guarantees one INSERT per genuine transition, so one
--   INSERT = one push, with no alert/dedupe table and zero added storage.
--
--   Fully event-driven — nothing here polls, so nothing adds recurring egress.
--
--   NO-OP SAFETY: every external dependency is guarded. If pg_net is absent,
--   app.supabase_url / app.supabase_service_role_key are unset, or the edge
--   function's VAPID keys are missing (checked there), the pipeline silently
--   skips. A status-log write is never blocked or failed by push problems.
--
-- CONFIG (per environment, see DEPLOYMENT.md):
--   ALTER DATABASE postgres SET app.supabase_url = 'https://<ref>.supabase.co';
--   ALTER DATABASE postgres SET app.supabase_service_role_key = '<service_role>';
--   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Recipient resolution ─────────────────────────────────────────────────────
-- Deliberately a SEPARATE function from get_offline_alert_recipients(), which
-- returns (email, display_name) and therefore has no user id for the push
-- function to target. Passing that RPC's result to a `user_id IN (...)` filter
-- silently produced an empty list, and the pre-existing edge function treated an
-- empty list as "no filter" — i.e. broadcast to every subscriber on every plant.
--
-- Same audience definition as the email path (Active Manager/Analyst/Admin
-- assigned to the plant), minus the email-address requirement, which is
-- irrelevant to push and would otherwise exclude a phone-only operator.
CREATE OR REPLACE FUNCTION public.get_push_alert_recipient_ids(p_plant_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT DISTINCT up.id AS user_id
  FROM public.user_profiles up
  WHERE up.status = 'Active'
    AND p_plant_id = ANY (up.plant_assignments)
    AND public.is_manager_or_analyst_or_admin(up.id)
$$;

GRANT EXECUTE ON FUNCTION public.get_push_alert_recipient_ids(uuid) TO service_role;

-- ── Trigger: fan a new Offline transition out to the edge function ───────────
CREATE OR REPLACE FUNCTION public.fn_notify_train_offline_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
  v_train_label text;
  v_plant_name text;
  v_message text;
BEGIN
  IF NEW.status <> 'Offline' THEN
    RETURN NEW;
  END IF;

  -- Every dependency guarded: an unconfigured environment just skips.
  IF to_regproc('net.http_post') IS NULL THEN
    RAISE WARNING 'push-notify: pg_net not installed — skipping push notification';
    RETURN NEW;
  END IF;

  v_url := current_setting('app.supabase_url', true);
  v_key := current_setting('app.supabase_service_role_key', true);
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'push-notify: app.supabase_url / app.supabase_service_role_key not set — skipping push notification';
    RETURN NEW;
  END IF;

  SELECT 'Train ' || t.train_number::text || COALESCE(' — ' || t.name, '')
    INTO v_train_label
    FROM public.ro_trains t
   WHERE t.id = NEW.train_id;

  SELECT p.name INTO v_plant_name
    FROM public.plants p
   WHERE p.id = NEW.plant_id;

  v_message :=
    COALESCE(v_train_label, 'A train') || ' at ' || COALESCE(v_plant_name, 'your plant') ||
    ' was marked Offline at ' ||
    to_char(COALESCE(NEW.confirmed_at, now()), 'DD Mon YYYY HH24:MI') || '.' ||
    CASE
      WHEN NEW.reason IS NOT NULL AND NEW.reason <> '' THEN ' Reason: ' || NEW.reason || '.'
      ELSE ''
    END;

  BEGIN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'plant_id', NEW.plant_id,
        'title',    'RO ' || COALESCE(v_train_label, 'Train') || ' Offline',
        'message',  v_message,
        'severity', 'critical',
        'url',      './alerts',
        -- Collapse key (RFC 8030 Topic, server-side sanitised to 32 chars).
        -- A hyphen-stripped UUID is exactly 32 chars, so each train gets its own
        -- topic and repeated alerts for one train replace rather than stack.
        'tag',      replace(NEW.train_id::text, '-', '')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- A notification problem must never fail the status-log write.
    RAISE WARNING 'push-notify: http_post failed (%) — push skipped', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_train_status_log_push_offline ON public.train_status_log;
CREATE TRIGGER trg_train_status_log_push_offline
  AFTER INSERT ON public.train_status_log
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_train_offline_push();
