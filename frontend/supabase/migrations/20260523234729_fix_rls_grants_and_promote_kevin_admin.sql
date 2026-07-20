-- Migration: 20260523234729_fix_rls_grants_and_promote_kevin_admin.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- 1. Restore EXECUTE grants on helper functions that RLS policies depend on
GRANT EXECUTE ON FUNCTION public.is_admin(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_or_admin(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_plant_access(UUID) TO authenticated;

-- 2. Allow any authenticated user to SELECT plants (needed for onboarding)
DROP POLICY IF EXISTS "plants_select" ON public.plants;
CREATE POLICY "plants_select"
  ON public.plants
  FOR SELECT TO authenticated
  USING (true);

-- 3. Ensure confirmed column exists
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Promote Kevin to Admin with full profile
DO $$
DECLARE kevin_id UUID;
BEGIN
  SELECT id INTO kevin_id FROM auth.users
  WHERE lower(email) = lower('kevzvilbar@gmail.com') LIMIT 1;

  IF kevin_id IS NULL THEN
    RAISE EXCEPTION 'No auth row for kevzvilbar@gmail.com — sign up first.';
  END IF;

  INSERT INTO public.user_profiles
    (id, username, first_name, last_name, designation, status, profile_complete, confirmed)
  VALUES
    (kevin_id, 'Kevz', 'Kevin', 'Vilbar', 'Admin', 'Active', TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE SET
    username         = 'Kevz',
    first_name       = 'Kevin',
    last_name        = 'Vilbar',
    designation      = 'Admin',
    status           = 'Active',
    profile_complete = TRUE,
    confirmed        = TRUE,
    updated_at       = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (kevin_id, 'Admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE 'Kevin (%) is now Admin, profile_complete=TRUE, confirmed=TRUE', kevin_id;
END $$;
;
