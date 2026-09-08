-- =============================================================================
-- Migration: 20260831000002_security_hardening_search_paths.sql
-- Security Hardening:
-- Sets explicit search_path on public SECURITY DEFINER database functions to
-- prevent search_path hijacking / injection (CWE-426 / CWE-427).
-- =============================================================================

-- Ensure search_path is locked on public SECURITY DEFINER helper functions
DO $$
DECLARE
  func_record RECORD;
BEGIN
  FOR func_record IN
    SELECT n.nspname AS schema_name, p.proname AS func_name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_temp;',
        func_record.schema_name,
        func_record.func_name,
        func_record.args
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping search_path update on %.%(%): %',
        func_record.schema_name, func_record.func_name, func_record.args, SQLERRM;
    END;
  END LOOP;
END $$;

