-- Migration: 20260524041835_security_fix_qualify_all_table_refs_set_empty_search_path.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- ================================================================
-- Rewrite all affected function bodies with public. prefixes,
-- then lock search_path = ''. Zero behaviour change.
-- ================================================================

-- 1. _get_power_multiplier
CREATE OR REPLACE FUNCTION public._get_power_multiplier(p_plant_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_arr jsonb; v_mult numeric := 1;
BEGIN
  BEGIN
    SELECT grid_meter_multipliers INTO v_arr FROM public.plant_power_config WHERE plant_id = p_plant_id LIMIT 1;
    IF v_arr IS NOT NULL AND jsonb_typeof(v_arr) = 'array' AND jsonb_array_length(v_arr) > 0 THEN
      v_mult := COALESCE((v_arr -> 0)::numeric, 1);
      IF v_mult <= 0 THEN v_mult := 1; END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN v_mult := 1;
  END;
  RETURN v_mult;
END;
$$;

-- 2. _recompute_power_row
CREATE OR REPLACE FUNCTION public._recompute_power_row(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row   public.power_readings%ROWTYPE;
  v_prev  RECORD; v_mult numeric; v_delta numeric; v_daily numeric;
BEGIN
  SELECT * INTO v_row FROM public.power_readings WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF COALESCE(v_row.is_meter_replacement, FALSE) THEN RETURN; END IF;
  IF v_row.meter_reading_kwh IS NULL THEN RETURN; END IF;
  v_mult := public._get_power_multiplier(v_row.plant_id);
  SELECT meter_reading_kwh INTO v_prev FROM public.power_readings
   WHERE plant_id = v_row.plant_id AND reading_datetime < v_row.reading_datetime
     AND id <> p_id AND NOT COALESCE(is_meter_replacement, FALSE) AND meter_reading_kwh IS NOT NULL
   ORDER BY reading_datetime DESC LIMIT 1;
  IF NOT FOUND OR v_prev.meter_reading_kwh IS NULL THEN
    UPDATE public.power_readings SET daily_consumption_kwh = NULL, daily_grid_kwh = NULL WHERE id = p_id;
    RETURN;
  END IF;
  v_delta := v_row.meter_reading_kwh - v_prev.meter_reading_kwh;
  v_daily := GREATEST(v_delta, 0) * v_mult;
  UPDATE public.power_readings SET daily_consumption_kwh = v_daily, daily_grid_kwh = v_daily WHERE id = p_id;
END;
$$;

-- 3. backfill_well_deltas
CREATE OR REPLACE FUNCTION public.backfill_well_deltas()
RETURNS TABLE(well_id uuid, rows_fixed integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  rec RECORD; prev_reading NUMERIC := NULL; cur_well UUID := NULL; fixed_count INT := 0; new_dv NUMERIC;
BEGIN
  FOR rec IN SELECT id, well_id AS wid, current_reading, previous_reading, daily_volume, is_meter_replacement, reading_datetime
    FROM public.well_readings ORDER BY well_id, reading_datetime ASC
  LOOP
    IF rec.wid IS DISTINCT FROM cur_well THEN cur_well := rec.wid; prev_reading := NULL; fixed_count := 0; END IF;
    IF rec.is_meter_replacement IS TRUE THEN prev_reading := NULL; CONTINUE; END IF;
    IF prev_reading IS NOT NULL THEN
      IF rec.daily_volume IS NULL THEN new_dv := GREATEST(0, rec.current_reading - prev_reading);
      ELSIF ABS(rec.daily_volume - GREATEST(0, rec.current_reading - COALESCE(rec.previous_reading, prev_reading))) < 0.01 THEN
        new_dv := GREATEST(0, rec.current_reading - prev_reading);
      ELSE new_dv := rec.daily_volume; END IF;
      UPDATE public.well_readings SET previous_reading = prev_reading, daily_volume = new_dv
       WHERE id = rec.id AND (previous_reading IS DISTINCT FROM prev_reading OR daily_volume IS DISTINCT FROM new_dv);
      IF FOUND THEN fixed_count := fixed_count + 1; END IF;
    END IF;
    IF rec.current_reading IS NOT NULL THEN prev_reading := rec.current_reading; END IF;
  END LOOP;
  FOR rec IN SELECT DISTINCT well_id AS wid FROM public.well_readings LOOP
    well_id := rec.wid; rows_fixed := fixed_count; RETURN NEXT;
  END LOOP;
END;
$$;

-- 4. well_readings_compute_delta
CREATE OR REPLACE FUNCTION public.well_readings_compute_delta()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE actual_prev NUMERIC;
BEGIN
  IF NEW.is_meter_replacement IS TRUE THEN RETURN NEW; END IF;
  SELECT current_reading INTO actual_prev FROM public.well_readings
   WHERE well_id = NEW.well_id AND reading_datetime < NEW.reading_datetime
     AND (is_meter_replacement IS NULL OR is_meter_replacement = FALSE)
   ORDER BY reading_datetime DESC LIMIT 1;
  IF actual_prev IS NOT NULL THEN NEW.previous_reading := actual_prev; END IF;
  IF NEW.daily_volume IS NULL AND actual_prev IS NOT NULL AND NEW.current_reading IS NOT NULL THEN
    NEW.daily_volume := GREATEST(0, NEW.current_reading - actual_prev);
  END IF;
  RETURN NEW;
END;
$$;

-- 5. well_readings_cascade_next
CREATE OR REPLACE FUNCTION public.well_readings_cascade_next()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE next_id UUID; next_dv NUMERIC; next_cr NUMERIC;
BEGIN
  IF NEW.current_reading IS NOT DISTINCT FROM OLD.current_reading THEN RETURN NULL; END IF;
  SELECT id, daily_volume, current_reading INTO next_id, next_dv, next_cr FROM public.well_readings
   WHERE well_id = NEW.well_id AND reading_datetime > NEW.reading_datetime
     AND (is_meter_replacement IS NULL OR is_meter_replacement = FALSE)
   ORDER BY reading_datetime ASC LIMIT 1;
  IF next_id IS NULL THEN RETURN NULL; END IF;
  IF next_dv IS NULL OR (OLD.current_reading IS NOT NULL AND ABS(next_dv - GREATEST(0, next_cr - OLD.current_reading)) < 0.01) THEN
    UPDATE public.well_readings SET previous_reading = NEW.current_reading,
      daily_volume = CASE WHEN next_cr IS NOT NULL THEN GREATEST(0, next_cr - NEW.current_reading) ELSE next_dv END
     WHERE id = next_id;
  ELSE
    UPDATE public.well_readings SET previous_reading = NEW.current_reading WHERE id = next_id;
  END IF;
  RETURN NULL;
END;
$$;

-- 6. fn_power_readings_before_upsert
CREATE OR REPLACE FUNCTION public.fn_power_readings_before_upsert()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE v_prev RECORD; v_mult numeric; v_delta numeric; v_daily numeric;
BEGIN
  IF COALESCE(NEW.is_meter_replacement, FALSE) THEN
    NEW.daily_consumption_kwh := 0; NEW.daily_grid_kwh := 0; RETURN NEW;
  END IF;
  IF NEW.meter_reading_kwh IS NULL THEN RETURN NEW; END IF;
  v_mult := public._get_power_multiplier(NEW.plant_id);
  SELECT meter_reading_kwh INTO v_prev FROM public.power_readings
   WHERE plant_id = NEW.plant_id AND reading_datetime < NEW.reading_datetime
     AND (TG_OP = 'INSERT' OR id <> NEW.id)
     AND NOT COALESCE(is_meter_replacement, FALSE) AND meter_reading_kwh IS NOT NULL
   ORDER BY reading_datetime DESC LIMIT 1;
  IF NOT FOUND OR v_prev.meter_reading_kwh IS NULL THEN RETURN NEW; END IF;
  v_delta := NEW.meter_reading_kwh - v_prev.meter_reading_kwh;
  v_daily := GREATEST(v_delta, 0) * v_mult;
  NEW.daily_consumption_kwh := v_daily; NEW.daily_grid_kwh := v_daily;
  RETURN NEW;
END;
$$;

-- 7. fn_power_readings_after_upsert
CREATE OR REPLACE FUNCTION public.fn_power_readings_after_upsert()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE v_successor_id uuid;
BEGIN
  IF COALESCE(current_setting('app.power_trigger_running', TRUE), 'false') = 'true' THEN RETURN NEW; END IF;
  PERFORM set_config('app.power_trigger_running', 'true', TRUE);
  BEGIN
    SELECT id INTO v_successor_id FROM public.power_readings
     WHERE plant_id = NEW.plant_id AND reading_datetime > NEW.reading_datetime
       AND NOT COALESCE(is_meter_replacement, FALSE)
     ORDER BY reading_datetime ASC LIMIT 1;
    IF FOUND THEN PERFORM public._recompute_power_row(v_successor_id); END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM set_config('app.power_trigger_running', 'false', TRUE);
  RETURN NEW;
END;
$$;

-- 8. fn_power_readings_after_delete
CREATE OR REPLACE FUNCTION public.fn_power_readings_after_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE v_successor_id uuid;
BEGIN
  IF COALESCE(current_setting('app.power_trigger_running', TRUE), 'false') = 'true' THEN RETURN OLD; END IF;
  PERFORM set_config('app.power_trigger_running', 'true', TRUE);
  BEGIN
    SELECT id INTO v_successor_id FROM public.power_readings
     WHERE plant_id = OLD.plant_id AND reading_datetime > OLD.reading_datetime
       AND NOT COALESCE(is_meter_replacement, FALSE)
     ORDER BY reading_datetime ASC LIMIT 1;
    IF FOUND THEN PERFORM public._recompute_power_row(v_successor_id); END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM set_config('app.power_trigger_running', 'false', TRUE);
  RETURN OLD;
END;
$$;

-- 9. fn_recalc_power_cache
CREATE OR REPLACE FUNCTION public.fn_recalc_power_cache(p_plant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_multipliers numeric[]; rec record;
  prev_meter_kwh numeric := NULL; prev_gmr jsonb := NULL; after_repl boolean := false;
  delta_raw numeric; total_kwh numeric; slot_key text;
  slot_curr numeric; slot_prev numeric; slot_mult numeric; slot_idx int;
BEGIN
  SELECT COALESCE(grid_meter_multipliers, ARRAY[1::numeric]) INTO v_multipliers
    FROM public.plant_power_config WHERE plant_id = p_plant_id;
  IF v_multipliers IS NULL THEN v_multipliers := ARRAY[1::numeric]; END IF;
  FOR rec IN SELECT id, reading_datetime, meter_reading_kwh, grid_meter_readings, is_meter_replacement
    FROM public.power_readings WHERE plant_id = p_plant_id ORDER BY reading_datetime ASC
  LOOP
    IF rec.is_meter_replacement THEN
      prev_meter_kwh := rec.meter_reading_kwh; prev_gmr := rec.grid_meter_readings; after_repl := true;
      UPDATE public.power_readings SET daily_grid_kwh = 0, daily_consumption_kwh = 0, cache_recalculated_at = NOW() WHERE id = rec.id;
      CONTINUE;
    END IF;
    total_kwh := NULL;
    IF NOT after_repl THEN
      IF rec.grid_meter_readings IS NOT NULL AND jsonb_typeof(rec.grid_meter_readings) = 'object'
         AND prev_gmr IS NOT NULL AND jsonb_typeof(prev_gmr) = 'object' THEN
        total_kwh := 0;
        FOR slot_key IN SELECT jsonb_object_keys(rec.grid_meter_readings) LOOP
          slot_curr := (rec.grid_meter_readings ->> slot_key)::numeric;
          slot_prev := (prev_gmr ->> slot_key)::numeric;
          IF slot_curr IS NOT NULL AND slot_prev IS NOT NULL AND (slot_curr - slot_prev) >= 0 THEN
            slot_idx := slot_key::int + 1;
            slot_mult := COALESCE(v_multipliers[slot_idx], v_multipliers[1], 1);
            total_kwh := total_kwh + (slot_curr - slot_prev) * slot_mult;
          ELSE total_kwh := NULL; EXIT; END IF;
        END LOOP;
      END IF;
      IF total_kwh IS NULL AND rec.meter_reading_kwh IS NOT NULL AND prev_meter_kwh IS NOT NULL
         AND (rec.meter_reading_kwh - prev_meter_kwh) >= 0 THEN
        delta_raw := rec.meter_reading_kwh - prev_meter_kwh;
        total_kwh := delta_raw * COALESCE(v_multipliers[1], 1);
      END IF;
    END IF;
    after_repl := false;
    IF total_kwh IS NOT NULL AND total_kwh >= 0 THEN
      UPDATE public.power_readings SET daily_grid_kwh = total_kwh, daily_consumption_kwh = total_kwh,
        cache_recalculated_at = NOW() WHERE id = rec.id;
    END IF;
    prev_meter_kwh := rec.meter_reading_kwh; prev_gmr := rec.grid_meter_readings;
  END LOOP;
END;
$$;

-- 10. fn_trg_invalidate_power_cache
CREATE OR REPLACE FUNCTION public.fn_trg_invalidate_power_cache()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF TG_OP = 'UPDATE' AND OLD.grid_meter_multipliers IS NOT DISTINCT FROM NEW.grid_meter_multipliers THEN RETURN NEW; END IF;
    PERFORM public.fn_recalc_power_cache(NEW.plant_id); RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE public.power_readings SET daily_grid_kwh = NULL, daily_consumption_kwh = NULL, cache_recalculated_at = NOW()
     WHERE plant_id = OLD.plant_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- 11. fn_trg_recalc_successor
CREATE OR REPLACE FUNCTION public.fn_trg_recalc_successor()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_multipliers numeric[]; v_next record; total_kwh numeric := 0;
  slot_key text; slot_curr numeric; slot_prev numeric; slot_mult numeric; slot_idx int;
BEGIN
  SELECT COALESCE(grid_meter_multipliers, ARRAY[1::numeric]) INTO v_multipliers
    FROM public.plant_power_config WHERE plant_id = NEW.plant_id;
  IF v_multipliers IS NULL THEN v_multipliers := ARRAY[1::numeric]; END IF;
  SELECT id, meter_reading_kwh, grid_meter_readings, is_meter_replacement INTO v_next
    FROM public.power_readings
   WHERE plant_id = NEW.plant_id AND reading_datetime > NEW.reading_datetime AND NOT COALESCE(is_meter_replacement, false)
   ORDER BY reading_datetime ASC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  total_kwh := 0;
  IF v_next.grid_meter_readings IS NOT NULL AND jsonb_typeof(v_next.grid_meter_readings) = 'object'
     AND NEW.grid_meter_readings IS NOT NULL AND jsonb_typeof(NEW.grid_meter_readings::jsonb) = 'object' THEN
    FOR slot_key IN SELECT jsonb_object_keys(v_next.grid_meter_readings) LOOP
      slot_curr := (v_next.grid_meter_readings ->> slot_key)::numeric;
      slot_prev := (NEW.grid_meter_readings::jsonb ->> slot_key)::numeric;
      IF slot_curr IS NOT NULL AND slot_prev IS NOT NULL AND (slot_curr - slot_prev) >= 0 THEN
        slot_idx := slot_key::int + 1;
        slot_mult := COALESCE(v_multipliers[slot_idx], v_multipliers[1], 1);
        total_kwh := total_kwh + (slot_curr - slot_prev) * slot_mult;
      END IF;
    END LOOP;
  ELSIF v_next.meter_reading_kwh IS NOT NULL AND NEW.meter_reading_kwh IS NOT NULL
        AND (v_next.meter_reading_kwh - NEW.meter_reading_kwh) >= 0 THEN
    total_kwh := (v_next.meter_reading_kwh - NEW.meter_reading_kwh) * COALESCE(v_multipliers[1], 1);
  END IF;
  IF total_kwh > 0 THEN
    UPDATE public.power_readings SET daily_grid_kwh = total_kwh, daily_consumption_kwh = total_kwh,
      cache_recalculated_at = NOW() WHERE id = v_next.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 12. recalc_power_cache_for_plant
CREATE OR REPLACE FUNCTION public.recalc_power_cache_for_plant(p_plant_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.fn_recalc_power_cache(p_plant_id);
  RETURN 'OK: cache recalculated for plant ' || p_plant_id::text;
END;
$$;

-- 13. resolve_plant_multiplier (DROP + recreate to remove old parameter defaults)
DROP FUNCTION IF EXISTS public.resolve_plant_multiplier(uuid, integer);
CREATE FUNCTION public.resolve_plant_multiplier(p_plant_id uuid, p_meter_index integer)
RETURNS numeric LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT grid_meter_multipliers[p_meter_index] FROM public.plant_power_config
      WHERE plant_id = p_plant_id AND p_meter_index BETWEEN 1 AND array_length(grid_meter_multipliers, 1) LIMIT 1),
    1);
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_plant_multiplier(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_plant_multiplier(uuid, integer) TO authenticated;

-- 14. refresh_plant_multiplier_cache
CREATE OR REPLACE FUNCTION public.refresh_plant_multiplier_cache(p_plant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_mults numeric[]; v_len int; v_idx int;
BEGIN
  SELECT grid_meter_multipliers INTO v_mults FROM public.plant_power_config WHERE plant_id = p_plant_id;
  IF v_mults IS NULL THEN v_mults := ARRAY[1::numeric]; END IF;
  v_len := array_length(v_mults, 1);
  DELETE FROM public.plant_multiplier_cache WHERE plant_id = p_plant_id;
  FOR v_idx IN 1 .. v_len LOOP
    INSERT INTO public.plant_multiplier_cache (plant_id, meter_index, effective_mult, cached_at, invalidated)
    VALUES (p_plant_id, v_idx, COALESCE(v_mults[v_idx], 1), now(), false);
  END LOOP;
END;
$$;

-- 15. trg_invalidate_multiplier_cache
CREATE OR REPLACE FUNCTION public.trg_invalidate_multiplier_cache()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE v_plant_id uuid := COALESCE(NEW.plant_id, OLD.plant_id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.plant_multiplier_cache WHERE plant_id = v_plant_id; RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.grid_meter_multipliers IS NOT DISTINCT FROM NEW.grid_meter_multipliers THEN RETURN NEW; END IF;
  UPDATE public.plant_multiplier_cache SET invalidated = true WHERE plant_id = v_plant_id;
  PERFORM public.refresh_plant_multiplier_cache(v_plant_id);
  RETURN NEW;
END;
$$;

-- 16. trg_stamp_reading_multiplier
CREATE OR REPLACE FUNCTION public.trg_stamp_reading_multiplier()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE v_index int := 1; v_mult numeric;
BEGIN
  SELECT effective_mult INTO v_mult FROM public.plant_multiplier_cache
   WHERE plant_id = NEW.plant_id AND meter_index = v_index AND invalidated = false;
  IF v_mult IS NULL THEN
    v_mult := public.resolve_plant_multiplier(NEW.plant_id, v_index);
    PERFORM public.refresh_plant_multiplier_cache(NEW.plant_id);
  END IF;
  NEW.meter_multiplier := COALESCE(v_mult, 1);
  RETURN NEW;
END;
$$;

-- 17. refresh_production_costs
CREATE OR REPLACE FUNCTION public.refresh_production_costs(
  p_plant_id uuid,
  p_from date DEFAULT (CURRENT_DATE - INTERVAL '90 days')::date,
  p_to   date DEFAULT CURRENT_DATE
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r_date date;
BEGIN
  r_date := p_from;
  WHILE r_date <= p_to LOOP
    INSERT INTO public.production_costs (plant_id, cost_date, power_cost, chem_cost)
    SELECT p_plant_id, r_date,
      COALESCE((SELECT ROUND(b.total_amount / GREATEST(1, (b.period_end - b.period_start + 1)), 2)
        FROM public.electric_bills b WHERE b.plant_id = p_plant_id AND b.period_start <= r_date AND b.period_end >= r_date
        ORDER BY b.billing_month DESC LIMIT 1), 0),
      COALESCE((SELECT ROUND(SUM(cu.quantity * cp.unit_price), 2)
        FROM public.chemical_usage cu
        JOIN public.chemical_prices cp ON cp.chemical_name = cu.chemical_name
          AND cp.effective_date = (SELECT MAX(cp2.effective_date) FROM public.chemical_prices cp2
            WHERE cp2.chemical_name = cu.chemical_name AND cp2.effective_date <= r_date)
        WHERE cu.plant_id = p_plant_id AND cu.usage_date = r_date), 0)
    ON CONFLICT (plant_id, cost_date) DO UPDATE
      SET power_cost = EXCLUDED.power_cost, chem_cost = EXCLUDED.chem_cost, updated_at = now();
    r_date := r_date + INTERVAL '1 day';
  END LOOP;
END;
$$;

-- 18. Flip remaining no-table-ref functions to search_path = ''
ALTER FUNCTION public.set_updated_at()                              SET search_path = '';
ALTER FUNCTION public.well_readings_compute_daily_volume()          SET search_path = '';
ALTER FUNCTION public.product_meter_readings_compute_daily_volume() SET search_path = '';
ALTER FUNCTION public.guard_permeate_delta()                        SET search_path = '';
ALTER FUNCTION public.chat_after_insert()                           SET search_path = '';
;
