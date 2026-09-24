-- =============================================================================
-- Restore public.latest_power_readings_before
-- =============================================================================
-- Missing from the live database since the 2026-09-11 migration squash
-- (62056e19): its two source migrations
-- (20260910000001_latest_power_readings_fn.sql,
--  20260910000003_harden_circuit_breaker_and_power_rpc.sql) were moved to
-- supabase/migrations_archive/ and the generated 20260911044610_baseline_schema.sql
-- did not include the function -- it was apparently never actually applied
-- live at squash time, so `db pull` had nothing to capture.
--
-- Frontend (usePowerStats.ts, useTrendChartQueries.ts) has been calling this
-- RPC on every Dashboard/trend-chart load since. Confirmed live via
-- edge_logs: repeated 404s on POST rest/v1/rpc/latest_power_readings_before
-- across multiple real users/sessions (desktop + mobile) throughout the
-- morning of 2026-09-25. Both call sites already have a try/caught fallback
-- to N per-plant queries, so this did not crash outright -- but it silently
-- reintroduced the exact N+1 query pattern this RPC was built to eliminate,
-- directly undermining the ongoing egress-reduction effort
-- (docs/EGRESS-REDUCTION-PLAN.md).
--
-- Restores the final "hardened" signature (SETOF power_readings, matching
-- what both call sites already expect) from the archived
-- 20260910000003_harden_circuit_breaker_and_power_rpc.sql. Already applied
-- live via Supabase MCP on 2026-09-25; this file re-adds it to the tracked
-- migrations folder so it isn't lost to drift a second time.
-- =============================================================================

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

REVOKE EXECUTE ON FUNCTION public.latest_power_readings_before(uuid[], timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.latest_power_readings_before(uuid[], timestamptz) TO authenticated;

COMMENT ON FUNCTION public.latest_power_readings_before IS
  'Returns the single most-recent full power_readings row per plant where reading_datetime < before_ts. '
  'Eliminates N+1 per-plant queries in trend charts and dashboard power stats. '
  'Restored 2026-09-25 after being dropped by the 2026-09-11 migration squash.';
