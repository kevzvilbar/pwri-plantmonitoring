-- =============================================================================
-- Migration: 20260911000001_operator_error_rates_view.sql
-- Description: Rolling 30-day operator error rate and accuracy view.
--              Includes only Operator accounts (excludes Admin, Manager, etc.)
--              and aggregates entries, backward readings, pending reviews,
--              retractions, and error rates across operational reading tables.
-- =============================================================================

CREATE OR REPLACE VIEW public.operator_error_rates_30d AS
WITH operator_users AS (
  SELECT p.id AS user_id,
         p.username,
         p.first_name,
         p.last_name
  FROM public.user_profiles p
  WHERE p.status <> 'Suspended'
    -- Must have Operator role
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role = 'Operator'
    )
    -- Must NOT have Admin, Manager, or Data Analyst roles
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role IN ('Admin', 'Manager', 'Data Analyst')
    )
),
all_30d_readings AS (
  -- Locator readings
  SELECT recorded_by,
         reading_datetime,
         norm_status,
         daily_volume,
         COALESCE(is_backward, false) AS is_backward,
         COALESCE(is_meter_replacement, false) AS is_meter_replacement
  FROM public.locator_readings
  WHERE reading_datetime >= now() - INTERVAL '30 days'
    AND recorded_by IS NOT NULL

  UNION ALL

  -- Well readings
  SELECT recorded_by,
         reading_datetime,
         norm_status,
         daily_volume,
         COALESCE(is_backward, false) AS is_backward,
         COALESCE(is_meter_replacement, false) AS is_meter_replacement
  FROM public.well_readings
  WHERE reading_datetime >= now() - INTERVAL '30 days'
    AND recorded_by IS NOT NULL

  UNION ALL

  -- Product meter readings
  SELECT recorded_by,
         reading_datetime,
         norm_status,
         daily_volume,
         CASE WHEN daily_volume < 0 AND NOT COALESCE(is_meter_replacement, false) THEN true ELSE false END AS is_backward,
         COALESCE(is_meter_replacement, false) AS is_meter_replacement
  FROM public.product_meter_readings
  WHERE reading_datetime >= now() - INTERVAL '30 days'
    AND recorded_by IS NOT NULL

  UNION ALL

  -- RO Train readings
  SELECT recorded_by,
         reading_datetime,
         norm_status,
         NULL::numeric AS daily_volume,
         false AS is_backward,
         false AS is_meter_replacement
  FROM public.ro_train_readings
  WHERE reading_datetime >= now() - INTERVAL '30 days'
    AND recorded_by IS NOT NULL
),
reading_aggs AS (
  SELECT recorded_by,
         COUNT(*)::integer AS total_entries,
         COUNT(*) FILTER (
           WHERE (is_backward OR (daily_volume IS NOT NULL AND daily_volume < 0))
             AND NOT is_meter_replacement
         )::integer AS backward_readings,
         COUNT(*) FILTER (WHERE norm_status = 'pending_review')::integer AS pending_review,
         COUNT(*) FILTER (WHERE norm_status = 'retracted')::integer AS retracted,
         COUNT(*) FILTER (
           WHERE norm_status IN ('pending_review', 'retracted')
              OR ((is_backward OR (daily_volume IS NOT NULL AND daily_volume < 0)) AND NOT is_meter_replacement)
         )::integer AS error_count,
         MAX(reading_datetime) AS last_entry_at
  FROM all_30d_readings
  GROUP BY recorded_by
)
SELECT
  ou.user_id,
  ou.username,
  ou.first_name,
  ou.last_name,
  COALESCE(ra.total_entries, 0)::integer AS total_entries,
  COALESCE(ra.backward_readings, 0)::integer AS backward_readings,
  COALESCE(ra.pending_review, 0)::integer AS pending_review,
  COALESCE(ra.retracted, 0)::integer AS retracted,
  COALESCE(ra.error_count, 0)::integer AS error_count,
  CASE
    WHEN COALESCE(ra.total_entries, 0) > 0
    THEN ROUND((ra.error_count::numeric / ra.total_entries::numeric) * 100.0, 2)
    ELSE 0.00
  END::numeric AS error_rate_pct,
  ra.last_entry_at
FROM operator_users ou
LEFT JOIN reading_aggs ra ON ra.recorded_by = ou.user_id
ORDER BY error_rate_pct DESC, total_entries DESC, ou.username ASC;

COMMENT ON VIEW public.operator_error_rates_30d IS
  'Rolling 30-day operator error rate and accuracy view, excluding non-operator staff and aggregating readings across all meter tables.';

