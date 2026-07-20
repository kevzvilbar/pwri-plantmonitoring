-- Migration: 20260524000942_security_fixes_safe_rls_cleanup.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ================================================================
-- SAFE SECURITY FIXES — zero disruption to active sessions
-- RLS changes are atomic and transparent to logged-in users
-- ================================================================

-- FIX 1: plants_write_admin_manager — inline user_roles query is fragile.
-- Replace with SECURITY DEFINER helper so it can never recurse.
DROP POLICY IF EXISTS "plants_write_admin_manager" ON public.plants;
CREATE POLICY "plants_write_admin_manager"
  ON public.plants
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- FIX 2: profiles_admin_all — same inline user_roles query risk.
DROP POLICY IF EXISTS "profiles_admin_all" ON public.user_profiles;
CREATE POLICY "profiles_admin_all"
  ON public.user_profiles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- FIX 3: Remove duplicate plants SELECT policies (keep one clean one).
DROP POLICY IF EXISTS "plants_select" ON public.plants;
DROP POLICY IF EXISTS "plants_select_authenticated" ON public.plants;
-- "Plants are publicly readable" (USING true, public role) stays —
-- it's the original intentional one and covers all users.

-- FIX 4: "authenticated users can read profiles for operator log" is
-- USING(true) — exposes ALL profiles to every logged-in user.
-- profiles_select_self + profiles_select_manager already cover legitimate
-- access. Drop the blanket one.
DROP POLICY IF EXISTS "authenticated users can read profiles for operator log" ON public.user_profiles;

-- FIX 5: "user_profiles admin full update" is on the `public` role
-- (should be `authenticated`). Tighten it.
DROP POLICY IF EXISTS "user_profiles admin full update" ON public.user_profiles;
CREATE POLICY "user_profiles admin full update"
  ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
;
