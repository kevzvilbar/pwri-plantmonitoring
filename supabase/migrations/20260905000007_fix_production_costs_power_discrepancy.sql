-- =============================================================================
-- Migration: 20260905000007_fix_production_costs_power_discrepancy.sql
--
-- FIX DAILY PRODUCTION COSTS DISCREPANCY & POWER SPIKE:
--   1. Update public.recompute_production_cost(_plant_id uuid, _date date):
--      - Correctly use Manila time zone for date matching: (reading_datetime AT TIME ZONE 'Asia/Manila')::date = _date
--      - Support modern daily_grid_kwh along with daily_consumption_kwh
--      - Remove double-multiplier multiplication: v_kwh is already multiplied kWh,
--        so v_power_cost := v_kwh * COALESCE(v_rate, 0)
--   2. Data Repair for SRP (Sep 1-5, 2026):
--      - Normalize power_readings.daily_grid_kwh and production_costs.power_cost
--        to distribute the 66,243 kWh across Sep 3 (28,320 kWh), Sep 4 (20,868 kWh),
--        and Sep 5 (17,055 kWh) instead of 0 on Sep 3/4 and 760,000 lump sum on Sep 5.
-- =============================================================================

-- ─── 1. Recreate recompute_production_cost ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_production_cost(_plant_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_chem numeric := 0;
  v_kwh numeric := 0;
  v_prod numeric := 0;
  v_rate numeric := 0;
  v_power_cost numeric := 0;
BEGIN
  SELECT COALESCE(SUM(calculated_cost), 0) INTO v_chem
  FROM public.chemical_dosing_logs
  WHERE plant_id = _plant_id AND (log_datetime AT TIME ZONE 'Asia/Manila')::date = _date;

  SELECT COALESCE(SUM(COALESCE(NULLIF(daily_grid_kwh, 0), NULLIF(daily_consumption_kwh, 0), 0)), 0) INTO v_kwh
  FROM public.power_readings
  WHERE plant_id = _plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = _date;

  SELECT COALESCE(SUM(daily_volume), 0) INTO v_prod
  FROM public.well_readings
  WHERE plant_id = _plant_id AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = _date;

  SELECT rate_per_kwh INTO v_rate
  FROM public.power_tariffs
  WHERE plant_id = _plant_id AND effective_date <= _date
  ORDER BY effective_date DESC LIMIT 1;

  -- v_kwh is physical kWh (already post-multiplier), rate is ₱/kWh
  v_power_cost := v_kwh * COALESCE(v_rate, 0);

  INSERT INTO public.production_costs(plant_id, cost_date, chem_cost, power_cost, production_m3, cost_per_m3)
  VALUES (_plant_id, _date, v_chem, v_power_cost, v_prod,
          CASE WHEN v_prod > 0 THEN (v_chem + v_power_cost) / v_prod ELSE NULL END)
  ON CONFLICT (plant_id, cost_date) DO UPDATE
  SET chem_cost = EXCLUDED.chem_cost,
      power_cost = EXCLUDED.power_cost,
      production_m3 = EXCLUDED.production_m3,
      cost_per_m3 = EXCLUDED.cost_per_m3,
      updated_at = now();
END;
$func$;

-- ─── 2. Data Repair for SRP (Sep 1–5, 2026) ──────────────────────────────────
DO $do$
DECLARE
  v_srp_id uuid;
  v_rate numeric;
BEGIN
  SELECT id INTO v_srp_id FROM public.plants WHERE code = 'SRP' OR name ILIKE '%SRP%' LIMIT 1;
  IF v_srp_id IS NOT NULL THEN
    -- Get current tariff rate for SRP
    SELECT rate_per_kwh INTO v_rate
    FROM public.power_tariffs
    WHERE plant_id = v_srp_id AND effective_date <= '2026-09-05'
    ORDER BY effective_date DESC LIMIT 1;
    v_rate := COALESCE(v_rate, 11.5);

    -- Normalize power_readings daily_grid_kwh
    UPDATE public.power_readings
    SET daily_grid_kwh = 28320
    WHERE plant_id = v_srp_id
      AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = '2026-09-03'
      AND (daily_grid_kwh IS NULL OR daily_grid_kwh = 0);

    UPDATE public.power_readings
    SET daily_grid_kwh = 20868
    WHERE plant_id = v_srp_id
      AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = '2026-09-04'
      AND (daily_grid_kwh IS NULL OR daily_grid_kwh = 0);

    UPDATE public.power_readings
    SET daily_grid_kwh = 17055
    WHERE plant_id = v_srp_id
      AND (reading_datetime AT TIME ZONE 'Asia/Manila')::date = '2026-09-05'
      AND daily_grid_kwh > 50000;

    -- Update production_costs for Sep 3, Sep 4, Sep 5
    INSERT INTO public.production_costs (plant_id, cost_date, power_cost, chem_cost, production_m3, cost_per_m3)
    VALUES (v_srp_id, '2026-09-03', ROUND(28320 * v_rate, 2), 0, 0, NULL)
    ON CONFLICT (plant_id, cost_date) DO UPDATE
    SET power_cost = ROUND(28320 * v_rate, 2),
        cost_per_m3 = CASE WHEN production_costs.production_m3 > 0 THEN (COALESCE(production_costs.chem_cost, 0) + ROUND(28320 * v_rate, 2)) / production_costs.production_m3 ELSE NULL END,
        updated_at = now();

    INSERT INTO public.production_costs (plant_id, cost_date, power_cost, chem_cost, production_m3, cost_per_m3)
    VALUES (v_srp_id, '2026-09-04', ROUND(20868 * v_rate, 2), 0, 0, NULL)
    ON CONFLICT (plant_id, cost_date) DO UPDATE
    SET power_cost = ROUND(20868 * v_rate, 2),
        cost_per_m3 = CASE WHEN production_costs.production_m3 > 0 THEN (COALESCE(production_costs.chem_cost, 0) + ROUND(20868 * v_rate, 2)) / production_costs.production_m3 ELSE NULL END,
        updated_at = now();

    INSERT INTO public.production_costs (plant_id, cost_date, power_cost, chem_cost, production_m3, cost_per_m3)
    VALUES (v_srp_id, '2026-09-05', ROUND(17055 * v_rate, 2), 0, 0, NULL)
    ON CONFLICT (plant_id, cost_date) DO UPDATE
    SET power_cost = ROUND(17055 * v_rate, 2),
        cost_per_m3 = CASE WHEN production_costs.production_m3 > 0 THEN (COALESCE(production_costs.chem_cost, 0) + ROUND(17055 * v_rate, 2)) / production_costs.production_m3 ELSE NULL END,
        updated_at = now();
  END IF;
END;
$do$;
