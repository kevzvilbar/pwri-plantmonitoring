-- ============================================================================
-- Filter Replacement Tracking (Bag / Cartridge filters)
-- Added 2026-07-29
--
-- Adds a dedicated replacement-event table and wires its cost into the
-- existing production_costs rollup as a third bucket, synced via trigger
-- the same way chemical_dosing_logs / power_readings / well_readings
-- already do.
--
-- Verified against the live schema (2026-07-29):
--   - production_costs.total_cost IS a GENERATED column
--     (chem_cost + power_cost) — see 20260420_power_tariffs.sql. Rebuilt
--     below to include filter_cost.
--   - RLS below uses this project's real helper functions,
--     public.user_has_plant_access(plant_id) and
--     public.is_manager_or_admin(auth.uid()), matching
--     chemical_deliveries' policies exactly (20260420_chemical_deliveries.sql).
--   - opex_budgets.filter_budget is intentionally NOT added in this pass —
--     BudgetTab.tsx / useOpexBudget.ts don't read it yet, so it would be an
--     inert column. Add it in a follow-up migration when Budget-tab parity
--     for Filters is actually wired up in the frontend.
-- ============================================================================

-- 0. Catch-up: filter_housing_type was applied directly to the live DB
--    without a committed migration. Idempotent no-op if already present.
ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS filter_housing_type text
  CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter'));

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS filter_housing_type text
  CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter'));

-- 1. Replacement event log — modeled on chemical_deliveries
--    (quantity, unit_cost, supplier, delivery_date).
CREATE TABLE IF NOT EXISTS public.filter_replacements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id            uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  train_id            uuid REFERENCES public.ro_trains(id) ON DELETE SET NULL,
  replacement_date    date NOT NULL,
  -- Snapshot, not a live lookup: history must not shift retroactively if the
  -- plant/train's configured housing type is ever changed later.
  filter_housing_type text NOT NULL
    CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter')),
  quantity_replaced   integer NOT NULL CHECK (quantity_replaced > 0),
  unit_price          numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  total_cost          numeric(14,2) GENERATED ALWAYS AS (quantity_replaced * unit_price) STORED,
  avg_dp_psi          numeric(6,2),
  supplier            text,
  remarks             text,
  recorded_by         uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_filter_replacements_plant_date
  ON public.filter_replacements (plant_id, replacement_date DESC);

CREATE INDEX IF NOT EXISTS idx_filter_replacements_train
  ON public.filter_replacements (train_id) WHERE train_id IS NOT NULL;

-- 2. Cost rollup wiring — production_costs gains a third bucket.
ALTER TABLE public.production_costs
  ADD COLUMN IF NOT EXISTS filter_cost numeric(14,2) NOT NULL DEFAULT 0;

-- total_cost is GENERATED (chem_cost + power_cost) today — rebuild it to
-- include filter_cost. Safe to run even though production_costs already has
-- rows: DROP/ADD on a generated column recomputes it from existing data,
-- it does not touch chem_cost/power_cost/filter_cost themselves.
ALTER TABLE public.production_costs DROP COLUMN total_cost;
ALTER TABLE public.production_costs ADD COLUMN total_cost numeric(14,2)
  GENERATED ALWAYS AS (chem_cost + power_cost + filter_cost) STORED;

-- 3. Trigger: keep production_costs.filter_cost in sync with the sum of
--    that plant+date's replacements, mirroring the existing chem/power sync
--    pattern (public.trg_recompute_cost / public.recompute_production_cost)
--    so the Rollup view stays correct without app-layer work. This trigger
--    only ever writes the filter_cost column, so it can't race with
--    recompute_production_cost, which only ever writes chem_cost/power_cost/
--    production_m3/cost_per_m3 — the two never fight over the same field.
CREATE OR REPLACE FUNCTION public.fn_sync_filter_cost_to_production_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_plant uuid;
  target_date  date;
  new_total    numeric(14,2);
BEGIN
  target_plant := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  := COALESCE(NEW.replacement_date, OLD.replacement_date);

  SELECT COALESCE(SUM(total_cost), 0) INTO new_total
  FROM public.filter_replacements
  WHERE plant_id = target_plant AND replacement_date = target_date;

  INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, new_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_filter_replacements_sync_cost ON public.filter_replacements;
CREATE TRIGGER trg_filter_replacements_sync_cost
AFTER INSERT OR UPDATE OR DELETE ON public.filter_replacements
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_filter_cost_to_production_costs();

-- 4. RLS — read: anyone with plant access; write: Manager/Admin only.
--    Matches chemical_deliveries' policies exactly (single combined write
--    policy rather than separate INSERT/UPDATE/DELETE grants).
ALTER TABLE public.filter_replacements ENABLE ROW LEVEL SECURITY;

CREATE POLICY filter_replacements_read ON public.filter_replacements
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

CREATE POLICY filter_replacements_write ON public.filter_replacements
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));
