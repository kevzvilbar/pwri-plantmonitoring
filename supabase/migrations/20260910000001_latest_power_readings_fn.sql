-- =============================================================================
-- Phase 4 (follow-on): Helper function to replace N+1 power-reading queries
-- =============================================================================
-- The dashboard previously fired one query per plant to find the most-recent
-- power_readings row BEFORE a given timestamp (the "baseline" row used for
-- meter-delta computation). With N plants that is N serial round-trips.
--
-- This function returns the single latest row per plant in one round-trip
-- using DISTINCT ON, which PostgreSQL resolves with an index-only scan on
-- (plant_id, reading_datetime DESC).
--
-- Called by the frontend as:
--   supabase.rpc('latest_power_readings_before', {
--     plant_ids: [...],
--     before_ts: '<iso timestamp>',
--   })

CREATE OR REPLACE FUNCTION public.latest_power_readings_before(
  plant_ids  uuid[],
  before_ts  timestamptz
)
RETURNS TABLE (
  plant_id             uuid,
  reading_datetime     timestamptz,
  meter_reading_kwh    numeric,
  grid_meter_readings  jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (pr.plant_id)
    pr.plant_id,
    pr.reading_datetime,
    pr.meter_reading_kwh,
    pr.grid_meter_readings
  FROM public.power_readings pr
  WHERE pr.plant_id = ANY(plant_ids)
    AND pr.reading_datetime < before_ts
  ORDER BY pr.plant_id, pr.reading_datetime DESC;
$$;

-- Only authenticated users may call this function (matches RLS on power_readings).
REVOKE EXECUTE ON FUNCTION public.latest_power_readings_before(uuid[], timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.latest_power_readings_before(uuid[], timestamptz) TO authenticated;

COMMENT ON FUNCTION public.latest_power_readings_before IS
  'Returns the single most-recent power_readings row per plant where reading_datetime < before_ts. '
  'Replaces the N per-plant queries the dashboard previously fired to find delta baseline rows.';
