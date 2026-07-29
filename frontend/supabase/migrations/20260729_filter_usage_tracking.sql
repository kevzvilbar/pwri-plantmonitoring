-- ============================================================================
-- Filter Usage & Cost Tracking (Bag / Cartridge filters)
-- 2026-07-29 — supersedes 20260729_filter_replacements.sql, which never
-- successfully applied (it failed on the missing opex_budgets table).
--
-- Design, after discussion: no separate replacement-log table, no manual
-- "log a replacement" action, no delivery/inventory tracking. Instead:
--   - Bag Filter plants already capture a daily changed-count via the
--     existing ro_pretreatment_readings.bag_filters_changed field.
--   - Cartridge Filter plants get one new parallel column,
--     cartridges_changed — same habit, one more field on the existing
--     daily Pre-Treatment & RO log form. See PATCH_INSTRUCTIONS.md for
--     exactly where to add that input.
--   - Cost = changed-count × whichever unit price was in effect that day
--     for that plant + filter type, computed by trigger straight into
--     production_costs.filter_cost. No manual per-event cost entry.
--
-- ⚠ VERIFY BEFORE RUNNING:
--   1. Whether the earlier failed migration left `filter_replacements`,
--      `production_costs.filter_cost`, or its trigger/function partially
--      applied. Step 0 cleans those up defensively either way — safe to
--      run whether or not anything was actually left behind.
--   2. Whether `production_costs` has a UNIQUE/PK constraint on
--      (plant_id, cost_date) — the trigger's ON CONFLICT targets that pair.
--      If the date column is named differently, adjust step 4.
--   3. `opex_budgets` didn't exist on the last check — step 6 skips that
--      wiring gracefully instead of failing. Once that table exists,
--      re-running this file will pick it up (everything else is
--      idempotent / IF NOT EXISTS).
-- ============================================================================

-- 0. Clean up any partial leftovers from the superseded design.
DROP TRIGGER IF EXISTS trg_filter_replacements_sync_cost ON filter_replacements;
DROP FUNCTION IF EXISTS fn_sync_filter_cost_to_production_costs();
DROP TABLE IF EXISTS filter_replacements;

-- 1. Parallel column to bag_filters_changed, for Cartridge Filter plants.
ALTER TABLE ro_pretreatment_readings
  ADD COLUMN IF NOT EXISTS cartridges_changed integer NOT NULL DEFAULT 0
  CHECK (cartridges_changed >= 0);

-- 2. Effective-dated unit price — deliberately not a single "current
--    price" field. A price change shouldn't silently rewrite last month's
--    cost history. Admin/Manager insert a new row when the price changes;
--    each day's cost uses whatever was in effect on that date.
CREATE TABLE IF NOT EXISTS filter_unit_prices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id             uuid NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  filter_housing_type  text NOT NULL
    CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter')),
  unit_price           numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  effective_from        date NOT NULL,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plant_id, filter_housing_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_filter_unit_prices_lookup
  ON filter_unit_prices (plant_id, filter_housing_type, effective_from DESC);

ALTER TABLE filter_unit_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY filter_unit_prices_select ON filter_unit_prices
  FOR SELECT USING (true);

CREATE POLICY filter_unit_prices_write ON filter_unit_prices
  FOR INSERT WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'manager'));
  -- ⚠ swap for the real role-claim expression chemical_deliveries uses

-- Known limitation, deliberately not handled: inserting a price row with
-- a past effective_from (e.g. correcting a mistake) does NOT retroactively
-- recompute already-synced production_costs rows for that window — only
-- new/changed readings trigger a recompute. Rare enough (price
-- corrections, not routine changes) that a full historical rescan isn't
-- built here; can be added as a manual one-off query if it's ever needed.

CREATE OR REPLACE FUNCTION fn_filter_unit_price(
  p_plant_id uuid, p_housing_type text, p_as_of date
) RETURNS numeric AS $$
  SELECT unit_price
  FROM filter_unit_prices
  WHERE plant_id = p_plant_id
    AND filter_housing_type = p_housing_type
    AND effective_from <= p_as_of
  ORDER BY effective_from DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- 3. Cost rollup wiring — same as before.
ALTER TABLE production_costs
  ADD COLUMN IF NOT EXISTS filter_cost numeric(14,2) NOT NULL DEFAULT 0;

-- If production_costs.total_cost is a GENERATED column today
-- (chem_cost + power_cost), uncomment and adjust to include filter_cost:
--
--   ALTER TABLE production_costs DROP COLUMN total_cost;
--   ALTER TABLE production_costs ADD COLUMN total_cost numeric(14,2)
--     GENERATED ALWAYS AS (chem_cost + power_cost + filter_cost) STORED;

-- 4. Trigger: recompute that plant+date's filter_cost whenever a
--    pretreatment reading's changed-counts (or its train/date) change.
--    Recomputes the whole day, not just the changed row, since multiple
--    trains can report the same day with different housing types/prices.
CREATE OR REPLACE FUNCTION fn_sync_filter_usage_cost()
RETURNS trigger AS $$
DECLARE
  target_plant uuid := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  date := (COALESCE(NEW.reading_datetime, OLD.reading_datetime))::date;
  day_total    numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(
    CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
      WHEN 'Bag Filter' THEN
        r.bag_filters_changed * COALESCE(fn_filter_unit_price(p.id, 'Bag Filter', target_date), 0)
      ELSE
        r.cartridges_changed * COALESCE(fn_filter_unit_price(p.id, 'Cartridge Filter', target_date), 0)
    END
  ), 0)
  INTO day_total
  FROM ro_pretreatment_readings r
  JOIN plants p ON p.id = r.plant_id
  LEFT JOIN ro_trains rt ON rt.id = r.train_id
  WHERE r.plant_id = target_plant
    AND r.reading_datetime::date = target_date;

  INSERT INTO production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, day_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pretreatment_sync_filter_cost ON ro_pretreatment_readings;
CREATE TRIGGER trg_pretreatment_sync_filter_cost
AFTER INSERT OR DELETE OR UPDATE OF cartridges_changed, bag_filters_changed, train_id, reading_datetime
ON ro_pretreatment_readings
FOR EACH ROW EXECUTE FUNCTION fn_sync_filter_usage_cost();

-- 5. Read-friendly view for the frontend — one clean source for both the
--    usage chart and the usage history list, so the app isn't joining
--    plants/ro_trains/filter_unit_prices client-side.
CREATE OR REPLACE VIEW filter_usage_daily WITH (security_invoker = true) AS
SELECT
  r.id,
  r.plant_id,
  r.train_id,
  r.reading_datetime::date AS reading_date,
  COALESCE(rt.filter_housing_type, p.filter_housing_type) AS filter_housing_type,
  CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
    WHEN 'Bag Filter' THEN r.bag_filters_changed
    ELSE r.cartridges_changed
  END AS quantity_changed,
  CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
    WHEN 'Bag Filter' THEN
      r.bag_filters_changed * COALESCE(fn_filter_unit_price(p.id, 'Bag Filter', r.reading_datetime::date), 0)
    ELSE
      r.cartridges_changed * COALESCE(fn_filter_unit_price(p.id, 'Cartridge Filter', r.reading_datetime::date), 0)
  END AS cost
FROM ro_pretreatment_readings r
JOIN plants p ON p.id = r.plant_id
LEFT JOIN ro_trains rt ON rt.id = r.train_id;

-- 6. Budget wiring — skipped gracefully since opex_budgets doesn't exist
--    yet in this environment. Re-run this file once it does.
DO $$
BEGIN
  IF to_regclass('public.opex_budgets') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE opex_budgets ADD COLUMN IF NOT EXISTS filter_budget numeric(14,2) NOT NULL DEFAULT 0';
  END IF;
END $$;
