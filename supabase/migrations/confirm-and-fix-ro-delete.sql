-- ============================================================================
-- STEP 1 -- CONFIRM: replace the email below with your actual login email,
-- then run just this block first.
-- ============================================================================
select
  u.email,
  array_agg(distinct ur.role) as roles,
  up.plant_assignments
from auth.users u
join public.user_profiles up on up.id = u.id
left join public.user_roles ur on ur.user_id = u.id
where u.email = 'PUT_YOUR_REAL_EMAIL_HERE'
group by u.email, up.plant_assignments;

-- Expect to see role = 'Manager' or 'Data Analyst' (not 'Admin'), and
-- plant_assignments either empty ({}) or missing this train's plant UUID.
-- That confirms the diagnosis below.

-- ============================================================================
-- STEP 2 -- FIX: give Manager / Data Analyst full write access to RO train
-- and pretreatment readings specifically, matching what the frontend
-- (TrainLogModal.tsx's hasFullAccess / canEditEntry) already assumes.
--
-- Scoped deliberately to just these two tables via a new helper function,
-- rather than changing user_has_plant_access() itself -- that function also
-- backs write policies on locator_readings, well_readings, power_readings,
-- pump_readings, cip_logs, incidents, and others. Broadening it globally
-- would silently hand Manager/Data Analyst unscoped write access to all of
-- those too, which is a bigger change than "fix the RO delete button."
-- ============================================================================
CREATE OR REPLACE FUNCTION public.user_has_ro_write_access(_plant_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.user_has_plant_access(_plant_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('Manager','Data Analyst')
    );
$$;

DROP POLICY IF EXISTS "ro_train_readings_plant_access" ON public.ro_train_readings;
CREATE POLICY "ro_train_readings_plant_access" ON public.ro_train_readings
  FOR ALL TO authenticated
  USING (public.user_has_ro_write_access(plant_id))
  WITH CHECK (public.user_has_ro_write_access(plant_id));

DROP POLICY IF EXISTS "ro_pretreatment_access" ON public.ro_pretreatment_readings;
CREATE POLICY "ro_pretreatment_access" ON public.ro_pretreatment_readings
  FOR ALL TO authenticated
  USING (public.user_has_ro_write_access(plant_id))
  WITH CHECK (public.user_has_ro_write_access(plant_id));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- STEP 3 -- VERIFY: re-run this and confirm both tables now show the new
-- ro_train_readings_plant_access / ro_pretreatment_access policies.
-- ============================================================================
select tablename, policyname, cmd, roles
from pg_policies
where tablename in ('ro_train_readings','ro_pretreatment_readings')
order by tablename, policyname;
