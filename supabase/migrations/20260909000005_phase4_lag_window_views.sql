-- =============================================================================
-- Phase 4: Database Hardening - LAG() Window View Replacement for Chain Columns
-- =============================================================================
-- Replace stored previous_reading/daily_volume columns with computed views using
-- LAG() window functions. This eliminates the need for chain sync triggers entirely.
-- 
-- The views are designed to be drop-in replacements for the original tables in
-- most read queries. Write operations still use the base tables.

-- 1. Locator readings with computed chain columns
CREATE OR REPLACE VIEW public.locator_readings_with_chain
WITH (security_invoker = true) AS
SELECT 
  r.*,
  LAG(r.current_reading) OVER (PARTITION BY r.locator_id ORDER BY r.reading_datetime) AS computed_previous_reading,
  CASE 
    WHEN r.current_reading IS NOT NULL 
         AND LAG(r.current_reading) OVER (PARTITION BY r.locator_id ORDER BY r.reading_datetime) IS NOT NULL
    THEN r.current_reading - LAG(r.current_reading) OVER (PARTITION BY r.locator_id ORDER BY r.reading_datetime)
    ELSE NULL
  END AS computed_daily_volume,
  LAG(r.reading_datetime) OVER (PARTITION BY r.locator_id ORDER BY r.reading_datetime) AS computed_previous_datetime,
  LAG(r.recorded_by) OVER (PARTITION BY r.locator_id ORDER BY r.reading_datetime) AS computed_previous_operator
FROM public.locator_readings r;

-- 2. Well readings with computed chain columns
CREATE OR REPLACE VIEW public.well_readings_with_chain
WITH (security_invoker = true) AS
SELECT 
  r.*,
  LAG(r.current_reading) OVER (PARTITION BY r.well_id ORDER BY r.reading_datetime) AS computed_previous_reading,
  CASE 
    WHEN r.current_reading IS NOT NULL 
         AND LAG(r.current_reading) OVER (PARTITION BY r.well_id ORDER BY r.reading_datetime) IS NOT NULL
    THEN r.current_reading - LAG(r.current_reading) OVER (PARTITION BY r.well_id ORDER BY r.reading_datetime)
    ELSE NULL
  END AS computed_daily_volume,
  LAG(r.reading_datetime) OVER (PARTITION BY r.well_id ORDER BY r.reading_datetime) AS computed_previous_datetime,
  LAG(r.recorded_by) OVER (PARTITION BY r.well_id ORDER BY r.reading_datetime) AS computed_previous_operator
FROM public.well_readings r;

-- 3. RO train readings with computed chain columns
CREATE OR REPLACE VIEW public.ro_train_readings_with_chain
WITH (security_invoker = true) AS
SELECT 
  r.*,
  LAG(r.current_reading) OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime) AS computed_previous_reading,
  CASE 
    WHEN r.current_reading IS NOT NULL 
         AND LAG(r.current_reading) OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime) IS NOT NULL
    THEN r.current_reading - LAG(r.current_reading) OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime)
    ELSE NULL
  END AS computed_daily_volume,
  LAG(r.reading_datetime) OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime) AS computed_previous_datetime,
  LAG(r.recorded_by) OVER (PARTITION BY r.train_id ORDER BY r.reading_datetime) AS computed_previous_operator
FROM public.ro_train_readings r;

-- 4. Product meter readings with computed chain columns
CREATE OR REPLACE VIEW public.product_meter_readings_with_chain
WITH (security_invoker = true) AS
SELECT 
  r.*,
  LAG(r.current_reading) OVER (PARTITION BY r.meter_id ORDER BY r.reading_datetime) AS computed_previous_reading,
  CASE 
    WHEN r.current_reading IS NOT NULL 
         AND LAG(r.current_reading) OVER (PARTITION BY r.meter_id ORDER BY r.reading_datetime) IS NOT NULL
    THEN r.current_reading - LAG(r.current_reading) OVER (PARTITION BY r.meter_id ORDER BY r.reading_datetime)
    ELSE NULL
  END AS computed_daily_volume,
  LAG(r.reading_datetime) OVER (PARTITION BY r.meter_id ORDER BY r.reading_datetime) AS computed_previous_datetime,
  LAG(r.recorded_by) OVER (PARTITION BY r.meter_id ORDER BY r.reading_datetime) AS computed_previous_operator
FROM public.product_meter_readings r;

-- 5. Power readings with computed chain columns
CREATE OR REPLACE VIEW public.power_readings_with_chain
WITH (security_invoker = true) AS
SELECT 
  r.*,
  LAG(r.meter_reading_kwh) OVER (PARTITION BY r.plant_id ORDER BY r.reading_datetime) AS computed_previous_meter_reading,
  CASE 
    WHEN r.meter_reading_kwh IS NOT NULL 
         AND LAG(r.meter_reading_kwh) OVER (PARTITION BY r.plant_id ORDER BY r.reading_datetime) IS NOT NULL
    THEN r.meter_reading_kwh - LAG(r.meter_reading_kwh) OVER (PARTITION BY r.plant_id ORDER BY r.reading_datetime)
    ELSE NULL
  END AS computed_daily_consumption_kwh,
  LAG(r.daily_solar_kwh) OVER (PARTITION BY r.plant_id ORDER BY r.reading_datetime) AS computed_previous_solar_kwh,
  LAG(r.daily_grid_kwh) OVER (PARTITION BY r.plant_id ORDER BY r.reading_datetime) AS computed_previous_grid_kwh
FROM public.power_readings r;

-- 6. Blending events with computed chain columns
CREATE OR REPLACE VIEW public.blending_events_with_chain
WITH (security_invoker = true) AS
SELECT 
  r.*,
  LAG(r.volume_m3) OVER (PARTITION BY r.well_id ORDER BY r.event_date) AS computed_previous_volume,
  CASE 
    WHEN r.volume_m3 IS NOT NULL 
         AND LAG(r.volume_m3) OVER (PARTITION BY r.well_id ORDER BY r.event_date) IS NOT NULL
    THEN r.volume_m3 - LAG(r.volume_m3) OVER (PARTITION BY r.well_id ORDER BY r.event_date)
    ELSE NULL
  END AS computed_daily_volume,
  LAG(r.event_date) OVER (PARTITION BY r.well_id ORDER BY r.event_date) AS computed_previous_date,
  LAG(r.recorded_by) OVER (PARTITION BY r.well_id ORDER BY r.event_date) AS computed_previous_operator
FROM public.blending_events r;

-- 7. Latest readings views (using computed chain columns)
CREATE OR REPLACE VIEW public.locator_readings_latest_chain
WITH (security_invoker = true) AS
SELECT DISTINCT ON (locator_id) *
FROM public.locator_readings_with_chain
ORDER BY locator_id, reading_datetime DESC;

CREATE OR REPLACE VIEW public.well_readings_latest_chain
WITH (security_invoker = true) AS
SELECT DISTINCT ON (well_id) *
FROM public.well_readings_with_chain
ORDER BY well_id, reading_datetime DESC;

CREATE OR REPLACE VIEW public.ro_train_readings_latest_chain
WITH (security_invoker = true) AS
SELECT DISTINCT ON (train_id) *
FROM public.ro_train_readings_with_chain
ORDER BY train_id, reading_datetime DESC;

CREATE OR REPLACE VIEW public.product_meter_readings_latest_chain
WITH (security_invoker = true) AS
SELECT DISTINCT ON (meter_id) *
FROM public.product_meter_readings_with_chain
ORDER BY meter_id, reading_datetime DESC;

-- 8. Grant SELECT on chain views to authenticated users
GRANT SELECT ON public.locator_readings_with_chain TO authenticated;
GRANT SELECT ON public.well_readings_with_chain TO authenticated;
GRANT SELECT ON public.ro_train_readings_with_chain TO authenticated;
GRANT SELECT ON public.product_meter_readings_with_chain TO authenticated;
GRANT SELECT ON public.power_readings_with_chain TO authenticated;
GRANT SELECT ON public.blending_events_with_chain TO authenticated;

GRANT SELECT ON public.locator_readings_latest_chain TO authenticated;
GRANT SELECT ON public.well_readings_latest_chain TO authenticated;
GRANT SELECT ON public.ro_train_readings_latest_chain TO authenticated;
GRANT SELECT ON public.product_meter_readings_latest_chain TO authenticated;

-- 9. Materialized views for dashboard queries (refreshed on schedule)
-- These provide even faster reads for dashboard aggregations

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_locator_readings_daily
WITH (fillfactor = 90) AS
SELECT 
  locator_id,
  DATE(reading_datetime) AS reading_date,
  MAX(current_reading) AS max_reading,
  MIN(current_reading) AS min_reading,
  SUM(computed_daily_volume) AS total_daily_volume,
  COUNT(*) AS reading_count,
  MAX(reading_datetime) AS last_reading_at
FROM public.locator_readings_with_chain
GROUP BY locator_id, DATE(reading_datetime);

CREATE UNIQUE INDEX IF NOT EXISTS mv_locator_readings_daily_pkey 
  ON public.mv_locator_readings_daily (locator_id, reading_date);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_well_readings_daily
WITH (fillfactor = 90) AS
SELECT 
  well_id,
  DATE(reading_datetime) AS reading_date,
  MAX(current_reading) AS max_reading,
  MIN(current_reading) AS min_reading,
  SUM(computed_daily_volume) AS total_daily_volume,
  COUNT(*) AS reading_count,
  MAX(reading_datetime) AS last_reading_at
FROM public.well_readings_with_chain
GROUP BY well_id, DATE(reading_datetime);

CREATE UNIQUE INDEX IF NOT EXISTS mv_well_readings_daily_pkey 
  ON public.mv_well_readings_daily (well_id, reading_date);

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_ro_train_readings_daily
WITH (fillfactor = 90) AS
SELECT 
  train_id,
  DATE(reading_datetime) AS reading_date,
  MAX(permeate_flow_m3h) AS max_permeate_flow,
  AVG(permeate_flow_m3h) AS avg_permeate_flow,
  MAX(recovery_pct) AS max_recovery,
  AVG(recovery_pct) AS avg_recovery,
  COUNT(*) AS reading_count,
  MAX(reading_datetime) AS last_reading_at
FROM public.ro_train_readings_with_chain
GROUP BY train_id, DATE(reading_datetime);

CREATE UNIQUE INDEX IF NOT EXISTS mv_ro_train_readings_daily_pkey 
  ON public.mv_ro_train_readings_daily (train_id, reading_date);

-- 10. Refresh function for materialized views (called by pg_cron)
CREATE OR REPLACE FUNCTION public.refresh_reading_materialized_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_locator_readings_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_well_readings_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_ro_train_readings_daily;
END;
$$;

-- Grant execute on refresh function
REVOKE EXECUTE ON FUNCTION public.refresh_reading_materialized_views() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_reading_materialized_views() TO authenticated;

-- =============================================================================
-- END OF LAG() WINDOW VIEW REPLACEMENT
-- =============================================================================