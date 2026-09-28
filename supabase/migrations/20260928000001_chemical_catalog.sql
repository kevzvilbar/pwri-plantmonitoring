-- 20260928000001_chemical_catalog.sql
-- Chemical Product Catalog with forms, base units, strength/density basis, and day tanks

CREATE TABLE IF NOT EXISTS public.chemical_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  price_key text NOT NULL UNIQUE,
  legacy_name text,
  family text NOT NULL,
  category text NOT NULL CHECK (category IN ('process', 'test_consumable')),
  form text,
  base_unit text NOT NULL CHECK (base_unit IN ('kg', 'L', 'pcs', 'mL')),
  strength_pct numeric CHECK (strength_pct BETWEEN 0 AND 100),
  strength_basis text CHECK (strength_basis IN ('as_product', 'w/w', 'w/v')),
  density_kg_per_l numeric CHECK (density_kg_per_l > 0),
  reference_basis text,
  methods text[],
  sample_volume_ml numeric,
  qty_per_test numeric,
  drops_per_test numeric,
  ml_per_drop numeric,
  process_stage text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chemical_catalog_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id uuid NOT NULL REFERENCES public.chemical_catalog(id) ON DELETE CASCADE,
  plant_id uuid REFERENCES public.plants(id) ON DELETE CASCADE,
  unit_label text NOT NULL,
  factor_to_base numeric NOT NULL CHECK (factor_to_base > 0),
  is_default boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS uix_chemical_catalog_units_scoped
  ON public.chemical_catalog_units (catalog_id, unit_label, COALESCE(plant_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS public.plant_day_tanks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  catalog_id uuid NOT NULL REFERENCES public.chemical_catalog(id),
  name text NOT NULL,
  capacity_l numeric CHECK (capacity_l > 0),
  neat_per_100l numeric NOT NULL CHECK (neat_per_100l > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS Policies
ALTER TABLE public.chemical_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_catalog_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_day_tanks ENABLE ROW LEVEL SECURITY;

-- NOTE: role/plant checks reuse the app's existing helpers (is_manager_or_admin,
-- user_has_plant_access). The original draft compared the app_role enum against
-- lowercase literals ('admin', 'super_admin') and referenced a non-existent
-- user_plant_access table, so CREATE POLICY failed and the whole migration rolled back.
DROP POLICY IF EXISTS "catalog_read_authenticated" ON public.chemical_catalog;
CREATE POLICY "catalog_read_authenticated" ON public.chemical_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "catalog_write_manager" ON public.chemical_catalog;
CREATE POLICY "catalog_write_manager" ON public.chemical_catalog
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

DROP POLICY IF EXISTS "catalog_units_read_authenticated" ON public.chemical_catalog_units;
CREATE POLICY "catalog_units_read_authenticated" ON public.chemical_catalog_units
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "catalog_units_write_manager" ON public.chemical_catalog_units;
CREATE POLICY "catalog_units_write_manager" ON public.chemical_catalog_units
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

DROP POLICY IF EXISTS "day_tanks_read_plant_access" ON public.plant_day_tanks;
CREATE POLICY "day_tanks_read_plant_access" ON public.plant_day_tanks
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "day_tanks_write_manager" ON public.plant_day_tanks;
CREATE POLICY "day_tanks_write_manager" ON public.plant_day_tanks
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- Seed initial standard chemical catalog
INSERT INTO public.chemical_catalog (name, price_key, legacy_name, family, category, form, base_unit, strength_pct, strength_basis, density_kg_per_l, reference_basis, sort_order)
VALUES
  ('Chlorine - Liquid', 'Chlorine - Liquid (L)', 'Chlorine', 'chlorine', 'process', 'liquid', 'L', 12.0, 'w/v', 1.20, 'Cl2', 10),
  ('Chlorine - Granules', 'Chlorine - Granules (kg)', 'Chlorine', 'chlorine', 'process', 'granules', 'kg', 65.0, 'w/w', NULL, 'Cl2', 20),
  ('Chlorine - Gas', 'Chlorine - Gas (kg)', 'Chlorine', 'chlorine', 'process', 'gas', 'kg', 100.0, 'as_product', NULL, 'Cl2', 30),
  ('SMBS - Powder', 'SMBS - Powder (kg)', 'SMBS', 'smbs', 'process', 'powder', 'kg', 98.0, 'w/w', NULL, 'Na2S2O5', 40),
  ('SMBS - Solution', 'SMBS - Solution (L)', 'SMBS', 'smbs', 'process', 'solution', 'L', 38.0, 'w/w', 1.33, 'Na2S2O5', 50),
  ('Anti Scalant - Liquid', 'Anti Scalant - Liquid (L)', 'Anti Scalant', 'anti_scalant', 'process', 'liquid', 'L', 100.0, 'as_product', 1.15, NULL, 60),
  ('Anti Scalant - Powder', 'Anti Scalant - Powder (kg)', 'Anti Scalant', 'anti_scalant', 'process', 'powder', 'kg', 100.0, 'as_product', NULL, NULL, 70),
  ('Soda Ash - Powder', 'Soda Ash - Powder (kg)', 'Soda Ash', 'soda_ash', 'process', 'powder', 'kg', 99.0, 'w/w', NULL, 'Na2CO3', 80),
  ('Soda Ash - Solution', 'Soda Ash - Solution (L)', 'Soda Ash', 'soda_ash', 'process', 'solution', 'L', 10.0, 'w/v', 1.10, 'Na2CO3', 90)
ON CONFLICT (name) DO NOTHING;

-- Seed Reagents
INSERT INTO public.chemical_catalog (name, price_key, legacy_name, family, category, form, base_unit, methods, sample_volume_ml, qty_per_test, sort_order)
VALUES
  ('DPD Free Chlorine Pillows (10 mL)', 'Free Cl Reagent (pcs)', 'Free Cl Reagent', 'reagent', 'test_consumable', 'pillow', 'pcs', ARRAY['dpd_free'], 10, 1, 100),
  ('DPD Total Chlorine Pillows (10 mL)', 'Total Cl Reagent (pcs)', 'Total Cl Reagent', 'reagent', 'test_consumable', 'pillow', 'pcs', ARRAY['dpd_total'], 10, 1, 110)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.chemical_catalog (name, price_key, legacy_name, family, category, form, base_unit, methods, qty_per_test, drops_per_test, ml_per_drop, sort_order)
VALUES
  ('Free/Total Cl Liquid Reagent', 'Cl Liquid Reagent (mL)', 'Liquid Reagent', 'reagent', 'test_consumable', 'drops', 'mL', ARRAY['dpd_free', 'oto'], 0.25, 5, 0.05, 120)
ON CONFLICT (name) DO NOTHING;
