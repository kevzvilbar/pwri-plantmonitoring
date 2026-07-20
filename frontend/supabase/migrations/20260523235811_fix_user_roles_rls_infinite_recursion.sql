-- Migration: 20260523235811_fix_user_roles_rls_infinite_recursion.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- THE BUG: roles_admin_all policy queries user_roles FROM WITHIN a user_roles policy
-- → infinite recursion on every request. Fix: use the SECURITY DEFINER is_admin()
-- function instead, which bypasses RLS and breaks the cycle.

DROP POLICY IF EXISTS "roles_admin_all" ON public.user_roles;

CREATE POLICY "roles_admin_all"
  ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
;
