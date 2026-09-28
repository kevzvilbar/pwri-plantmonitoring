-- 20260928000006_chemical_deliveries_catalog.sql
-- Add catalog_id and qty_base to chemical_deliveries

ALTER TABLE public.chemical_deliveries
  ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES public.chemical_catalog(id),
  ADD COLUMN IF NOT EXISTS qty_base numeric CHECK (qty_base > 0);

-- Fills qty_base only when the client did not supply one (AddStockDialog already converts
-- packages to base units). The original draft unconditionally overwrote qty_base with
-- quantity x 1.0 whenever no chemical_catalog_units row existed (none are seeded), which
-- silently turned e.g. 5 drums (1000 L) into 5 L of stock.
CREATE OR REPLACE FUNCTION public.fn_sync_chemical_delivery_qty_base()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_factor numeric;
  v_base_unit text;
  v_recalc boolean := false;
BEGIN
  IF NEW.qty_base IS NULL THEN
    v_recalc := true;
  ELSIF TG_OP = 'UPDATE' THEN
    v_recalc := NEW.qty_base IS NOT DISTINCT FROM OLD.qty_base
      AND (NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.unit IS DISTINCT FROM OLD.unit
           OR NEW.catalog_id IS DISTINCT FROM OLD.catalog_id);
  END IF;

  IF NOT v_recalc THEN
    RETURN NEW;
  END IF;

  IF NEW.catalog_id IS NULL THEN
    NEW.qty_base := NEW.quantity;
    RETURN NEW;
  END IF;

  SELECT base_unit INTO v_base_unit FROM public.chemical_catalog WHERE id = NEW.catalog_id;

  IF lower(NEW.unit) = lower(v_base_unit) THEN
    v_factor := 1.0;
  ELSE
    SELECT factor_to_base INTO v_factor
    FROM public.chemical_catalog_units
    WHERE catalog_id = NEW.catalog_id
      AND lower(unit_label) = lower(NEW.unit)
      AND (plant_id = NEW.plant_id OR plant_id IS NULL)
    ORDER BY plant_id NULLS LAST
    LIMIT 1;
  END IF;

  IF v_factor IS NULL THEN
    RAISE EXCEPTION 'No unit conversion for "%" on catalog item % - supply qty_base or add a chemical_catalog_units row', NEW.unit, NEW.catalog_id
      USING ERRCODE = '22023';
  END IF;

  NEW.qty_base := NEW.quantity * v_factor;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_chemical_delivery_qty_base ON public.chemical_deliveries;
CREATE TRIGGER trg_sync_chemical_delivery_qty_base
  BEFORE INSERT OR UPDATE ON public.chemical_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_chemical_delivery_qty_base();
