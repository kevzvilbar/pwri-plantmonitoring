-- =============================================================================
-- Migration: 20261015000001_manager_plant_scoped_review.sql
-- Description:
--   1. Managers could not approve/reject readings: the approval flow writes an
--      audit row to reading_normalizations, but its INSERT policy only allowed
--      Admin / Data Analyst, so the write failed with an RLS error
--      ("You don't have access to save this for the selected plant").
--      Managers may now write/read normalization audit rows for readings in
--      THEIR assigned plants.
--   2. Managers could see (and, via role-only UPDATE policies, touch) other
--      plants' pending readings. Review visibility and approval are now scoped
--      to assigned plants. Admin and Data Analyst keep cross-plant access.
-- =============================================================================

-- ── 1. Resolve the plant of a reading row (for audit-row policies) ───────────

CREATE OR REPLACE FUNCTION public.reading_row_plant_id(p_table text, p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plant uuid;
BEGIN
  IF p_table NOT IN (
    'locator_readings', 'well_readings', 'product_meter_readings',
    'ro_train_readings', 'ro_pretreatment_readings'
  ) THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT plant_id FROM public.%I WHERE id = $1', p_table)
    INTO v_plant USING p_id;
  RETURN v_plant;
EXCEPTION WHEN undefined_column THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reading_row_plant_id(text, uuid) TO authenticated, service_role;

-- ── 2. reading_normalizations: let Managers write/read for their own plants ──

DROP POLICY IF EXISTS "analyst_insert_normalizations" ON public.reading_normalizations;
DROP POLICY IF EXISTS "analyst_read_normalizations" ON public.reading_normalizations;
DROP POLICY IF EXISTS "reading_normalizations_insert" ON public.reading_normalizations;
DROP POLICY IF EXISTS "reading_normalizations_select" ON public.reading_normalizations;

CREATE POLICY "reading_normalizations_insert" ON public.reading_normalizations
FOR INSERT TO authenticated
WITH CHECK (
  performed_by = auth.uid()
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'Manager'::public.app_role)
      AND public.user_has_plant_access(public.reading_row_plant_id(source_table, source_id))
    )
  )
);

CREATE POLICY "reading_normalizations_select" ON public.reading_normalizations
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'Manager'::public.app_role)
    AND public.user_has_plant_access(public.reading_row_plant_id(source_table, source_id))
  )
);

-- ── 3. Readings: Managers are plant-scoped; Admin / Data Analyst stay global ─

-- Cross-plant SELECT bypass was granted to all Managers; keep it for Admin and
-- Data Analyst only. Managers read their plants via *_plant_access policies.
DROP POLICY IF EXISTS "locator_readings_analyst_read" ON public.locator_readings;
CREATE POLICY "locator_readings_analyst_read" ON public.locator_readings
FOR SELECT
USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
);

DROP POLICY IF EXISTS "well_readings_analyst_read" ON public.well_readings;
CREATE POLICY "well_readings_analyst_read" ON public.well_readings
FOR SELECT
USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
);

-- Role-only approve/update policies let any Manager modify any plant's rows.
DROP POLICY IF EXISTS "supervisor_approve_locator" ON public.locator_readings;
CREATE POLICY "supervisor_approve_locator" ON public.locator_readings
FOR UPDATE
USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  OR (public.has_role(auth.uid(), 'Manager'::public.app_role) AND public.user_has_plant_access(plant_id))
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  OR (public.has_role(auth.uid(), 'Manager'::public.app_role) AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "supervisor_approve_well" ON public.well_readings;
CREATE POLICY "supervisor_approve_well" ON public.well_readings
FOR UPDATE
USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  OR (public.has_role(auth.uid(), 'Manager'::public.app_role) AND public.user_has_plant_access(plant_id))
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  OR (public.has_role(auth.uid(), 'Manager'::public.app_role) AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "product_meter_readings_manager_update" ON public.product_meter_readings;
CREATE POLICY "product_meter_readings_manager_update" ON public.product_meter_readings
FOR UPDATE
USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  OR (public.has_role(auth.uid(), 'Manager'::public.app_role) AND public.user_has_plant_access(plant_id))
)
WITH CHECK (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'Data Analyst'::public.app_role)
  OR (public.has_role(auth.uid(), 'Manager'::public.app_role) AND public.user_has_plant_access(plant_id))
);

DROP POLICY IF EXISTS "product_meter_readings_manager_delete" ON public.product_meter_readings;
CREATE POLICY "product_meter_readings_manager_delete" ON public.product_meter_readings
FOR DELETE
USING (
  public.is_admin(auth.uid())
  OR (public.has_role(auth.uid(), 'Manager'::public.app_role) AND public.user_has_plant_access(plant_id))
);

