-- =============================================================================
-- Migration: 20261017000001_fix_dashboard_rpcs_and_inbox_index.sql
-- Description:
--   1. Fixes get_dashboard_aggregates RPC where blending_events was queried for
--      non-existent column `daily_volume` instead of `volume_m3` (Postgres 42703).
--   2. Creates missing `public.latest_power_readings_before` RPC used by
--      Dashboard power telemetry (`usePowerStats.ts`) to eliminate 404 PGRST202
--      and N+1 per-plant fallback queries.
--   3. Adds partial indexes for negative daily_volume inbox queries on
--      `locator_readings`, `well_readings`, and `product_meter_readings` so
--      review badge counts execute in <5ms instead of timing out with HTTP 500.
-- =============================================================================

-- ── 1. Fix get_dashboard_aggregates (blending_events.volume_m3) ───────────────

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
  v_authorized_ids        uuid[];
BEGIN
  -- Filter p_plant_ids to only authorized plants
  SELECT COALESCE(array_agg(p.id), '{}'::uuid[])
  INTO v_authorized_ids
  FROM unnest(COALESCE(p_plant_ids, '{}'::uuid[])) p(id)
  WHERE public.user_has_plant_access(p.id);

  IF v_authorized_ids IS NULL OR array_length(v_authorized_ids, 1) = 0 THEN
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

  -- 1. Raw Water (well_readings)
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0)
  INTO v_raw_water_today, v_raw_water_yesterday
  FROM public.well_readings
  WHERE plant_id = ANY(v_authorized_ids)
    AND reading_datetime >= p_yesterday_start
    AND reading_datetime <= p_today_end
    AND (is_meter_replacement IS NOT TRUE);

  -- 2. Consumption (locator_readings)
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0)
  INTO v_consumption_today, v_consumption_yesterday
  FROM public.locator_readings
  WHERE plant_id = ANY(v_authorized_ids)
    AND reading_datetime >= p_yesterday_start
    AND reading_datetime <= p_today_end
    AND (is_meter_replacement IS NOT TRUE)
    AND COALESCE(norm_status, 'normal') <> 'retracted';

  -- 3. Production (product_meter_readings)
  SELECT
    COALESCE(SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END), 0)
  INTO v_production_today, v_production_yesterday
  FROM public.product_meter_readings
  WHERE plant_id = ANY(v_authorized_ids)
    AND reading_datetime >= p_yesterday_start
    AND reading_datetime <= p_today_end
    AND (is_meter_replacement IS NOT TRUE);

  -- 4. Blending Today (blending_events uses volume_m3)
  SELECT
    COALESCE(SUM(COALESCE(volume_m3, 0)), 0)
  INTO v_blending_today
  FROM public.blending_events
  WHERE plant_id = ANY(v_authorized_ids)
    AND event_date = p_today_date
    AND (is_meter_replacement IS NOT TRUE);

  IF v_production_today > 0 THEN
    v_nrw_today := ROUND(((v_production_today - v_consumption_today) / v_production_today) * 100, 1);
  END IF;
  IF v_production_yesterday > 0 THEN
    v_nrw_yesterday := ROUND(((v_production_yesterday - v_consumption_yesterday) / v_production_yesterday) * 100, 1);
  END IF;

  -- 5. Per-plant breakdown
  WITH plant_scope AS (
    SELECT p.id AS plant_id, p.name AS plant_name, p.status
    FROM public.plants p
    WHERE p.id = ANY(v_authorized_ids)
  ),
  pw AS (
    SELECT plant_id,
      SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS rw_t,
      SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS rw_y
    FROM public.well_readings
    WHERE plant_id = ANY(v_authorized_ids)
      AND reading_datetime >= p_yesterday_start AND reading_datetime <= p_today_end
      AND (is_meter_replacement IS NOT TRUE)
    GROUP BY plant_id
  ),
  pl AS (
    SELECT plant_id,
      SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS con_t,
      SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS con_y
    FROM public.locator_readings
    WHERE plant_id = ANY(v_authorized_ids)
      AND reading_datetime >= p_yesterday_start AND reading_datetime <= p_today_end
      AND (is_meter_replacement IS NOT TRUE)
      AND COALESCE(norm_status, 'normal') <> 'retracted'
    GROUP BY plant_id
  ),
  pm AS (
    SELECT plant_id,
      SUM(CASE WHEN reading_datetime >= p_today_start AND reading_datetime <= p_today_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS prod_t,
      SUM(CASE WHEN reading_datetime >= p_yesterday_start AND reading_datetime <= p_yesterday_end THEN COALESCE(daily_volume, 0) ELSE 0 END) AS prod_y
    FROM public.product_meter_readings
    WHERE plant_id = ANY(v_authorized_ids)
      AND reading_datetime >= p_yesterday_start AND reading_datetime <= p_today_end
      AND (is_meter_replacement IS NOT TRUE)
    GROUP BY plant_id
  ),
  pb AS (
    SELECT plant_id,
      SUM(COALESCE(volume_m3, 0)) AS blend_t
    FROM public.blending_events
    WHERE plant_id = ANY(v_authorized_ids)
      AND event_date = p_today_date
      AND (is_meter_replacement IS NOT TRUE)
    GROUP BY plant_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'plant_id', ps.plant_id,
    'plant_name', ps.plant_name,
    'status', ps.status,
    'raw_water_vol', COALESCE(pw.rw_t, 0),
    'y_raw_water_vol', COALESCE(pw.rw_y, 0),
    'production', COALESCE(pm.prod_t, 0),
    'y_production', COALESCE(pm.prod_y, 0),
    'consumption', COALESCE(pl.con_t, 0),
    'y_consumption', COALESCE(pl.con_y, 0),
    'blending', COALESCE(pb.blend_t, 0),
    'nrw', CASE WHEN COALESCE(pm.prod_t, 0) > 0
      THEN ROUND(((COALESCE(pm.prod_t, 0) - COALESCE(pl.con_t, 0)) / COALESCE(pm.prod_t, 0)) * 100, 1)
      ELSE NULL END
  )), '[]'::jsonb)
  INTO v_by_plant
  FROM plant_scope ps
  LEFT JOIN pw ON pw.plant_id = ps.plant_id
  LEFT JOIN pl ON pl.plant_id = ps.plant_id
  LEFT JOIN pm ON pm.plant_id = ps.plant_id
  LEFT JOIN pb ON pb.plant_id = ps.plant_id;

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

GRANT EXECUTE ON FUNCTION public.get_dashboard_aggregates(uuid[], timestamptz, timestamptz, timestamptz, timestamptz, date) TO authenticated, service_role;

-- ── 2. Create latest_power_readings_before RPC ────────────────────────────────

CREATE OR REPLACE FUNCTION public.latest_power_readings_before(
  plant_ids uuid[],
  before_ts timestamptz
)
RETURNS TABLE (
  plant_id              uuid,
  reading_datetime      timestamptz,
  daily_consumption_kwh numeric,
  daily_grid_kwh        numeric,
  meter_reading_kwh     numeric,
  grid_meter_readings   jsonb,
  is_meter_replacement  boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (pr.plant_id)
    pr.plant_id,
    pr.reading_datetime,
    pr.daily_consumption_kwh,
    pr.daily_grid_kwh,
    pr.meter_reading_kwh,
    pr.grid_meter_readings,
    pr.is_meter_replacement
  FROM public.power_readings pr
  WHERE pr.plant_id = ANY(COALESCE(plant_ids, '{}'::uuid[]))
    AND public.user_has_plant_access(pr.plant_id)
    AND pr.reading_datetime < before_ts
  ORDER BY pr.plant_id, pr.reading_datetime DESC;
$$;

GRANT EXECUTE ON FUNCTION public.latest_power_readings_before(uuid[], timestamptz) TO authenticated, service_role;

-- ── 3. Partial indexes for negative daily_volume review inbox ─────────────────

CREATE INDEX IF NOT EXISTS idx_locator_readings_negative_inbox
  ON public.locator_readings (plant_id, reading_datetime DESC)
  WHERE norm_status = 'normal' AND daily_volume < 0 AND is_meter_replacement = false;

CREATE INDEX IF NOT EXISTS idx_well_readings_negative_inbox
  ON public.well_readings (plant_id, reading_datetime DESC)
  WHERE norm_status = 'normal' AND daily_volume < 0 AND is_meter_replacement = false;

CREATE INDEX IF NOT EXISTS idx_product_meter_readings_negative_inbox
  ON public.product_meter_readings (plant_id, reading_datetime DESC)
  WHERE norm_status = 'normal' AND daily_volume < 0 AND is_meter_replacement = false;

