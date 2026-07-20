-- Migration: 20260523232054_security_fix_rls_missing_policies_and_permissive_always_true.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ============================================================
-- SECURITY FIX 3: Add RLS policies for tables that have RLS
-- enabled but no policies (currently blocks ALL access).
-- ============================================================

-- import_audit_log: admins/managers read, authenticated insert
CREATE POLICY "import_audit_log_read_admin"
  ON public.import_audit_log FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = (SELECT auth.uid())
      AND user_roles.role IN ('Admin', 'Manager')
  ));

CREATE POLICY "import_audit_log_insert_authenticated"
  ON public.import_audit_log FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- plant_multiplier_cache: internal cache, authenticated read, no direct write
CREATE POLICY "plant_multiplier_cache_read_authenticated"
  ON public.plant_multiplier_cache FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- status_checks: any authenticated user can read/insert (health-check table)
CREATE POLICY "status_checks_authenticated_all"
  ON public.status_checks FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);


-- ============================================================
-- SECURITY FIX 4: Tighten overly permissive "always true" RLS
-- policies on chemical_prices and plant config tables.
-- ============================================================

-- chemical_prices: drop the old wide-open policies; the existing
-- role-restricted chem_prices_write policy handles this correctly.
DROP POLICY IF EXISTS "Allow authenticated delete on chemical_prices" ON public.chemical_prices;
DROP POLICY IF EXISTS "Allow authenticated insert on chemical_prices" ON public.chemical_prices;
DROP POLICY IF EXISTS "Allow authenticated update on chemical_prices" ON public.chemical_prices;

-- plant_power_config: "Authenticated users can manage power config" is
-- a duplicate of the more specific plant_power_config policies. Remove it.
DROP POLICY IF EXISTS "Authenticated users can manage power config" ON public.plant_power_config;

-- plant_meter_config: the "authenticated write" policy with USING(true) gives
-- full access to all rows regardless of plant assignment. Tighten it.
DROP POLICY IF EXISTS "plant_meter_config: authenticated write" ON public.plant_meter_config;

CREATE POLICY "plant_meter_config_admin_write"
  ON public.plant_meter_config FOR ALL
  TO authenticated
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
;
