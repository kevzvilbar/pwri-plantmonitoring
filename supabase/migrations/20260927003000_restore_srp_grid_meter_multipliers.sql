-- =============================================================================
-- Migration: 20260927003000_restore_srp_grid_meter_multipliers.sql
--
-- DATA REPAIR: Restore SRP's multi-grid-meter configuration and CT multipliers.
--
-- SRP has three physical grid meters, each behind its own current-transformer
-- (CT) ratio, so a raw meter delta must be scaled before it represents real
-- kWh:
--
--   Grid Meter 1 STP        x1
--   Grid Meter 2 Pumphouse  x120
--   Grid Meter 3 Main       x2400
--
-- This configuration lives in plant_power_config.grid_meter_names /
-- grid_meter_multipliers and was overwritten back to the single-meter
-- default ({"Grid Meter 1"} x1) by the usePlantPowerConfig dual-persistence
-- commit (12a1f905) before the "prefer richer local config over a blank DB
-- row" guard existed (added later in e569b0f9). Any client without a warm
-- localStorage cache — a fresh sync, a new device/browser — read the blank
-- DB default and, in the worst case, re-saved it, so the 3-meter setup was
-- lost at the source of truth.
--
-- This migration restores the three-meter row directly in the database. It
-- only touches the grid_meter_* columns (solar config, if any, is left
-- untouched), only applies while the row is still on the blank single-meter
-- default, and is safe to re-run.
-- =============================================================================

DO $do$
DECLARE
  v_srp_id uuid;
  v_rows_updated int;
BEGIN
  SELECT id INTO v_srp_id FROM public.plants WHERE name ILIKE '%SRP%' LIMIT 1;

  IF v_srp_id IS NULL THEN
    RAISE NOTICE 'restore_srp_grid_meter_multipliers: no plant matching %%SRP%% found, skipping';
    RETURN;
  END IF;

  INSERT INTO public.plant_power_config (
    plant_id,
    grid_meter_count,
    grid_meter_names,
    grid_meter_multipliers,
    grid_meter_multipliers_enabled,
    solar_meter_count,
    solar_meter_names,
    solar_meter_multipliers,
    solar_meter_multipliers_enabled,
    updated_at
  )
  VALUES (
    v_srp_id,
    3,
    ARRAY['Grid Meter 1 STP', 'Grid Meter 2 Pumphouse', 'Grid Meter 3 Main'],
    ARRAY[1, 120, 2400]::numeric[],
    ARRAY[false, true, true]::boolean[],
    1,
    ARRAY['Solar Meter 1'],
    ARRAY[1]::numeric[],
    ARRAY[false]::boolean[],
    now()
  )
  ON CONFLICT (plant_id) DO UPDATE
  SET grid_meter_count = 3,
      grid_meter_names = ARRAY['Grid Meter 1 STP', 'Grid Meter 2 Pumphouse', 'Grid Meter 3 Main'],
      grid_meter_multipliers = ARRAY[1, 120, 2400]::numeric[],
      grid_meter_multipliers_enabled = ARRAY[false, true, true]::boolean[],
      updated_at = now()
  -- Guard: only overwrite a row still stuck on the blank single-meter
  -- default, so this never clobbers a legitimate manual edit made since.
  WHERE public.plant_power_config.grid_meter_count <= 1;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RAISE NOTICE 'restore_srp_grid_meter_multipliers: % row(s) applied for plant %', v_rows_updated, v_srp_id;
END;
$do$;
