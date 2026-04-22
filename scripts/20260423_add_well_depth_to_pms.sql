-- Move well depth onto the hydraulic (PMS) record so we can log historical changes.
ALTER TABLE public.well_pms_records
  ADD COLUMN IF NOT EXISTS well_depth_m NUMERIC;
