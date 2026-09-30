-- =============================================================================
-- Migration: 20260930000003_rls_hardening_and_policies.sql
-- Description:
--   1. DB-05: Eliminates anon-reachable RLS policies on user_profiles,
--      correction_requests, plants, and filter_unit_prices.
--   2. DB-08: Hardens cross-plant RLS on production_costs, product_meter_readings,
--      product_meters, well_blending, locators, and shift_duty_log.
--   3. DB-09: Fixes filter_unit_prices_write policy to use is_manager_or_admin().
--   4. Eliminates duplicate policies on chat_messages and locators.
--   5. Hardens audit log tables against forgery.
-- =============================================================================

-- ── 1. user_profiles RLS ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Operators can view same-plant operators" ON public.user_profiles;
DROP POLICY IF EXISTS "profiles_select_colleagues" ON public.user_profiles;

CREATE POLICY "profiles_select_colleagues" ON public.user_profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.is_manager_or_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst')
  OR (status = 'Active' AND confirmed = true AND plant_assignments && public.my_plant_ids())
);

-- ── 2. correction_requests RLS ──────────────────────────────────────────────

DROP POLICY IF EXISTS "cr_manager_all" ON public.correction_requests;
DROP POLICY IF EXISTS "cr_operator_insert" ON public.correction_requests;
DROP POLICY IF EXISTS "cr_operator_select" ON public.correction_requests;
DROP POLICY IF EXISTS "correction_requests_delete_manager" ON public.correction_requests;

CREATE POLICY "correction_requests_delete_manager" ON public.correction_requests
FOR DELETE TO authenticated
USING (
  public.is_manager_or_admin(auth.uid())
  AND public.user_has_plant_access(plant_id)
);

-- ── 3. plants RLS ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Plants are publicly readable" ON public.plants;
DROP POLICY IF EXISTS "plants_select_authenticated" ON public.plants;

CREATE POLICY "plants_select_authenticated" ON public.plants
FOR SELECT TO authenticated
USING (true);

-- ── 4. filter_unit_prices RLS (DB-09) ───────────────────────────────────────

DROP POLICY IF EXISTS "filter_unit_prices_select" ON public.filter_unit_prices;
DROP POLICY IF EXISTS "filter_unit_prices_write" ON public.filter_unit_prices;

CREATE POLICY "filter_unit_prices_select" ON public.filter_unit_prices
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "filter_unit_prices_write" ON public.filter_unit_prices
FOR ALL TO authenticated
USING (public.is_manager_or_admin(auth.uid()))
WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- ── 5. production_costs RLS ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "production_costs_read" ON public.production_costs;
DROP POLICY IF EXISTS "production_costs_write" ON public.production_costs;
DROP POLICY IF EXISTS "production_costs_access" ON public.production_costs;

CREATE POLICY "production_costs_access" ON public.production_costs
FOR ALL TO authenticated
USING (public.user_has_plant_access(plant_id))
WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 6. product_meter_readings RLS ───────────────────────────────────────────

DROP POLICY IF EXISTS "product_meter_readings: authenticated insert" ON public.product_meter_readings;
DROP POLICY IF EXISTS "product_meter_readings: authenticated read" ON public.product_meter_readings;

-- ── 7. product_meters RLS ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "product_meters: authenticated read" ON public.product_meters;
DROP POLICY IF EXISTS "product_meters: manager/admin write" ON public.product_meters;
DROP POLICY IF EXISTS "product_meters_write" ON public.product_meters;

CREATE POLICY "product_meters_write" ON public.product_meters
FOR ALL TO authenticated
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- ── 8. product_meter_audit_log & production_calc_log RLS ─────────────────────

DROP POLICY IF EXISTS "manager/admin read audit log" ON public.product_meter_audit_log;
DROP POLICY IF EXISTS "product_meter_audit_log_select" ON public.product_meter_audit_log;

CREATE POLICY "product_meter_audit_log_select" ON public.product_meter_audit_log
FOR SELECT TO authenticated
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "manager/admin read calc log" ON public.production_calc_log;
DROP POLICY IF EXISTS "production_calc_log_select" ON public.production_calc_log;

CREATE POLICY "production_calc_log_select" ON public.production_calc_log
FOR SELECT TO authenticated
USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- ── 9. well_blending RLS ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "read well_blending" ON public.well_blending;

CREATE POLICY "read well_blending" ON public.well_blending
FOR SELECT TO authenticated
USING (public.user_has_plant_access(plant_id));

-- ── 10. locators RLS ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "users see assigned plants" ON public.locators;
DROP POLICY IF EXISTS "locators_select" ON public.locators;

-- ── 11. shift_duty_log RLS ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "shift_duty_log_select_authenticated" ON public.shift_duty_log;
DROP POLICY IF EXISTS "shift_duty_log_insert_authenticated" ON public.shift_duty_log;
DROP POLICY IF EXISTS "shift_duty_log_update_authenticated" ON public.shift_duty_log;

CREATE POLICY "shift_duty_log_select_authenticated" ON public.shift_duty_log
FOR SELECT TO authenticated
USING (public.user_has_plant_access(plant_id));

CREATE POLICY "shift_duty_log_insert_authenticated" ON public.shift_duty_log
FOR INSERT TO authenticated
WITH CHECK (
  public.user_has_plant_access(plant_id)
  AND (auth.uid() = operator_id OR auth.uid() = partner_operator_id OR auth.uid() = confirmed_by)
);

CREATE POLICY "shift_duty_log_update_authenticated" ON public.shift_duty_log
FOR UPDATE TO authenticated
USING (
  public.user_has_plant_access(plant_id)
  AND (auth.uid() = operator_id OR auth.uid() = partner_operator_id OR auth.uid() = ended_by)
)
WITH CHECK (
  public.user_has_plant_access(plant_id)
  AND (auth.uid() = operator_id OR auth.uid() = partner_operator_id OR auth.uid() = ended_by)
);

-- ── 12. chat_messages deduplication ─────────────────────────────────────────

DROP POLICY IF EXISTS "chat_insert" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_select" ON public.chat_messages;

-- ── 13. Audit tables insertion hardening ────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can insert entity status audit log" ON public.entity_status_audit_log;
DROP POLICY IF EXISTS "entity_status_audit_log_insert" ON public.entity_status_audit_log;

CREATE POLICY "entity_status_audit_log_insert" ON public.entity_status_audit_log
FOR INSERT TO authenticated
WITH CHECK (actor_user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can insert product meter audit log" ON public.product_meter_audit_log;
DROP POLICY IF EXISTS "product_meter_audit_log_insert" ON public.product_meter_audit_log;

CREATE POLICY "product_meter_audit_log_insert" ON public.product_meter_audit_log
FOR INSERT TO authenticated
WITH CHECK (actor_user_id = auth.uid() AND public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "reading_edit_audit_log_insert" ON public.reading_edit_audit_log;

CREATE POLICY "reading_edit_audit_log_insert" ON public.reading_edit_audit_log
FOR INSERT TO authenticated
WITH CHECK (
  actor_user_id = auth.uid()
  AND (plant_id IS NULL OR public.user_has_plant_access(plant_id))
);
