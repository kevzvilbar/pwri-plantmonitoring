-- P5-6: point correction-resolution notifications at /my-corrections
-- instead of /operations, and drop the duplicate rejection trigger.
--
-- Background
-- ----------
-- fn_notify_operator_on_resolution fires for both approved and rejected
-- transitions (pending → approved/rejected) and sends the operator to /operations.
-- fn_notify_submitter_on_correction_rejection fires only for rejected transitions
-- and also sends to /operations, which means a rejection fires TWO notifications
-- to the same user from two different triggers. Drop the latter; the former
-- already handles both outcomes.
--
-- Both functions are replaced in full so that the diff against the baseline is
-- self-contained and the trigger definitions in pg_catalog stay consistent.

-- 1. Drop the duplicate trigger first (must exist before its function is dropped).
DROP TRIGGER IF EXISTS "trg_notify_submitter_on_correction_rejection"
  ON "public"."correction_requests";

-- 2. Drop the now-unused function.
DROP FUNCTION IF EXISTS "public"."fn_notify_submitter_on_correction_rejection"();

-- 3. Replace fn_notify_operator_on_resolution so its link_path goes to
--    /my-corrections. The operator can see the outcome, the reviewer's name,
--    and the rejection note there without needing access to /operations.
CREATE OR REPLACE FUNCTION "public"."fn_notify_operator_on_resolution"()
  RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
AS $$
DECLARE
  v_plant_name TEXT;
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') AND NEW.submitted_by IS NOT NULL THEN
    SELECT name INTO v_plant_name FROM plants WHERE id = NEW.plant_id;
    INSERT INTO notifications (
      user_id, title, message, link_path,
      alert_type, severity, read, plant_id
    ) VALUES (
      NEW.submitted_by,
      CASE NEW.status WHEN 'approved' THEN 'Correction approved' ELSE 'Correction rejected' END
        || ' — ' || COALESCE(v_plant_name, ''),
      CASE NEW.status
        WHEN 'approved' THEN 'Your correction request was approved. The reading has been updated.'
        ELSE 'Your correction request was not approved. '
          || COALESCE(NULLIF(TRIM(NEW.resolution_note), ''), 'No reason provided.')
      END,
      '/my-corrections',
      'correction_resolved',
      CASE NEW.status WHEN 'approved' THEN 'info' ELSE 'warning' END,
      FALSE,
      NEW.plant_id
    );
  END IF;
  RETURN NEW;
END;
$$;

