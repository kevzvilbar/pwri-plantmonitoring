-- =============================================================================
-- Migration: 20260809_notify_submitter_on_correction_rejection.sql
--
-- Gap: when a supervisor rejects an operator's correction_requests row
-- (DataCorrections.tsx → rejectRequest()), the submitting operator was never
-- notified — the request just quietly stopped showing up anywhere on their
-- side, with no indication it was reviewed or why. approveRequest()'s own
-- code comment ("Mark request as approved (triggers operator notification)")
-- implies the approve path already notifies the submitter via some existing
-- trigger, but correction_requests itself isn't created by any migration in
-- this repo — per 20260723_manager_data_corrections_access.sql, it was set
-- up directly in the Supabase dashboard — so that trigger's exact definition
-- isn't visible here to extend safely.
--
-- Rather than guess at it and risk a duplicate/conflicting trigger on the
-- approve path, this adds a new trigger scoped ONLY to the pending→rejected
-- transition. It surfaces resolution_note — now always populated, since the
-- frontend requires a reason before the Reject button is even enabled — as
-- the notification body, so the operator sees why, not just that.
--
-- Before/after applying, you can confirm there's no pre-existing overlap:
--   SELECT tgname, pg_get_triggerdef(oid)
--     FROM pg_trigger WHERE tgrelid = 'public.correction_requests'::regclass;
-- If a rejection ever produces two notifications for the same event, one of
-- the two triggers found there is redundant with this one — drop that one.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_notify_submitter_on_correction_rejection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected'
     AND OLD.status IS DISTINCT FROM 'rejected'
     AND NEW.submitted_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, plant_id, alert_type, severity, title, message, link_path)
    VALUES (
      NEW.submitted_by,
      NEW.plant_id,
      'correction_request_rejected',
      'Medium',
      'Correction request rejected',
      'Your correction request (' || NEW.source_table || ': ' ||
        COALESCE(NEW.original_value::text, '—') || ' \u2192 ' ||
        COALESCE(NEW.proposed_value::text, '—') ||
        ') was rejected. Reason: ' ||
        COALESCE(NULLIF(TRIM(NEW.resolution_note), ''), 'No reason given.'),
      '/operations'
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_submitter_on_correction_rejection() IS
  'Notifies the operator who submitted a correction_requests row when a '
  'supervisor rejects it, including resolution_note (the required rejection '
  'reason) in the notification body. Scoped narrowly to the pending→rejected '
  'transition so it cannot double-fire alongside whatever already handles '
  'the approved case.';

DROP TRIGGER IF EXISTS trg_notify_submitter_on_correction_rejection ON public.correction_requests;
CREATE TRIGGER trg_notify_submitter_on_correction_rejection
  AFTER UPDATE ON public.correction_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_submitter_on_correction_rejection();

NOTIFY pgrst, 'reload schema';
