-- Migration: 20260924000003_fix_notify_supervisors_plant_id_cast.sql
-- Fix "operator does not exist: uuid[] @> text[]" in
-- fn_notify_supervisors_on_request(), the AFTER INSERT trigger on
-- correction_requests (trg_notify_supervisors_on_request).
--
-- user_profiles.plant_assignments is uuid[]. The original baseline
-- (20260911044610_baseline_schema.sql) built the comparison array as
-- ARRAY[NEW.plant_id::text], which Postgres infers as text[] -- and
-- there is no uuid[] @> text[] operator, so the containment check fails
-- to parse. correction_requests.plant_id is already uuid NOT NULL, so
-- the ::text cast was both unnecessary and the cause of the type
-- mismatch; removing it lets the array take on uuid[] to match
-- plant_assignments.
--
-- This was silent in application code paths that never hit this branch,
-- but fires on every correction-request submission that reaches a
-- Manager/Admin with a non-empty plant_assignments, and is what broke
-- CI's "Seed E2E test data" step (supabase/e2e-seed.sql inserts a
-- correction_requests row, which fires this trigger).

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
      'warning',
      FALSE,
      NEW.plant_id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."fn_notify_supervisors_on_request"() OWNER TO "postgres";
