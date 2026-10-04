-- Admin MFA (aal2) enforcement, database side.
--
-- WHY: the SPA talks to Postgres directly with a public key, so "Admins need
-- MFA" is only real if the DATABASE refuses admin writes from an aal1 session.
-- A UI-only prompt can be bypassed with the browser console.
--
-- ROLLOUT (safe by default): everything below is DORMANT until
--   UPDATE public.security_settings SET value = true WHERE key = 'require_admin_mfa';
-- Flip it only after every Admin has enrolled TOTP (docs/SECURITY-ROLLOUT.md).
-- Rollback is the same statement with `false`.
--
-- Service-role callers (edge functions, cron workflows, SQL editor) have no
-- auth.uid(), so they are never affected.

-- ── 1. Switch ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_settings (
  key        text PRIMARY KEY,
  value      boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.security_settings FROM anon, authenticated;
GRANT SELECT ON public.security_settings TO authenticated;

DROP POLICY IF EXISTS security_settings_admin_select ON public.security_settings;
CREATE POLICY security_settings_admin_select ON public.security_settings
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
-- No INSERT/UPDATE/DELETE policies: only service_role / SQL editor can change it.

INSERT INTO public.security_settings (key, value)
VALUES ('require_admin_mfa', false)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mfa_required()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.security_settings WHERE key = 'require_admin_mfa'),
    false
  );
$$;

-- True when MFA is not required, or the caller's JWT carries aal2.
CREATE OR REPLACE FUNCTION public.admin_mfa_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT public.admin_mfa_required()
      OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- True for everyone except an Admin on a session that does not satisfy MFA.
CREATE OR REPLACE FUNCTION public.admin_write_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT COALESCE(public.is_admin(auth.uid()), false)
      OR public.admin_mfa_ok();
$$;

CREATE OR REPLACE FUNCTION public.assert_admin_mfa()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_write_allowed() THEN
    RAISE EXCEPTION 'Multi-factor authentication (aal2) is required for administrator actions'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mfa_required()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mfa_ok()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_write_allowed() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_admin_mfa()    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mfa_required()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_mfa_ok()        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_write_allowed() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_admin_mfa()    TO authenticated, service_role;

-- ── 3. Restrictive write guards on every RLS-enabled public table ───────────
-- RESTRICTIVE policies are ANDed with the existing permissive ones, so no
-- existing policy has to be rewritten. Re-run apply_admin_mfa_guards() in the
-- migration that adds any new table (supabase/runbooks/admin-authz-verify.sql
-- lists tables that are missing a guard).
CREATE OR REPLACE FUNCTION public.apply_admin_mfa_guards()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND c.relname <> 'security_settings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_mfa_guard_ins ON public.%I', r.relname);
    EXECUTE format('DROP POLICY IF EXISTS admin_mfa_guard_upd ON public.%I', r.relname);
    EXECUTE format('DROP POLICY IF EXISTS admin_mfa_guard_del ON public.%I', r.relname);

    EXECUTE format(
      'CREATE POLICY admin_mfa_guard_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
         WITH CHECK ((SELECT public.admin_write_allowed()))', r.relname);
    EXECUTE format(
      'CREATE POLICY admin_mfa_guard_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
         USING ((SELECT public.admin_write_allowed()))
         WITH CHECK ((SELECT public.admin_write_allowed()))', r.relname);
    EXECUTE format(
      'CREATE POLICY admin_mfa_guard_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
         USING ((SELECT public.admin_write_allowed()))', r.relname);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_admin_mfa_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_admin_mfa_guards() TO service_role;

SELECT public.apply_admin_mfa_guards();

-- ── 4. SECURITY DEFINER admin RPCs bypass RLS, so they need an explicit check ─
-- Targets plpgsql SECURITY DEFINER functions that start with the repo's standard
-- "IF NOT public.is_admin(auth.uid())" gate (admin_suspend_user,
-- admin_reactivate_user, admin_set_user_password, ...). The assertion is
-- inserted right after the first BEGIN. Idempotent: skips functions that
-- already call assert_admin_mfa().
DO $$
DECLARE
  f   record;
  def text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language  l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND l.lanname = 'plpgsql'
      AND p.prosecdef
      AND p.prosrc ILIKE '%IF NOT public.is_admin(auth.uid())%'
      AND p.prosrc NOT ILIKE '%assert_admin_mfa%'
      AND p.proname <> 'assert_admin_mfa'
  LOOP
    def := pg_get_functiondef(f.oid);
    def := regexp_replace(def, '\mBEGIN\M', E'BEGIN\n  PERFORM public.assert_admin_mfa();', 'i');
    EXECUTE def;
    RAISE NOTICE 'admin MFA assertion added to public.%', f.proname;
  END LOOP;
END;
$$;
