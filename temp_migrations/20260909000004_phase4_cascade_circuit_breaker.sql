-- =============================================================================
-- Phase 4: Database Hardening - Circuit Breaker for Cascade Depth
-- =============================================================================
-- Add max cascade depth protection to prevent runaway recursive triggers.
-- This wraps the cascade correction function with a depth limiter.

-- 1. Create a session-level variable to track cascade depth
-- (PostgreSQL doesn't have native recursion depth limit, so we implement our own)

CREATE OR REPLACE FUNCTION public.get_cascade_depth()
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN COALESCE(current_setting('app.cascade_depth', true)::int, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_cascade_depth(depth integer)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.cascade_depth', depth::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_cascade_depth()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  new_depth integer;
BEGIN
  new_depth := public.get_cascade_depth() + 1;
  PERFORM public.set_cascade_depth(new_depth);
  RETURN new_depth;
END;
$$;

-- 2. Configuration table for cascade limits
CREATE TABLE IF NOT EXISTS public.cascade_config (
  id integer PRIMARY KEY DEFAULT 1,
  max_depth integer NOT NULL DEFAULT 50,
  max_rows_per_call integer NOT NULL DEFAULT 1000,
  enable_circuit_breaker boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.cascade_config (id, max_depth, max_rows_per_call, enable_circuit_breaker)
VALUES (1, 50, 1000, true)
ON CONFLICT (id) DO UPDATE SET
  max_depth = EXCLUDED.max_depth,
  max_rows_per_call = EXCLUDED.max_rows_per_call,
  enable_circuit_breaker = EXCLUDED.enable_circuit_breaker,
  updated_at = now();

-- 3. Wrapper function for cascade correction with depth limiting
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
  v_max_depth integer;
  v_current_depth integer;
  v_rows_affected integer := 0;
BEGIN
  -- Check if circuit breaker is enabled
  SELECT enable_circuit_breaker, max_depth
  INTO v_current_depth, v_max_depth
  FROM public.cascade_config
  WHERE id = 1;

  IF NOT v_current_depth THEN
    -- Circuit breaker disabled, call original function
    PERFORM public.fn_cascade_reading_correction(p_table, p_id, p_new_value, p_editor_id, p_reason);
    RETURN;
  END IF;

  -- Check current depth
  v_current_depth := public.get_cascade_depth();
  
  IF v_current_depth >= v_max_depth THEN
    RAISE EXCEPTION 'Cascade depth limit exceeded (max: %). Aborting to prevent runaway recursion. Current depth: %', v_max_depth, v_current_depth
      USING HINT = 'Increase cascade_config.max_depth or investigate recursive trigger chain';
  END IF;

  -- Increment depth counter
  PERFORM public.increment_cascade_depth();

  -- Call original function
  PERFORM public.fn_cascade_reading_correction(p_table, p_id, p_new_value, p_editor_id, p_reason);

  -- Decrement depth counter
  PERFORM public.set_cascade_depth(v_current_depth);
  
EXCEPTION
  WHEN OTHERS THEN
    -- Ensure depth counter is decremented even on error
    PERFORM public.set_cascade_depth(GREATEST(public.get_cascade_depth() - 1, 0));
    RAISE;
END;
$$;

-- 4. Grant execute on safe wrapper
REVOKE EXECUTE ON FUNCTION public.fn_cascade_reading_correction_safe(TEXT, UUID, NUMERIC, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction_safe(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- 5. Create audit log for cascade depth events
CREATE TABLE IF NOT EXISTS public.cascade_depth_audit (
  id bigserial PRIMARY KEY,
  triggered_at timestamptz DEFAULT now(),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  depth_before integer,
  depth_after integer,
  max_depth integer,
  aborted boolean DEFAULT false,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_cascade_depth_audit_triggered 
  ON public.cascade_depth_audit (triggered_at DESC);

-- 6. Wrapper that logs depth events
CREATE OR REPLACE FUNCTION public.fn_cascade_reading_correction_monitored(
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
  v_max_depth integer;
  v_depth_before integer;
  v_depth_after integer;
  v_aborted boolean := false;
  v_error text;
BEGIN
  SELECT max_depth INTO v_max_depth FROM public.cascade_config WHERE id = 1;
  v_depth_before := public.get_cascade_depth();

  BEGIN
    PERFORM public.fn_cascade_reading_correction_safe(p_table, p_id, p_new_value, p_editor_id, p_reason);
  EXCEPTION WHEN OTHERS THEN
    v_aborted := true;
    v_error := SQLERRM;
    RAISE;
  END;

  v_depth_after := public.get_cascade_depth();

  -- Log the event
  INSERT INTO public.cascade_depth_audit (
    table_name, row_id, depth_before, depth_after, max_depth, aborted, error_message
  ) VALUES (
    p_table, p_id, v_depth_before, v_depth_after, v_max_depth, v_aborted, v_error
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Ensure audit is written even if main operation fails
    v_depth_after := public.get_cascade_depth();
    INSERT INTO public.cascade_depth_audit (
      table_name, row_id, depth_before, depth_after, max_depth, aborted, error_message
    ) VALUES (
      p_table, p_id, v_depth_before, v_depth_after, v_max_depth, true, SQLERRM
    );
    RAISE;
END;
$$;

-- Grant execute on monitored version
REVOKE EXECUTE ON FUNCTION public.fn_cascade_reading_correction_monitored(TEXT, UUID, NUMERIC, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction_monitored(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- 7. Monitoring view for cascade depth
CREATE OR REPLACE VIEW public.v_cascade_depth_monitor AS
SELECT 
  date_trunc('hour', triggered_at) AS hour,
  table_name,
  COUNT(*) AS total_calls,
  SUM(CASE WHEN aborted THEN 1 ELSE 0 END) AS aborted_calls,
  MAX(depth_after) AS max_depth_reached,
  AVG(depth_after - depth_before) AS avg_depth_increase
FROM public.cascade_depth_audit
WHERE triggered_at > now() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- =============================================================================
-- END OF CIRCUIT BREAKER
-- =============================================================================