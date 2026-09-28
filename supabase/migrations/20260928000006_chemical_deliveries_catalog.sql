-- 20260928000006_chemical_deliveries_catalog.sql
-- Add catalog_id and qty_base to chemical_deliveries

ALTER TABLE public.chemical_deliveries
  ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES public.chemical_catalog(id),
  ADD COLUMN IF NOT EXISTS qty_base numeric CHECK (qty_base > 0);

-- Trigger to compute qty_base from catalog unit conversion factors
CREATE OR REPLACE FUNCTION public.fn_sync_chemical_delivery_qty_base()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_factor numeric := 1.0;
  v_cat_base_unit text;
BEGIN
  IF NEW.catalog_id IS NOT NULL THEN
    SELECT base_unit INTO v_cat_base_unit
    FROM public.chemical_catalog
    WHERE id = NEW.catalog_id;

    -- Look up unit factor (plant-scoped row first, then global)
    SELECT factor_to_base INTO v_factor
    FROM public.chemical_catalog_units
    WHERE catalog_id = NEW.catalog_id
      AND lower(unit_label) = lower(NEW.unit)
      AND (plant_id = NEW.plant_id OR plant_id IS NULL)
    ORDER BY plant_id NULLS LAST
    LIMIT 1;

    IF v_factor IS NULL THEN
      -- If unit matches the catalog base_unit, factor is 1.0
      IF lower(NEW.unit) = lower(v_cat_base_unit) THEN
        v_factor := 1.0;
      ELSE
        v_factor := 1.0;
      END IF;
    END IF;

    NEW.qty_base := NEW.quantity * v_factor;
  ELSE
    NEW.qty_base := NEW.quantity;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_chemical_delivery_qty_base ON public.chemical_deliveries;
CREATE TRIGGER trg_sync_chemical_delivery_qty_base
  BEFORE INSERT OR UPDATE ON public.chemical_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_chemical_delivery_qty_base();
