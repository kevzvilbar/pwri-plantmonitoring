-- =============================================================================
-- Phase 4: Database Hardening - Column-Restricted Cost Triggers
-- =============================================================================
-- Restrict cost computation triggers to only fire when relevant columns change.
-- This prevents unnecessary cost recomputation on unrelated updates.

-- 1. Chemical dosing cost trigger - only fire on quantity columns
DROP TRIGGER IF EXISTS trg_chem_cost ON public.chemical_dosing_logs;

CREATE TRIGGER trg_chem_cost
  AFTER INSERT OR UPDATE OR DELETE ON public.chemical_dosing_logs
  FOR EACH ROW
  WHEN (
    (TG_OP = 'INSERT') OR
    (TG_OP = 'UPDATE' AND (
      OLD.chlorine_kg IS DISTINCT FROM NEW.chlorine_kg OR
      OLD.smbs_kg IS DISTINCT FROM NEW.smbs_kg OR
      OLD.anti_scalant_l IS DISTINCT FROM NEW.anti_scalant_l OR
      OLD.soda_ash_kg IS DISTINCT FROM NEW.soda_ash_kg OR
      OLD.free_chlorine_reagent_pcs IS DISTINCT FROM NEW.free_chlorine_reagent_pcs
    )) OR
    (TG_OP = 'DELETE')
  )
  EXECUTE FUNCTION public.trg_recompute_cost();

-- 2. Power readings cost trigger - only fire on consumption columns
DROP TRIGGER IF EXISTS trg_power_cost ON public.power_readings;

CREATE TRIGGER trg_power_cost
  AFTER INSERT OR UPDATE OR DELETE ON public.power_readings
  FOR EACH ROW
  WHEN (
    (TG_OP = 'INSERT') OR
    (TG_OP = 'UPDATE' AND (
      OLD.daily_consumption_kwh IS DISTINCT FROM NEW.daily_consumption_kwh OR
      OLD.daily_solar_kwh IS DISTINCT FROM NEW.daily_solar_kwh OR
      OLD.daily_grid_kwh IS DISTINCT FROM NEW.daily_grid_kwh
    )) OR
    (TG_OP = 'DELETE')
  )
  EXECUTE FUNCTION public.trg_recompute_cost();

-- 3. Well readings cost trigger - only fire on daily_volume (drives well energy cost)
DROP TRIGGER IF EXISTS trg_well_cost ON public.well_readings;

CREATE TRIGGER trg_well_cost
  AFTER INSERT OR UPDATE OR DELETE ON public.well_readings
  FOR EACH ROW
  WHEN (
    (TG_OP = 'INSERT') OR
    (TG_OP = 'UPDATE' AND (
      OLD.daily_volume IS DISTINCT FROM NEW.daily_volume
    )) OR
    (TG_OP = 'DELETE')
  )
  EXECUTE FUNCTION public.trg_recompute_cost();

-- 4. Filter replacement cost trigger - only fire on cost-related columns
DROP TRIGGER IF EXISTS trg_filter_replacements_sync_cost ON public.filter_replacements;

CREATE TRIGGER trg_filter_replacements_sync_cost
  AFTER INSERT OR UPDATE OR DELETE ON public.filter_replacements
  FOR EACH ROW
  WHEN (
    (TG_OP = 'INSERT') OR
    (TG_OP = 'UPDATE' AND (
      OLD.cost IS DISTINCT FROM NEW.cost OR
      OLD.quantity IS DISTINCT FROM NEW.quantity
    )) OR
    (TG_OP = 'DELETE')
  )
  EXECUTE FUNCTION public.fn_sync_filter_cost_to_production_costs();

-- 5. Pretreatment filter usage cost trigger
DROP TRIGGER IF EXISTS trg_pretreatment_sync_filter_cost ON public.afm_readings;

CREATE TRIGGER trg_pretreatment_sync_filter_cost
  AFTER INSERT OR UPDATE OR DELETE ON public.afm_readings
  FOR EACH ROW
  WHEN (
    (TG_OP = 'INSERT') OR
    (TG_OP = 'UPDATE' AND (
      OLD.backwash_volume IS DISTINCT FROM NEW.backwash_volume OR
      OLD.mode IS DISTINCT FROM NEW.mode
    )) OR
    (TG_OP = 'DELETE')
  )
  EXECUTE FUNCTION public.fn_sync_filter_usage_cost();

-- 6. DPS production sync trigger
DROP TRIGGER IF EXISTS trg_sync_dps_production ON public.daily_plant_summary;

CREATE TRIGGER trg_sync_dps_production
  BEFORE INSERT OR UPDATE ON public.daily_plant_summary
  FOR EACH ROW
  WHEN (
    (TG_OP = 'INSERT') OR
    (TG_OP = 'UPDATE' AND (
      OLD.production_m3 IS DISTINCT FROM NEW.production_m3 OR
      OLD.product_water_m3 IS DISTINCT FROM NEW.product_water_m3
    ))
  )
  EXECUTE FUNCTION public.sync_daily_plant_summary_production();

-- =============================================================================
-- END OF COLUMN-RESTRICTED TRIGGERS
-- =============================================================================