-- Read-only authorization audit. Run in the Supabase SQL editor (or psql) after
-- applying migration 20261004000003_admin_mfa_enforcement.sql, and again after
-- every migration that adds a table or an admin RPC. Every section should return
-- ZERO rows unless it says otherwise.

-- 1. RLS-enabled tables missing the admin MFA write guards
--    (fix: SELECT public.apply_admin_mfa_guards(); in your migration)
SELECT c.relname AS table_missing_guard
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity
  AND c.relname <> 'security_settings'
  AND (SELECT count(*) FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = c.relname
         AND p.policyname IN ('admin_mfa_guard_ins','admin_mfa_guard_upd','admin_mfa_guard_del')) < 3;

-- 2. Public tables with RLS disabled (anything here is readable/writable by its grants alone)
SELECT c.relname AS table_without_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;

-- 3. SECURITY DEFINER functions without a pinned search_path
SELECT p.oid::regprocedure AS definer_fn_without_search_path
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%');

-- 4. Admin-only SECURITY DEFINER RPCs that do not assert MFA
SELECT p.oid::regprocedure AS admin_rpc_without_mfa_assert
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND p.prosrc ILIKE '%IF NOT public.is_admin(auth.uid())%'
  AND p.prosrc NOT ILIKE '%assert_admin_mfa%';

-- 5. Enforcement switch (expected: false before rollout, true after)
SELECT key, value, updated_at FROM public.security_settings WHERE key = 'require_admin_mfa';

-- 6. Admin accounts and whether each has a verified TOTP factor.
--    Do NOT flip the switch until every row shows totp_enrolled = true.
SELECT up.id, up.username, EXISTS (
         SELECT 1 FROM auth.mfa_factors f
         WHERE f.user_id = up.id AND f.status = 'verified' AND f.factor_type = 'totp'
       ) AS totp_enrolled
FROM public.user_roles ur
JOIN public.user_profiles up ON up.id = ur.user_id
WHERE ur.role::text = 'Admin';
