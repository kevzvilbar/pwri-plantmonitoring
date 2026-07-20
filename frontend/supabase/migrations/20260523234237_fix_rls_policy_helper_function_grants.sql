-- Migration: 20260523234237_fix_rls_policy_helper_function_grants.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ============================================================
-- FIX: Restore EXECUTE grants on helper functions used
-- directly inside RLS policy expressions. When these functions
-- are referenced in USING/WITH CHECK clauses, the calling role
-- must have EXECUTE permission or the policy evaluation fails.
-- We revoked PUBLIC too broadly — these need to stay callable
-- by authenticated users (and public for policies on public-role rows).
-- ============================================================

-- Used in: profiles_select_manager policy (authenticated)
-- Used in: user_profiles admin full update policy (public role)
GRANT EXECUTE ON FUNCTION public.is_admin(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid)              TO anon;

GRANT EXECUTE ON FUNCTION public.is_manager_or_admin(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin(uuid)   TO anon;

-- has_role is similarly used as an inline helper in policies
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon;

-- user_has_plant_access is used in plant-scoped reading policies
GRANT EXECUTE ON FUNCTION public.user_has_plant_access(uuid) TO authenticated;

-- resolve_plant_multiplier is called internally by trigger functions
-- so it needs to be callable by authenticated users too
GRANT EXECUTE ON FUNCTION public.resolve_plant_multiplier(uuid, integer) TO authenticated;
;
