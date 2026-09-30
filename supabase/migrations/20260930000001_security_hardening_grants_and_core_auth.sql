-- =============================================================================
-- Migration: 20260930000001_security_hardening_grants_and_core_auth.sql
-- Description:
--   1. DB-01: Revokes blanket EXECUTE/ALL grants from anon and PUBLIC across all
--      functions, tables, and sequences in public schema. Fixes default privileges
--      so new objects are not auto-granted to anon.
--   2. DB-02: Restores the real handle_new_user() trigger function creating
--      unconfirmed Pending profiles with default Operator role.
--   3. DB-03: Hardens complete_onboarding() so users cannot self-activate or self-confirm;
--      adds trg_guard_user_profile_changes trigger on user_profiles;
--      updates user_has_plant_access() to enforce confirmed = true AND status = 'Active';
--      updates approve_user() to activate and confirm users.
--   4. DB-11: Hardens admin_set_user_password with qualified extensions.crypt (cost 10),
--      admin role check, and length validation.
--   5. DB-12: Implements admin_suspend_user() and admin_reactivate_user().
--   6. Grants required client-side RPCs to authenticated role.
-- =============================================================================

-- ── 1. Revoke default and blanket privileges from anon & PUBLIC ─────────────

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Tables & sequences for authenticated and service_role (RLS enforces row boundaries)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Full function execution for service_role
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ── 2. Helper functions used by RLS and auth ────────────────────────────────

CREATE OR REPLACE FUNCTION public.my_plant_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(plant_assignments, '{}'::uuid[])
  FROM public.user_profiles
  WHERE id = auth.uid() AND status = 'Active' AND confirmed = true;
$$;

GRANT EXECUTE ON FUNCTION public.my_plant_ids() TO authenticated, service_role;

-- NOTE: only assigned plants or Admin. Manager / Data Analyst cross-plant access
-- is SELECT-only and granted by dedicated *_select_bypass policies; letting this
-- helper return true for them would also open INSERT/UPDATE/DELETE on every plant.
CREATE OR REPLACE FUNCTION public.user_has_plant_access(_plant_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = _user_id
      AND status = 'Active'
      AND confirmed = true
      AND (
        _plant_id = ANY(plant_assignments)
        OR public.is_admin(_user_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_plant_access(_plant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.user_has_plant_access(_plant_id, auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.user_has_plant_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_plant_access(uuid) TO authenticated, service_role;

-- Grant EXECUTE on role checker helpers to authenticated for RLS policy evaluation
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_or_analyst_or_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- ── 3. DB-02: Restore handle_new_user() ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_username text;
BEGIN
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.user_profiles (
    id,
    username,
    email,
    status,
    profile_complete,
    confirmed,
    plant_assignments
  ) VALUES (
    NEW.id,
    v_username,
    NEW.email,
    'Pending',
    false,
    false,
    '{}'::uuid[]
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'Operator')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── 4. DB-03: Onboarding, profile guarding, and approvals ───────────────────
 
DROP FUNCTION IF EXISTS public.complete_onboarding(text, text, uuid[], text, text, text, text, uuid);

-- Signature must match what the app calls (frontend/src/data/mutations/auth.ts,
-- integrations/supabase/types.ts) and the baseline: 7 text/uuid[] args, no
-- _full_name (user_profiles has no full_name column).
-- Hardening: does NOT set status/confirmed — only an Admin can activate/approve
-- (enforced by trg_guard_user_profile_modifications below).
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  _username text,
  _first_name text,
  _middle_name text,
  _last_name text,
  _suffix text,
  _designation text,
  _plant_assignments uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_complete boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _plant_assignments IS NULL OR array_length(_plant_assignments, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one plant assignment is required';
  END IF;

  SELECT profile_complete INTO v_complete FROM public.user_profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found for uid %', v_uid;
  END IF;
  IF v_complete THEN
    RAISE EXCEPTION 'Profile already complete; ask an Admin to change plant assignments';
  END IF;

  UPDATE public.user_profiles
  SET
    username = _username,
    first_name = _first_name,
    middle_name = _middle_name,
    last_name = _last_name,
    suffix = _suffix,
    designation = _designation,
    plant_assignments = _plant_assignments,
    profile_complete = true,
    updated_at = now()
  WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding(text, text, text, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, text, text, text, text, text, uuid[]) TO authenticated, service_role;

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

  -- For regular users on UPDATE: protect status, confirmed, and supervisor changes
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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_user_profile_changes ON public.user_profiles;
CREATE TRIGGER trg_guard_user_profile_changes
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_user_profile_modifications();

DROP FUNCTION IF EXISTS public.approve_user(uuid, boolean);
DROP FUNCTION IF EXISTS public.approve_user(uuid);

CREATE OR REPLACE FUNCTION public.approve_user(_user_id uuid, _approve boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only administrators can approve users';
  END IF;

  IF _approve THEN
    UPDATE public.user_profiles
    SET status = 'Active', confirmed = true
    WHERE id = _user_id;
  ELSE
    UPDATE public.user_profiles
    SET status = 'Suspended', confirmed = false
    WHERE id = _user_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found for uid %', _user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_user(uuid, boolean) TO authenticated, service_role;

-- ── 5. DB-12: Suspend / Reactivate RPCs ──────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_suspend_user(uuid);

CREATE OR REPLACE FUNCTION public.admin_suspend_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only administrators can suspend users';
  END IF;

  UPDATE public.user_profiles
  SET status = 'Suspended'
  WHERE id = _user_id;

  BEGIN
    DELETE FROM auth.sessions WHERE user_id = _user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore auth table permissions if not available
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_suspend_user(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_reactivate_user(uuid);

CREATE OR REPLACE FUNCTION public.admin_reactivate_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only administrators can reactivate users';
  END IF;

  UPDATE public.user_profiles
  SET status = 'Active', confirmed = true
  WHERE id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(uuid) TO authenticated, service_role;

-- ── 6. DB-11: Password Reset Hardening ───────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_set_user_password(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_set_user_password(
  _user_id uuid,
  _new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only administrators can reset user passwords';
  END IF;

  IF _new_password IS NULL OR length(_new_password) < 12 THEN
    RAISE EXCEPTION 'Password must be at least 12 characters long';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(_new_password, extensions.gen_salt('bf', 10)),
    updated_at = now()
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth user not found for uid %', _user_id;
  END IF;

  BEGIN
    DELETE FROM auth.sessions WHERE user_id = _user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
  EXCEPTION WHEN OTHERS THEN
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated, service_role;

-- ── 7. Public Sign-up / Login RPCs ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_plants_for_signup()
RETURNS TABLE(id uuid, name text, address text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, name, address
  FROM public.plants
  WHERE status = 'Active'
  ORDER BY name;
$$;

GRANT EXECUTE ON FUNCTION public.get_plants_for_signup() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_operator_peers(p_plant_id uuid)
RETURNS TABLE(
  id uuid,
  username text,
  first_name text,
  last_name text,
  plant_assignments uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, username, first_name, last_name, plant_assignments
  FROM public.user_profiles
  WHERE designation = 'Operator'
    AND status = 'Active'
    AND confirmed = true
    AND p_plant_id = ANY(plant_assignments)
  ORDER BY username;
$$;

GRANT EXECUTE ON FUNCTION public.get_operator_peers(uuid) TO anon, authenticated, service_role;
