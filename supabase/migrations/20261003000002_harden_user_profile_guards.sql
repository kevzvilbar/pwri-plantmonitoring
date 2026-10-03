-- =============================================================================
-- Migration: 20261003000002_harden_user_profile_guards.sql
-- Description:
--   1. Hardens trg_guard_user_profile_modifications() trigger to prevent
--      non-administrators from tampering with plant_assignments and designation
--      once onboarding is completed / user is confirmed.
--   2. Ensures strict search_path = public, pg_temp is enforced.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_guard_user_profile_modifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Trusted-caller bypass:
  --   * service_role via the API (auth.role() reads both the legacy
  --     request.jwt.claim.role GUC and the request.jwt.claims JSON that
  --     current PostgREST sets), and
  --   * direct DB sessions with no API role switch (migrations, psql, CI seed,
  --     pgTAP fixtures). PostgREST always does SET ROLE anon/authenticated/
  --     service_role, so current_setting('role') is 'none' only outside the API.
  IF COALESCE(auth.role(), current_setting('request.jwt.claim.role', true)) = 'service_role'
     OR current_setting('role', true) IN ('none', 'service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Admin caller bypass
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- For regular users on INSERT: force safe initial state
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'Pending';
    NEW.confirmed := false;
    RETURN NEW;
  END IF;

  -- For regular users on UPDATE: protect status, confirmed, supervisor, plant assignments, and designation
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only administrators can change user status';
    END IF;
    IF NEW.confirmed IS DISTINCT FROM OLD.confirmed THEN
      RAISE EXCEPTION 'Only administrators can approve/confirm users';
    END IF;
    IF NEW.immediate_head_id IS DISTINCT FROM OLD.immediate_head_id AND OLD.confirmed = true THEN
      RAISE EXCEPTION 'Only administrators can change supervisor head once confirmed';
    END IF;
    IF NEW.plant_assignments IS DISTINCT FROM OLD.plant_assignments AND (OLD.confirmed = true OR OLD.profile_complete = true) THEN
      RAISE EXCEPTION 'Only administrators can change plant assignments once confirmed';
    END IF;
    IF NEW.designation IS DISTINCT FROM OLD.designation AND (OLD.confirmed = true OR OLD.profile_complete = true) THEN
      RAISE EXCEPTION 'Only administrators can change designation once confirmed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

