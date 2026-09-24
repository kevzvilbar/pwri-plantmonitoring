-- Migration: 20260924000004_fix_notification_severity_enum_values.sql
-- Fix 'invalid input value for enum severity_level: "warning"' raised by the
-- correction-request notification triggers.
--
-- notifications.severity is public.severity_level, an enum whose only values
-- are 'Low' | 'Medium' | 'High' | 'Critical'. Two trigger functions on
-- correction_requests were written against the lowercase UI vocabulary
-- ('info' / 'warning') and so raise on every notification they try to insert:
--
--   * fn_notify_supervisors_on_request()   AFTER INSERT  -> 'warning'
--     (baseline; re-created unchanged in 20260924000003, which fixed only the
--      uuid[] @> text[] cast and left the severity literal in place)
--   * fn_notify_operator_on_resolution()   AFTER UPDATE  -> 'info' / 'warning'
--     (baseline; re-created unchanged in 20260921000001)
--
-- Because the exception aborts the whole statement, submitting a correction
-- request (and approving/rejecting one) fails outright wherever the trigger
-- reaches the notifications INSERT. This is what kept CI's
-- "Seed E2E test data" step failing (psql exit 3): supabase/e2e-seed.sql
-- inserts a correction_requests row.
--
-- Mapping preserves the UI tier the notifications already render as
-- (frontend sevTier(): 'Medium' -> warning tier, 'Low' -> info tier):
--     'warning' -> 'Medium'
--     'info'    -> 'Low'
--
-- Function bodies are otherwise identical to the versions they replace.
-- Literals are cast explicitly so a CASE expression can't resolve to text.

CREATE OR REPLACE FUNCTION "public"."fn_notify_supervisors_on_request"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_plant_name TEXT;
  v_submitter  TEXT;
  v_sup_id     UUID;
BEGIN
  SELECT name INTO v_plant_name FROM plants WHERE id = NEW.plant_id;
  SELECT COALESCE(first_name || ' ' || last_name, email, 'An operator')
  INTO   v_submitter
  FROM   user_profiles WHERE id = NEW.submitted_by;

  -- Notify every Manager/Admin who has this plant in their assignments
  FOR v_sup_id IN
    SELECT up.id
    FROM   user_profiles up
    JOIN   user_roles ur ON ur.user_id = up.id
    WHERE  ur.role IN ('Admin', 'Manager')
      AND  (up.plant_assignments @> ARRAY[NEW.plant_id] OR ur.role = 'Admin')
      AND  up.id IS DISTINCT FROM NEW.submitted_by
  LOOP
    INSERT INTO notifications (
      user_id, title, message, link_path,
      alert_type, severity, read, plant_id
    ) VALUES (
      v_sup_id,
      'Correction request — ' || v_plant_name,
      v_submitter || ' requested a correction on a ' ||
        REPLACE(NEW.source_table, '_readings', '') || ' reading. ' ||
        'Original: ' || NEW.original_value || ', Proposed: ' || NEW.proposed_value || '. ' ||
        'Reason: ' || NEW.reason,
      '/data-corrections',
      'correction_request',
      'Medium'::"public"."severity_level",
      FALSE,
      NEW.plant_id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."fn_notify_supervisors_on_request"() OWNER TO "postgres";


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
      CASE NEW.status
        WHEN 'approved' THEN 'Low'::"public"."severity_level"
        ELSE 'Medium'::"public"."severity_level"
      END,
      FALSE,
      NEW.plant_id
    );
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."fn_notify_operator_on_resolution"() OWNER TO "postgres";
