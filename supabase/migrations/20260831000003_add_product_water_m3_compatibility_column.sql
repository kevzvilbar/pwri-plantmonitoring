-- Add product_water_m3 alias/column to daily_plant_summary for full backward compatibility
ALTER TABLE public.daily_plant_summary
  ADD COLUMN IF NOT EXISTS product_water_m3 numeric;

-- Backfill product_water_m3 from production_m3 if null
UPDATE public.daily_plant_summary
  SET product_water_m3 = production_m3
  WHERE product_water_m3 IS NULL AND production_m3 IS NOT NULL;

-- Create or replace trigger to keep product_water_m3 and production_m3 in sync
CREATE OR REPLACE FUNCTION public.sync_daily_plant_summary_production()
RETURNS trigger AS $$
BEGIN
  IF NEW.production_m3 IS NOT NULL AND NEW.product_water_m3 IS NULL THEN
    NEW.product_water_m3 := NEW.production_m3;
  ELSIF NEW.product_water_m3 IS NOT NULL AND NEW.production_m3 IS NULL THEN
    NEW.production_m3 := NEW.product_water_m3;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dps_production ON public.daily_plant_summary;
CREATE TRIGGER trg_sync_dps_production
  BEFORE INSERT OR UPDATE ON public.daily_plant_summary
  FOR EACH ROW EXECUTE FUNCTION public.sync_daily_plant_summary_production();

