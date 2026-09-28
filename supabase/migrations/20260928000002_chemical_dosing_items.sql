-- 20260928000002_chemical_dosing_items.sql
-- Granular chemical dosing items table and statement-level rollup trigger

ALTER TABLE public.chemical_dosing_logs
  ADD COLUMN IF NOT EXISTS has_items boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.chemical_dosing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosing_log_id uuid NOT NULL REFERENCES public.chemical_dosing_logs(id) ON DELETE CASCADE,
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  catalog_id uuid NOT NULL REFERENCES public.chemical_catalog(id),
  chemical_name text NOT NULL,
  entry_qty numeric CHECK (entry_qty >= 0),
  entry_unit text,
  factor_to_base numeric DEFAULT 1 CHECK (factor_to_base IS NULL OR factor_to_base > 0),
  entry_mode text NOT NULL DEFAULT 'containers' CHECK (entry_mode IN ('containers', 'batch', 'tank_level')),
  day_tank_id uuid REFERENCES public.plant_day_tanks(id),
  mode_conflict boolean NOT NULL DEFAULT false,
  qty numeric NOT NULL CHECK (qty >= 0),
  qty_extra numeric NOT NULL DEFAULT 0 CHECK (qty_extra >= 0),
  extra_reason text,
  unit text NOT NULL,
  strength_pct numeric,
  density_kg_per_l numeric,
  product_kg numeric,
  active_kg numeric,
  unit_price numeric,
  line_cost numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chemical_dosing_items_plant ON public.chemical_dosing_items (plant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chemical_dosing_items_log ON public.chemical_dosing_items (dosing_log_id);

ALTER TABLE public.chemical_dosing_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dosing_items_read_plant_access" ON public.chemical_dosing_items;
DROP POLICY IF EXISTS "dosing_items_write_plant_access" ON public.chemical_dosing_items;
DROP POLICY IF EXISTS "dosing_items_plant_access" ON public.chemical_dosing_items;
CREATE POLICY "dosing_items_plant_access" ON public.chemical_dosing_items
  FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- Function to roll up items to parent chemical_dosing_logs
CREATE OR REPLACE FUNCTION public.fn_rollup_chemical_dosing_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log_id uuid;
  v_log_ids uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT dosing_log_id) INTO v_log_ids FROM old_table WHERE dosing_log_id IS NOT NULL;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT dosing_log_id) INTO v_log_ids FROM new_table WHERE dosing_log_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT id) INTO v_log_ids FROM (
      SELECT dosing_log_id AS id FROM new_table WHERE dosing_log_id IS NOT NULL
      UNION
      SELECT dosing_log_id AS id FROM old_table WHERE dosing_log_id IS NOT NULL
    ) s;
  END IF;

  IF v_log_ids IS NULL OR array_length(v_log_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  FOREACH v_log_id IN ARRAY v_log_ids LOOP
    UPDATE public.chemical_dosing_logs l
    SET
      has_items = EXISTS (SELECT 1 FROM public.chemical_dosing_items WHERE dosing_log_id = v_log_id),
      calculated_cost = COALESCE((
        SELECT sum(line_cost) FROM public.chemical_dosing_items WHERE dosing_log_id = v_log_id
      ), 0),
      chlorine_kg = COALESCE((
        SELECT sum(COALESCE(active_kg, product_kg, qty))
        FROM public.chemical_dosing_items i
        JOIN public.chemical_catalog c ON c.id = i.catalog_id
        WHERE i.dosing_log_id = v_log_id AND c.family = 'chlorine'
      ), 0),
      smbs_kg = COALESCE((
        SELECT sum(COALESCE(product_kg, qty))
        FROM public.chemical_dosing_items i
        JOIN public.chemical_catalog c ON c.id = i.catalog_id
        WHERE i.dosing_log_id = v_log_id AND c.family = 'smbs'
      ), 0),
      anti_scalant_l = COALESCE((
        SELECT sum(
          CASE
            WHEN i.unit = 'L' THEN i.qty
            WHEN i.density_kg_per_l > 0 THEN i.qty / i.density_kg_per_l
            ELSE i.qty
          END
        )
        FROM public.chemical_dosing_items i
        JOIN public.chemical_catalog c ON c.id = i.catalog_id
        WHERE i.dosing_log_id = v_log_id AND c.family = 'anti_scalant'
      ), 0),
      soda_ash_kg = COALESCE((
        SELECT sum(COALESCE(product_kg, qty))
        FROM public.chemical_dosing_items i
        JOIN public.chemical_catalog c ON c.id = i.catalog_id
        WHERE i.dosing_log_id = v_log_id AND c.family = 'soda_ash'
      ), 0),
      free_chlorine_reagent_pcs = COALESCE((
        SELECT sum(i.qty + i.qty_extra)
        FROM public.chemical_dosing_items i
        JOIN public.chemical_catalog c ON c.id = i.catalog_id
        WHERE i.dosing_log_id = v_log_id AND c.family = 'reagent' AND c.base_unit = 'pcs'
      ), 0)
    WHERE l.id = v_log_id;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_chemical_dosing_items_insert_rollup ON public.chemical_dosing_items;
CREATE TRIGGER trg_chemical_dosing_items_insert_rollup
  AFTER INSERT ON public.chemical_dosing_items
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.fn_rollup_chemical_dosing_items();

DROP TRIGGER IF EXISTS trg_chemical_dosing_items_update_rollup ON public.chemical_dosing_items;
CREATE TRIGGER trg_chemical_dosing_items_update_rollup
  AFTER UPDATE ON public.chemical_dosing_items
  REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.fn_rollup_chemical_dosing_items();

DROP TRIGGER IF EXISTS trg_chemical_dosing_items_delete_rollup ON public.chemical_dosing_items;
CREATE TRIGGER trg_chemical_dosing_items_delete_rollup
  AFTER DELETE ON public.chemical_dosing_items
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.fn_rollup_chemical_dosing_items();
