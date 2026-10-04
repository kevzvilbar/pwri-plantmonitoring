-- =============================================================================
-- Migration: 20261004000004_roles_visible_to_plant_colleagues.sql
-- Description:
--   Fix: an Operator opening People & Staff Management > KPI saw almost no
--   other operators.
--
--   get_all_user_roles() was SECURITY INVOKER, so user_roles RLS applied and an
--   Operator received only their own role row (roles_select_self). The staff
--   list (get_all_staff_profiles, SECURITY DEFINER) returns everyone, so the
--   KPI tab had 34 people but could only tell who was an Operator for one of
--   them.
--
--   New behaviour mirrors the user_profiles policy profiles_select_colleagues:
--     - Admin / Manager / Data Analyst: every role row (as before, via RLS)
--     - everyone else: their own role rows, plus the role rows of Active,
--       confirmed people who share at least one plant with them
--   Operators never receive roles of people at other plants.
--
--   SECURITY DEFINER is required because user_roles RLS would otherwise hide
--   the colleague rows. Signature and return shape are unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_all_user_roles()
RETURNS TABLE (user_id uuid, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ur.user_id, ur.role::text
  FROM public.user_roles ur
  WHERE auth.uid() IS NOT NULL
    AND (
      ur.user_id = auth.uid()
      OR public.is_manager_or_admin(auth.uid())
      OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = ur.user_id
          AND up.status = 'Active'
          AND up.confirmed = true
          AND up.plant_assignments && public.my_plant_ids()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_all_user_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_all_user_roles() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_all_user_roles() IS
  'Role rows visible to the caller: all for Admin/Manager/Data Analyst, otherwise own plus Active confirmed plant colleagues. SECURITY DEFINER; mirrors profiles_select_colleagues.';
