-- =============================================================================
-- Migration: 20260818020000_sync_user_roles_to_app_metadata.sql
--
-- Keeps auth.users.raw_app_meta_data->>'role' in sync with public.user_roles,
-- so the JWT's app_metadata (not user-editable, unlike user_metadata) always
-- reflects the app's real role source of truth. Applied live via Supabase
-- MCP on 2026-08-18; this file backfills it into migrations so main and the
-- live schema don't drift apart.
--
-- Closes the gap found in the 2026-08-18 review: supabase/functions/
-- data-analysis/index.ts was fixed (by a "v0" commit) to verify the JWT and
-- read app_metadata.role instead of the previously-trusted (and
-- client-forgeable) user_metadata.role -- but nothing had ever populated
-- app_metadata.role -- 0 of 36 users had it set, so the function would 403
-- every real user the moment anything called it. Verified live after
-- applying: 33/33 users with a user_roles row got the matching claim, 0
-- mismatches, and a live INSERT/DELETE test on a real user confirmed the
-- trigger fires both ways (and reverts cleanly), not just the one-time
-- backfill.
--
-- Priority when a user has more than one row in user_roles (schema allows
-- it via UNIQUE(user_id, role); no user currently has more than one, but
-- this is future-proofing): Admin > Data Analyst > Manager > Technician >
-- Operator. Mirrors useAuth.tsx's own precedence, where isManager/
-- isDataAnalyst are both "isAdmin OR roles.includes(...)" -- i.e. Admin is
-- already treated as a superset of Manager/Data-Analyst capabilities
-- everywhere else in the app, and data-analysis/index.ts's own
-- ALLOWED_ROLES (Admin, Data Analyst) / READ_ROLES (+ Manager) sets follow
-- the same shape.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_user_role_to_app_metadata(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role::text INTO v_role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role::text
    WHEN 'Admin' THEN 1
    WHEN 'Data Analyst' THEN 2
    WHEN 'Manager' THEN 3
    WHEN 'Technician' THEN 4
    WHEN 'Operator' THEN 5
    ELSE 6
  END
  LIMIT 1;

  IF v_role IS NULL THEN
    -- No role rows left for this user (all deleted) -- remove the claim
    -- entirely rather than leave a stale value; data-analysis/index.ts
    -- already treats a missing role as 'Staff' (no elevated access).
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) - 'role'
    WHERE id = _user_id;
  ELSE
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role)
    WHERE id = _user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_user_role_to_app_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_user_role_to_app_metadata(OLD.user_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.sync_user_role_to_app_metadata(NEW.user_id);
    -- user_id itself is editable in principle even though it's not
    -- expected in normal use -- re-sync the old owner too if it changed,
    -- so they don't keep a stale elevated claim.
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      PERFORM public.sync_user_role_to_app_metadata(OLD.user_id);
    END IF;
    RETURN NEW;
  ELSE
    PERFORM public.sync_user_role_to_app_metadata(NEW.user_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_roles_sync_app_metadata ON public.user_roles;
CREATE TRIGGER trg_user_roles_sync_app_metadata
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_user_role_to_app_metadata();

-- Backfill: sync every user who currently has a role row (the 0-of-36 gap).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.user_roles LOOP
    PERFORM public.sync_user_role_to_app_metadata(r.user_id);
  END LOOP;
END;
$$;
