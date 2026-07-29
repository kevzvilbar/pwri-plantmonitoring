-- ============================================================================
-- Filter Replacement Tracking (Bag / Cartridge filters)
-- Added 2026-07-29
--
-- Adds a dedicated replacement-event table, wires its cost into the existing
-- production_costs / opex_budgets rollups as a third bucket, and syncs it via
-- trigger the same way chemical_dosing_logs / power_readings / well_readings
-- already do.
--
-- ⚠ VERIFY BEFORE RUNNING (this repo has a history of schema drift — see
--   DEPLOYMENT.md — so a couple of assumptions below need a quick check
--   against the live schema first):
--   1. That production_costs has a UNIQUE/PK constraint on (plant_id, cost_date)
--      — the ON CONFLICT in the trigger function below targets that pair.
--      If the date column is named something other than `cost_date`, or the
--      constraint covers different columns, adjust step 4 accordingly.
--   2. Whether production_costs.total_cost / opex_budgets.total_budget are
--      GENERATED columns or maintained by application code. If GENERATED,
--      see the commented-out ALTERs in steps 2-3 to rebuild them.
--   3. The RLS policies in step 5 use a placeholder role-claim check
--      (`auth.jwt() ->> 'role'`). Replace with whatever helper function or
--      claim shape chemical_deliveries' policies already use, so permissions
--      stay consistent across tables.
-- ============================================================================

-- 0. Catch-up: filter_housing_type was applied directly to the live DB
--    without a committed migration. Idempotent no-op if already present.
ALTER TABLE plants
  ADD COLUMN IF NOT EXISTS filter_housing_type text
  CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter'));

ALTER TABLE ro_trains
  ADD COLUMN IF NOT EXISTS filter_housing_type text
  CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter'));

-- 1. Replacement event log — modeled on chemical_deliveries
--    (quantity, unit, unit_cost, supplier, delivery_date).
CREATE TABLE IF NOT EXISTS filter_replacements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id            uuid NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  train_id            uuid REFERENCES ro_trains(id) ON DELETE SET NULL,
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
  ON filter_replacements (plant_id, replacement_date DESC);

CREATE INDEX IF NOT EXISTS idx_filter_replacements_train
  ON filter_replacements (train_id) WHERE train_id IS NOT NULL;

-- 2. Cost rollup wiring — production_costs gains a third bucket.
ALTER TABLE production_costs
  ADD COLUMN IF NOT EXISTS filter_cost numeric(14,2) NOT NULL DEFAULT 0;

-- If production_costs.total_cost is a GENERATED column today
-- (chem_cost + power_cost), uncomment and adjust to include filter_cost:
--
--   ALTER TABLE production_costs DROP COLUMN total_cost;
--   ALTER TABLE production_costs ADD COLUMN total_cost numeric(14,2)
--     GENERATED ALWAYS AS (chem_cost + power_cost + filter_cost) STORED;
--
-- Left commented out because the exact current definition wasn't available
-- to verify before writing this migration — confirm, then apply by hand.

-- 3. Budget wiring — opex_budgets gains a matching bucket.
ALTER TABLE opex_budgets
  ADD COLUMN IF NOT EXISTS filter_budget numeric(14,2) NOT NULL DEFAULT 0;

-- Same caveat as step 2 if opex_budgets.total_budget is GENERATED:
--
--   ALTER TABLE opex_budgets DROP COLUMN total_budget;
--   ALTER TABLE opex_budgets ADD COLUMN total_budget numeric(14,2)
--     GENERATED ALWAYS AS (power_budget + chem_budget + filter_budget) STORED;

-- 4. Trigger: keep production_costs.filter_cost in sync with the sum of
--    that plant+date's replacements, mirroring the existing chem/power sync
--    pattern so the Rollup/Budget views stay correct without app-layer work.
CREATE OR REPLACE FUNCTION fn_sync_filter_cost_to_production_costs()
RETURNS trigger AS $$
DECLARE
  target_plant uuid;
  target_date  date;
  new_total    numeric(14,2);
BEGIN
  target_plant := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  := COALESCE(NEW.replacement_date, OLD.replacement_date);

  SELECT COALESCE(SUM(total_cost), 0) INTO new_total
  FROM filter_replacements
  WHERE plant_id = target_plant AND replacement_date = target_date;

  INSERT INTO production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, new_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_filter_replacements_sync_cost ON filter_replacements;
CREATE TRIGGER trg_filter_replacements_sync_cost
AFTER INSERT OR UPDATE OR DELETE ON filter_replacements
FOR EACH ROW EXECUTE FUNCTION fn_sync_filter_cost_to_production_costs();

-- 5. RLS — read: anyone with plant access; write: Manager/Admin only,
--    matching chemical_deliveries' permission split.
ALTER TABLE filter_replacements ENABLE ROW LEVEL SECURITY;

CREATE POLICY filter_replacements_select ON filter_replacements
  FOR SELECT USING (true);
  -- ⚠ Tighten to whatever plant-access helper chemical_deliveries' SELECT
  --   policy already uses, if it's scoped rather than open.

CREATE POLICY filter_replacements_write ON filter_replacements
  FOR INSERT WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'manager'));
  -- ⚠ Replace the role-claim expression with the real one used by
  --   chemical_deliveries' write policy.

CREATE POLICY filter_replacements_update ON filter_replacements
  FOR UPDATE USING (auth.jwt() ->> 'role' IN ('admin', 'manager'));

CREATE POLICY filter_replacements_delete ON filter_replacements
  FOR DELETE USING (auth.jwt() ->> 'role' IN ('admin', 'manager'));
