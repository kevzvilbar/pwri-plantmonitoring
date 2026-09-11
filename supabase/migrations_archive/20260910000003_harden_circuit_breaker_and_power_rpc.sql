-- =============================================================================
-- Migration: 20260910000003_harden_circuit_breaker_and_power_rpc.sql
-- Description: 
--   1. Harden cascade reading correction circuit breaker exception recovery.
--      Ensures session depth resets to the initial call depth (v_current_depth)
--      even if an inner recursive cascade fails mid-execution.
--   2. Upgrade public.latest_power_readings_before to return SETOF power_readings
--      so all caller components (dashboard, trend charts) can fetch full
--      baseline rows in a single index-scan round-trip.
-- =============================================================================

-- 1. Upgrade public.latest_power_readings_before
-- Drop existing signature with specific return table to allow returning SETOF power_readings.
DROP FUNCTION IF EXISTS public.latest_power_readings_before(uuid[], timestamptz);

CREATE OR REPLACE FUNCTION public.latest_power_readings_before(
  plant_ids  uuid[],
  before_ts  timestamptz
)
RETURNS SETOF public.power_readings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (pr.plant_id) pr.*
  FROM public.power_readings pr
  WHERE pr.plant_id = ANY(plant_ids)
    AND pr.reading_datetime < before_ts
  ORDER BY pr.plant_id, pr.reading_datetime DESC;
$$;

-- Grant execution to authenticated users
REVOKE EXECUTE ON FUNCTION public.latest_power_readings_before(uuid[], timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.latest_power_readings_before(uuid[], timestamptz) TO authenticated;

COMMENT ON FUNCTION public.latest_power_readings_before IS
  'Returns the single most-recent full power_readings row per plant where reading_datetime < before_ts. '
  'Eliminates N+1 per-plant queries in trend charts and dashboard power stats.';


-- 2. Harden Cascade Reading Correction Safe Wrapper
CREATE OR REPLACE FUNCTION public.fn_cascade_reading_correction_safe(
  p_table text,
  p_id uuid,
  p_new_value numeric,
  p_editor_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled       boolean;
  v_max_depth     integer;
  v_current_depth integer := 0;
BEGIN
  -- Read configuration from cascade_config
  SELECT enable_circuit_breaker, max_depth
  INTO   v_enabled, v_max_depth
  FROM   public.cascade_config
  WHERE  id = 1;

  IF NOT COALESCE(v_enabled, true) THEN
    -- Circuit breaker disabled; call original function directly
    PERFORM public.fn_cascade_reading_correction(p_table, p_id, p_new_value, p_editor_id, p_reason);
    RETURN;
  END IF;

  -- Record current session depth before this call
  v_current_depth := public.get_cascade_depth();

  IF v_current_depth >= COALESCE(v_max_depth, 50) THEN
    RAISE EXCEPTION 'Cascade depth limit exceeded (max: %). Aborting to prevent runaway recursion. Current depth: %',
      v_max_depth, v_current_depth
      USING HINT = 'Increase cascade_config.max_depth or investigate recursive trigger chain';
  END IF;

  -- Increment depth counter for current execution level
  PERFORM public.increment_cascade_depth();

  -- Execute the cascade correction
  PERFORM public.fn_cascade_reading_correction(p_table, p_id, p_new_value, p_editor_id, p_reason);

  -- Restore depth to the recorded initial depth before this call
  PERFORM public.set_cascade_depth(v_current_depth);

EXCEPTION
  WHEN OTHERS THEN
    -- Restore depth back to the initial pre-call level even if an inner recursive
    -- call threw an error, so the session counter is never left permanently elevated.
    PERFORM public.set_cascade_depth(v_current_depth);
    RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_cascade_reading_correction_safe(TEXT, UUID, NUMERIC, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_cascade_reading_correction_safe(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;
