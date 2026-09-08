-- ============================================================================
-- Migration: 20260729000008_filter_usage_tracking.sql
--
-- Reconciles migration drift (roadmap Phase 1, "CI enforcement"): the filter
-- usage/cost tracking feature was applied against the live DB out-of-band
-- and only ever existed in a stray `frontend/supabase/migrations/` tree that
-- the root CLI never applies. Evidence of the live schema: types.ts carries
-- filter_unit_prices / cartridges_changed / fn_filter_unit_price /
-- filter_usage_daily, and src/lib/filterUsage.ts + EditPretreatReadingDialog
-- query them — yet a fresh `supabase start` (or the CI rls-tests job) could
-- not reproduce any of it. This migration brings those pieces under version
-- control. The stray tree itself is deleted in the same change so there is
-- exactly one migration source of truth again.
--
-- DELIBERATE OMISSION vs the stray file: its step 0 (`DROP TABLE
-- filter_replacements` + its trigger/function) is NOT ported. That drop was
-- cleanup for a failed first attempt in the live DB only; in a fresh
-- environment the root migration 20260729000006_filter_replacements.sql
-- legitimately creates filter_replacements, which the app actively uses
-- (src/lib/filterReplacements.ts, useCostComposition.ts, the history UI).
-- Dropping it here would break a fresh environment, not heal it.
--
-- KNOWN COEXISTENCE (left as-is, matching live): production_costs.filter_cost
-- is written by TWO triggers — trg_filter_replacements_sync_cost (from
-- replacement events, 000006) and trg_pretreatment_sync_filter_cost below
-- (from daily usage counts). Whichever fired last owns the day's value.
-- Unifying them is a product decision (which cost basis is canonical?) and
-- is intentionally deferred — see the trigger dependency graph doc.
--
-- Policy note: the stray file used `auth.jwt() ->> 'role'` with a ⚠ "swap
-- for the real role expression" TODO. This port uses the project's real
-- helpers (user_has_plant_access / is_manager_or_admin) exactly as
-- filter_replacements' policies do, and uses DROP POLICY IF EXISTS so the
-- file is idempotent whether the live table already has the old or no
-- policies.
--
-- Everything here is IF NOT EXISTS / OR REPLACE / DROP-IF-EXISTS: safe to
-- run against the live DB (no-op or policy refresh) and against a fresh
-- environment (full apply).
-- ============================================================================

-- 1. Parallel count column to bag_filters_changed (20260420000001), for
--    Cartridge Filter plants. Same habit, one more field on the existing
--    daily Pre-Treatment & RO log form.
ALTER TABLE public.ro_pretreatment_readings
  ADD COLUMN IF NOT EXISTS cartridges_changed integer NOT NULL DEFAULT 0
  CHECK (cartridges_changed >= 0);

-- 2. Effective-dated unit price — deliberately not a single "current price"
--    field: a price change shouldn't silently rewrite last month's cost
--    history. Admin/Manager insert a new row when the price changes; each
--    day's cost uses whatever was in effect on that date.
CREATE TABLE IF NOT EXISTS public.filter_unit_prices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id            uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  filter_housing_type text NOT NULL
    CHECK (filter_housing_type IN ('Cartridge Filter', 'Bag Filter')),
  unit_price          numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  effective_from      date NOT NULL,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plant_id, filter_housing_type, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_filter_unit_prices_lookup
  ON public.filter_unit_prices (plant_id, filter_housing_type, effective_from DESC);

ALTER TABLE public.filter_unit_prices ENABLE ROW LEVEL SECURITY;

-- Read: anyone with plant access (same as filter_replacements). Write:
-- Manager/Admin with plant access.
DROP POLICY IF EXISTS filter_unit_prices_select ON public.filter_unit_prices;
CREATE POLICY filter_unit_prices_select ON public.filter_unit_prices
  FOR SELECT TO authenticated USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS filter_unit_prices_write ON public.filter_unit_prices;
CREATE POLICY filter_unit_prices_write ON public.filter_unit_prices
  FOR ALL TO authenticated
  USING (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- 3. Price lookup as of a date. STABLE (read-only, safe in index/trigger
--    contexts); search_path pinned per the project's hardening convention.
CREATE OR REPLACE FUNCTION public.fn_filter_unit_price(
  p_plant_id uuid, p_housing_type text, p_as_of date
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT unit_price
  FROM public.filter_unit_prices
  WHERE plant_id = p_plant_id
    AND filter_housing_type = p_housing_type
    AND effective_from <= p_as_of
  ORDER BY effective_from DESC
  LIMIT 1;
$$;

-- 4. Trigger: recompute that plant+date's filter_cost from usage counts
--    whenever a pretreatment reading's changed-counts (or its train/date)
--    change. Recomputes the whole day, not just the changed row, since
--    multiple trains can report the same day with different housing
--    types/prices. ON CONFLICT (plant_id, cost_date) relies on the UNIQUE
--    constraint production_costs has carried since 20260420000002.
CREATE OR REPLACE FUNCTION public.fn_sync_filter_usage_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_plant uuid := COALESCE(NEW.plant_id, OLD.plant_id);
  target_date  date  := (COALESCE(NEW.reading_datetime, OLD.reading_datetime))::date;
  day_total    numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(
    CASE COALESCE(rt.filter_housing_type, p.filter_housing_type)
      WHEN 'Bag Filter' THEN
        r.bag_filters_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Bag Filter', target_date), 0)
      ELSE
        r.cartridges_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Cartridge Filter', target_date), 0)
    END
  ), 0)
  INTO day_total
  FROM public.ro_pretreatment_readings r
  JOIN public.plants p ON p.id = r.plant_id
  LEFT JOIN public.ro_trains rt ON rt.id = r.train_id
  WHERE r.plant_id = target_plant
    AND r.reading_datetime::date = target_date;

  INSERT INTO public.production_costs (plant_id, cost_date, filter_cost)
  VALUES (target_plant, target_date, day_total)
  ON CONFLICT (plant_id, cost_date)
  DO UPDATE SET filter_cost = EXCLUDED.filter_cost;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_pretreatment_sync_filter_cost ON public.ro_pretreatment_readings;
CREATE TRIGGER trg_pretreatment_sync_filter_cost
AFTER INSERT OR DELETE OR UPDATE OF cartridges_changed, bag_filters_changed, train_id, reading_datetime
ON public.ro_pretreatment_readings
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_filter_usage_cost();

-- 5. Read-friendly view for the frontend — one clean source for both the
--    usage chart and the usage history list. security_invoker so the view
--    inherits the underlying tables' RLS (never bypasses it).
CREATE OR REPLACE VIEW public.filter_usage_daily WITH (security_invoker = true) AS
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
      r.bag_filters_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Bag Filter', r.reading_datetime::date), 0)
    ELSE
      r.cartridges_changed * COALESCE(public.fn_filter_unit_price(p.id, 'Cartridge Filter', r.reading_datetime::date), 0)
  END AS cost
FROM public.ro_pretreatment_readings r
JOIN public.plants p ON p.id = r.plant_id
LEFT JOIN public.ro_trains rt ON rt.id = r.train_id;

-- 6. opex_budgets wiring from the stray file is intentionally NOT ported:
--    opex_budgets exists (20260726000001) but BudgetTab.tsx doesn't read
--    filter_budget yet — an inert column, same reasoning 000006 used when
--    it deferred opex wiring for the replacement-event design.