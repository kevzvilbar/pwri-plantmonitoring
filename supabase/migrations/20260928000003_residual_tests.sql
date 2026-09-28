-- 20260928000003_residual_tests.sql
-- Extend chemical_residual_samples with method, point role, and reagent details

ALTER TABLE public.chemical_residual_samples
  ADD COLUMN IF NOT EXISTS tested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS tested_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS method text CHECK (method IN ('dpd_free', 'dpd_total', 'oto', 'online')),
  ADD COLUMN IF NOT EXISTS parameter text CHECK (parameter IN ('free', 'total')),
  ADD COLUMN IF NOT EXISTS point_role text,
  ADD COLUMN IF NOT EXISTS reagent_catalog_id uuid REFERENCES public.chemical_catalog(id),
  ADD COLUMN IF NOT EXISTS reagent_qty numeric;

-- Trigger to recompute product_water_free_cl_ppm based specifically on 'product' point_role
CREATE OR REPLACE FUNCTION public.fn_sync_product_residual_ppm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log_id uuid;
  v_avg_ppm numeric;
BEGIN
  v_log_id := COALESCE(NEW.dosing_log_id, OLD.dosing_log_id);
  IF v_log_id IS NULL THEN RETURN NULL; END IF;

  SELECT avg(residual_ppm)
  INTO v_avg_ppm
  FROM public.chemical_residual_samples
  WHERE dosing_log_id = v_log_id
    AND residual_ppm IS NOT NULL
    AND (point_role = 'product' OR point_role IS NULL);

  UPDATE public.chemical_dosing_logs
  SET product_water_free_cl_ppm = v_avg_ppm
  WHERE id = v_log_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_residual_ppm ON public.chemical_residual_samples;
CREATE TRIGGER trg_sync_product_residual_ppm
  AFTER INSERT OR UPDATE OR DELETE ON public.chemical_residual_samples
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_product_residual_ppm();
