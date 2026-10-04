-- =============================================================================
-- Migration: 20261004000002_security_hardening_costs_and_rpcs.sql
-- Description:
--   1. SEC-01: Hardens production_costs RLS policies so regular Operators
--      cannot modify financial / OPEX / tariff calculations, while maintaining
--      read access for plant staff. Writes restricted to Manager/Admin/Analyst.
--   2. SEC-02: Revokes public/anon/authenticated execution on nightly batch
--      rollups (fn_compute_daily_plant_summary) to prevent DoS/unauthorized invocation.
-- =============================================================================

-- ── 1. production_costs RLS Hardening ────────────────────────────────────────

DROP POLICY IF EXISTS "production_costs_access" ON public.production_costs;
DROP POLICY IF EXISTS "production_costs_read" ON public.production_costs;
DROP POLICY IF EXISTS "production_costs_write" ON public.production_costs;
DROP POLICY IF EXISTS "production_costs_select" ON public.production_costs;

-- Read policy: Any active, confirmed user assigned to the plant (or Admin/Analyst bypass)
CREATE POLICY "production_costs_select" ON public.production_costs
FOR SELECT TO authenticated
USING (public.user_has_plant_access(plant_id));

-- Write policy: Only Managers, Admins, or Data Analysts assigned to the plant
CREATE POLICY "production_costs_write" ON public.production_costs
FOR ALL TO authenticated
USING (
  (public.is_manager_or_admin(auth.uid()) OR public.has_role(auth.uid(), 'Data Analyst'))
  AND public.user_has_plant_access(plant_id)
)
WITH CHECK (
  (public.is_manager_or_admin(auth.uid()) OR public.has_role(auth.uid(), 'Data Analyst'))
  AND public.user_has_plant_access(plant_id)
);

-- ── 2. Batch Function Hardening ──────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.fn_compute_daily_plant_summary(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_daily_plant_summary(date) TO service_role;
