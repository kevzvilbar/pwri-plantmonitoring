-- =============================================================================
-- meter_multiplier_historical_backfill_audit.sql
--
-- READ-ONLY. Finds locator_readings / well_readings / product_meter_readings
-- rows that predate 20260926000001_meter_multiplier_feature.sql and therefore
-- carry multiplier_at_reading = 1 from the column's DEFAULT rather than any
-- real multiplier logic, for entities that are currently multiplier_enabled.
--
-- Nothing here writes to the database. Run in Supabase Dashboard -> SQL Editor.
--
-- PILOT MODE (Decision 1):
--   Keep `AND l.name ILIKE '%UHRI (8)%'` (or `l.id = '<id>'`) enabled in
--   locator_candidates below to audit "UHRI (8)" first.
--
-- EXPANSION MODE (Decision 1):
--   Comment out the pilot filter line across all three candidate queries to
--   scan every multiplier-enabled entity in the database.
--
-- See docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md for full context.
-- =============================================================================

WITH locator_candidates AS (
  SELECT
    'locator'::text AS source,
    lr.id,
    lr.locator_id AS entity_id,
    l.name AS entity_name,
    l.plant_id,
    l.meter_multiplier AS live_multiplier,
    l.multiplier_enabled AS live_enabled,
    lr.reading_datetime,
    lr.current_reading,
    lr.previous_reading,
    lr.multiplier_at_reading AS stored_multiplier,
    lr.daily_volume AS stored_daily_volume,
    CASE
      WHEN COALESCE(lr.is_meter_replacement, false) THEN 0
      WHEN COALESCE(lr.is_meter_rollover, false) AND lr.meter_rollover_max IS NOT NULL
        THEN GREATEST(0, (lr.meter_rollover_max - COALESCE(lr.previous_reading, 0) + lr.current_reading) * l.meter_multiplier)
      ELSE GREATEST(0, (lr.current_reading - COALESCE(lr.previous_reading, 0)) * l.meter_multiplier)
    END AS recomputed_daily_volume,
    lr.is_meter_replacement,
    lr.is_meter_rollover,
    lr.norm_status,
    lr.remarks
  FROM public.locator_readings lr
  JOIN public.locators l ON l.id = lr.locator_id
  WHERE lr.multiplier_at_reading = 1
    AND l.multiplier_enabled = true
    AND l.meter_multiplier <> 1
    AND NOT COALESCE(lr.is_meter_replacement, false)
    AND l.name ILIKE '%UHRI (8)%'  -- PILOT (Decision 1): comment out for full scan
),

well_candidates AS (
  SELECT
    'well'::text AS source,
    wr.id,
    wr.well_id AS entity_id,
    w.name AS entity_name,
    w.plant_id,
    w.meter_multiplier AS live_multiplier,
    w.multiplier_enabled AS live_enabled,
    wr.reading_datetime,
    wr.current_reading,
    wr.previous_reading,
    wr.multiplier_at_reading AS stored_multiplier,
    wr.daily_volume AS stored_daily_volume,
    CASE
      WHEN COALESCE(wr.is_meter_replacement, false) THEN 0
      WHEN COALESCE(wr.is_meter_rollover, false) AND wr.meter_rollover_max IS NOT NULL
        THEN GREATEST(0, (wr.meter_rollover_max - COALESCE(wr.previous_reading, 0) + wr.current_reading) * w.meter_multiplier)
      ELSE GREATEST(0, (wr.current_reading - COALESCE(wr.previous_reading, 0)) * w.meter_multiplier)
    END AS recomputed_daily_volume,
    wr.is_meter_replacement,
    wr.is_meter_rollover,
    wr.norm_status,
    wr.remarks
  FROM public.well_readings wr
  JOIN public.wells w ON w.id = wr.well_id
  WHERE wr.multiplier_at_reading = 1
    AND w.multiplier_enabled = true
    AND w.meter_multiplier <> 1
    AND NOT COALESCE(wr.is_meter_replacement, false)
    -- AND w.id = '<well_id>'  -- Optional single-entity filter
),

product_candidates AS (
  SELECT
    'product'::text AS source,
    pmr.id,
    pmr.product_meter_id AS entity_id,
    pm.name AS entity_name,
    pm.plant_id,
    pm.meter_multiplier AS live_multiplier,
    pm.multiplier_enabled AS live_enabled,
    pmr.reading_datetime,
    pmr.current_reading,
    pmr.previous_reading,
    pmr.multiplier_at_reading AS stored_multiplier,
    pmr.daily_volume AS stored_daily_volume,
    CASE
      WHEN COALESCE(pmr.is_meter_replacement, false) THEN 0
      WHEN COALESCE(pmr.is_meter_rollover, false) AND pmr.meter_rollover_max IS NOT NULL
        THEN GREATEST(0, (pmr.meter_rollover_max - COALESCE(pmr.previous_reading, 0) + pmr.current_reading) * pm.meter_multiplier)
      ELSE GREATEST(0, (pmr.current_reading - COALESCE(pmr.previous_reading, 0)) * pm.meter_multiplier)
    END AS recomputed_daily_volume,
    pmr.is_meter_replacement,
    pmr.is_meter_rollover,
    pmr.norm_status,
    pmr.remarks
  FROM public.product_meter_readings pmr
  JOIN public.product_meters pm ON pm.id = pmr.product_meter_id
  WHERE pmr.multiplier_at_reading = 1
    AND pm.multiplier_enabled = true
    AND pm.meter_multiplier <> 1
    AND NOT COALESCE(pmr.is_meter_replacement, false)
    -- AND pm.id = '<product_meter_id>'  -- Optional single-entity filter
)

SELECT
  source,
  id,
  entity_id,
  entity_name,
  plant_id,
  reading_datetime,
  current_reading,
  previous_reading,
  stored_multiplier,
  live_multiplier AS target_multiplier,
  stored_daily_volume,
  recomputed_daily_volume,
  (recomputed_daily_volume - stored_daily_volume) AS drift_m3,
  is_meter_replacement,
  is_meter_rollover,
  norm_status,
  remarks
FROM (
  SELECT * FROM locator_candidates
  UNION ALL
  SELECT * FROM well_candidates
  UNION ALL
  SELECT * FROM product_candidates
) all_candidates
ORDER BY source, entity_name, reading_datetime;
