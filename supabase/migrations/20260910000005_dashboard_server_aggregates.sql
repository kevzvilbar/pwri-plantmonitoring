-- =============================================================================
-- Migration: 20260910000005_dashboard_server_aggregates.sql
-- Description: Server-side aggregation RPC for "All Facilities" and per-plant
--              dashboard views. Replaces browser-side row-walking and pivot
--              reductions across multiple large reading tables.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_aggregates(
  p_plant_ids         uuid[],
  p_today_start       timestamptz,
  p_today_end         timestamptz,
  p_yesterday_start   timestamptz,
  p_yesterday_end     timestamptz,
  p_today_date        date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw_water_today       numeric := 0;
  v_raw_water_yesterday   numeric := 0;
  v_consumption_today     numeric := 0;
  v_consumption_yesterday numeric := 0;
  v_production_today      numeric := 0;
  v_production_yesterday  numeric := 0;
  v_blending_today        numeric := 0;
  v_nrw_today             numeric := NULL;
  v_nrw_yesterday         numeric := NULL;
  v_by_plant              jsonb := '[]'::jsonb;
BEGIN
  IF p_plant_ids IS NULL OR array_length(p_plant_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'raw_water_vol', 0,
      'y_raw_water_vol', 0,
      'production', 0,
      'y_production', 0,
      'consumption', 0,
      'y_consumption', 0,
      'blending', 0,
      'nrw', NULL,
      'y_nrw', NULL,
      'by_plant', '[]'::jsonb
    );
  END IF;

  -- ── 1. Raw Water (well_readings) ──────────────────────────────────────────
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0)
  INTO v_raw_water_today, v_raw_water_yesterday
  FROM public.well_readings
  WHERE plant_id = ANY(p_plant_ids)
    AND reading_datetime >= p_yesterday_start
    AND reading_datetime <= p_today_end
    AND (is_meter_replacement IS NOT TRUE);

  -- ── 2. Consumption (locator_readings) ─────────────────────────────────────
  WITH locator_deltas AS (
    SELECT
      lr.plant_id,
      lr.reading_datetime,
      CASE
        WHEN lr.is_meter_replacement IS TRUE THEN 0
        WHEN l.default_input_mode = 'direct' OR l.is_derived IS TRUE THEN GREATEST(0, COALESCE(lr.current_reading, 0))
        ELSE GREATEST(0, COALESCE(lr.daily_volume, lr.current_reading - COALESCE(lr.previous_reading, lr.current_reading), 0))
      END AS delta_m3
    FROM public.locator_readings lr
    JOIN public.locators l ON l.id = lr.locator_id
    WHERE lr.plant_id = ANY(p_plant_ids)
      AND l.status = 'Active'
      AND lr.reading_datetime >= p_yesterday_start
      AND lr.reading_datetime <= p_today_end
  )
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN delta_m3 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN delta_m3 ELSE 0 END), 0)
  INTO v_consumption_today, v_consumption_yesterday
  FROM locator_deltas;

  -- ── 3. Production Configuration (plant_meter_config) ──────────────────────
  CREATE TEMP TABLE _pm_cfg ON COMMIT DROP AS
  SELECT
    plant_id,
    COALESCE(permeate_is_production, (config->>'permeate_is_production')::boolean, false) AS permeate_is_prod,
    (config->>'ro_production_source' = 'permeate' AND COALESCE(permeate_is_production, (config->>'permeate_is_production')::boolean, false)) AS is_product_excluded
  FROM public.plant_meter_config
  WHERE plant_id = ANY(p_plant_ids);

  -- ── 4. Product Meters Production ──────────────────────────────────────────
  WITH pm_deltas AS (
    SELECT
      pmr.plant_id,
      pmr.reading_datetime,
      CASE
        WHEN pm.is_derived IS TRUE THEN GREATEST(0, COALESCE(pmr.current_reading, 0))
        ELSE GREATEST(0, COALESCE(pmr.daily_volume, pmr.current_reading - COALESCE(pmr.previous_reading, pmr.current_reading), 0))
      END AS delta_m3
    FROM public.product_meter_readings pmr
    JOIN public.product_meters pm ON pm.id = pmr.meter_id
    LEFT JOIN _pm_cfg cfg ON cfg.plant_id = pmr.plant_id
    WHERE pmr.plant_id = ANY(p_plant_ids)
      AND COALESCE(cfg.is_product_excluded, false) IS FALSE
      AND pmr.reading_datetime >= p_yesterday_start
      AND pmr.reading_datetime <= p_today_end
  )
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN delta_m3 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN delta_m3 ELSE 0 END), 0)
  INTO v_production_today, v_production_yesterday
  FROM pm_deltas;

  -- ── 5. Permeate Production (ro_train_readings for permeate plants) ─────────
  WITH ro_permeate AS (
    SELECT
      t.plant_id,
      rtr.reading_datetime,
      COALESCE(rtr.permeate_meter_delta, 0) AS permeate_delta
    FROM public.ro_train_readings rtr
    JOIN public.ro_trains t ON t.id = rtr.train_id
    JOIN _pm_cfg cfg ON cfg.plant_id = t.plant_id AND cfg.permeate_is_prod IS TRUE
    WHERE t.plant_id = ANY(p_plant_ids)
      AND COALESCE(t.unit_type, 'primary') != 'secondary'
      AND rtr.reading_datetime >= p_yesterday_start
      AND rtr.reading_datetime <= p_today_end
      AND rtr.permeate_meter_delta IS NOT NULL
      AND rtr.permeate_meter_delta > 0
  )
  SELECT
    v_production_today + COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN permeate_delta ELSE 0 END), 0),
    v_production_yesterday + COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN permeate_delta ELSE 0 END), 0)
  INTO v_production_today, v_production_yesterday
  FROM ro_permeate;

  -- Fallback: if no product meter readings or permeate readings found, check all non-secondary RO trains
  IF v_production_today = 0 THEN
    SELECT COALESCE(SUM(COALESCE(rtr.permeate_meter_delta, 0)), 0)
    INTO v_production_today
    FROM public.ro_train_readings rtr
    JOIN public.ro_trains t ON t.id = rtr.train_id
    WHERE t.plant_id = ANY(p_plant_ids)
      AND COALESCE(t.unit_type, 'primary') != 'secondary'
      AND rtr.reading_datetime >= p_today_start
      AND rtr.reading_datetime <= p_today_end
      AND rtr.permeate_meter_delta IS NOT NULL
      AND rtr.permeate_meter_delta > 0;
  END IF;

  -- ── 6. Blending Volume (blending_events) ───────────────────────────────────
  SELECT COALESCE(SUM(COALESCE(volume_m3, 0)), 0)
  INTO v_blending_today
  FROM public.blending_events
  WHERE plant_id = ANY(p_plant_ids)
    AND event_date = p_today_date;

  -- ── 7. NRW Calculations ───────────────────────────────────────────────────
  IF v_production_today > 0 THEN
    v_nrw_today := ROUND(((v_production_today - v_consumption_today) / v_production_today * 100.0), 2);
  END IF;

  IF v_production_yesterday > 0 THEN
    v_nrw_yesterday := ROUND(((v_production_yesterday - v_consumption_yesterday) / v_production_yesterday * 100.0), 2);
  END IF;

  -- ── 8. Per-Plant Rollup Breakdown ─────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(plant_row), '[]'::jsonb)
  INTO v_by_plant
  FROM (
    SELECT
      p.id AS plant_id,
      p.name AS plant_name,
      COALESCE(w.vol, 0) AS raw_water_vol,
      COALESCE(prod.vol, 0) AS production,
      COALESCE(c.vol, 0) AS consumption,
      COALESCE(b.vol, 0) AS blending,
      CASE
        WHEN COALESCE(prod.vol, 0) > 0
        THEN ROUND(((COALESCE(prod.vol, 0) - COALESCE(c.vol, 0)) / prod.vol * 100.0), 2)
        ELSE NULL
      END AS nrw
    FROM unnest(p_plant_ids) pid
    JOIN public.plants p ON p.id = pid
    LEFT JOIN (
      SELECT plant_id, SUM(COALESCE(daily_volume, 0)) AS vol
      FROM public.well_readings
      WHERE plant_id = ANY(p_plant_ids)
        AND reading_datetime >= p_today_start
        AND reading_datetime <= p_today_end
        AND (is_meter_replacement IS NOT TRUE)
      GROUP BY plant_id
    ) w ON w.plant_id = p.id
    LEFT JOIN (
      SELECT lr.plant_id, SUM(
        CASE
          WHEN lr.is_meter_replacement IS TRUE THEN 0
          WHEN l.default_input_mode = 'direct' OR l.is_derived IS TRUE THEN GREATEST(0, COALESCE(lr.current_reading, 0))
          ELSE GREATEST(0, COALESCE(lr.daily_volume, lr.current_reading - COALESCE(lr.previous_reading, lr.current_reading), 0))
        END
      ) AS vol
      FROM public.locator_readings lr
      JOIN public.locators l ON l.id = lr.locator_id
      WHERE lr.plant_id = ANY(p_plant_ids)
        AND l.status = 'Active'
        AND lr.reading_datetime >= p_today_start
        AND lr.reading_datetime <= p_today_end
      GROUP BY lr.plant_id
    ) c ON c.plant_id = p.id
    LEFT JOIN (
      SELECT pmr.plant_id, SUM(
        CASE
          WHEN pm.is_derived IS TRUE THEN GREATEST(0, COALESCE(pmr.current_reading, 0))
          ELSE GREATEST(0, COALESCE(pmr.daily_volume, pmr.current_reading - COALESCE(pmr.previous_reading, pmr.current_reading), 0))
        END
      ) AS vol
      FROM public.product_meter_readings pmr
      JOIN public.product_meters pm ON pm.id = pmr.meter_id
      LEFT JOIN _pm_cfg cfg ON cfg.plant_id = pmr.plant_id
      WHERE pmr.plant_id = ANY(p_plant_ids)
        AND COALESCE(cfg.is_product_excluded, false) IS FALSE
        AND pmr.reading_datetime >= p_today_start
        AND pmr.reading_datetime <= p_today_end
      GROUP BY pmr.plant_id
    ) prod ON prod.plant_id = p.id
    LEFT JOIN (
      SELECT plant_id, SUM(COALESCE(volume_m3, 0)) AS vol
      FROM public.blending_events
      WHERE plant_id = ANY(p_plant_ids)
        AND event_date = p_today_date
      GROUP BY plant_id
    ) b ON b.plant_id = p.id
  ) plant_row;

  RETURN jsonb_build_object(
    'raw_water_vol', v_raw_water_today,
    'y_raw_water_vol', v_raw_water_yesterday,
    'production', v_production_today,
    'y_production', v_production_yesterday,
    'consumption', v_consumption_today,
    'y_consumption', v_consumption_yesterday,
    'blending', v_blending_today,
    'nrw', v_nrw_today,
    'y_nrw', v_nrw_yesterday,
    'by_plant', v_by_plant
  );
END;
$$;

-- Security permissions
REVOKE EXECUTE ON FUNCTION public.get_dashboard_aggregates(uuid[], timestamptz, timestamptz, timestamptz, timestamptz, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_dashboard_aggregates(uuid[], timestamptz, timestamptz, timestamptz, timestamptz, date) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_aggregates IS
  'Server-side aggregate computation for production, consumption, raw water, NRW %, and blending for multi-facility and single-plant views.';

