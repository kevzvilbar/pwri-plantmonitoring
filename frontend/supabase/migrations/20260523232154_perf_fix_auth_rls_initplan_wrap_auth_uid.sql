-- Migration: 20260523232154_perf_fix_auth_rls_initplan_wrap_auth_uid.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ============================================================
-- PERFORMANCE FIX 4: Wrap auth.uid() in (SELECT auth.uid())
-- in RLS policies so Postgres evaluates it once per query,
-- not once per row (init-plan optimization).
-- ============================================================

-- plants
DROP POLICY IF EXISTS plants_write_admin_manager ON public.plants;
CREATE POLICY plants_write_admin_manager ON public.plants
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role IN ('Admin', 'Manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role IN ('Admin', 'Manager')
  ));

-- user_profiles: profiles_insert_self
DROP POLICY IF EXISTS profiles_insert_self ON public.user_profiles;
CREATE POLICY profiles_insert_self ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

-- user_profiles: profiles_admin_all
DROP POLICY IF EXISTS profiles_admin_all ON public.user_profiles;
CREATE POLICY profiles_admin_all ON public.user_profiles
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role = 'Admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role = 'Admin'
  ));

-- user_roles: roles_select_self
DROP POLICY IF EXISTS roles_select_self ON public.user_roles;
CREATE POLICY roles_select_self ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- user_roles: roles_admin_all
DROP POLICY IF EXISTS roles_admin_all ON public.user_roles;
CREATE POLICY roles_admin_all ON public.user_roles
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles ur2
    WHERE ur2.user_id = (SELECT auth.uid())
      AND ur2.role = 'Admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles ur2
    WHERE ur2.user_id = (SELECT auth.uid())
      AND ur2.role = 'Admin'
  ));

-- notifications: own policies
DROP POLICY IF EXISTS notifications_own_select ON public.notifications;
CREATE POLICY notifications_own_select ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notifications_own_update ON public.notifications;
CREATE POLICY notifications_own_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notifications_insert_self ON public.notifications;
CREATE POLICY notifications_insert_self ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ai_chat_sessions
DROP POLICY IF EXISTS user_own_sessions ON public.ai_chat_sessions;
CREATE POLICY user_own_sessions ON public.ai_chat_sessions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- chat_messages
DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT TO authenticated
  USING (sender_id = (SELECT auth.uid()) OR recipient_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chat_insert ON public.chat_messages;
CREATE POLICY chat_insert ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chat_select ON public.chat_messages;
CREATE POLICY chat_select ON public.chat_messages
  FOR SELECT TO authenticated
  USING (sender_id = (SELECT auth.uid()) OR recipient_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chat_delete_own ON public.chat_messages;
CREATE POLICY chat_delete_own ON public.chat_messages
  FOR DELETE TO authenticated
  USING (sender_id = (SELECT auth.uid()));

-- login_attempts: admin readable
DROP POLICY IF EXISTS "login_attempts readable by admin" ON public.login_attempts;
CREATE POLICY "login_attempts readable by admin" ON public.login_attempts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role = 'Admin'
  ));
;
