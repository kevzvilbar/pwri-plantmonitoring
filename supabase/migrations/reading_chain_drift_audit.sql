-- =============================================================================
-- reading_chain_drift_audit.sql
--
-- READ-ONLY. Finds every well_readings / blending_events row whose stored
-- previous_reading no longer matches the reading that's actually
-- chronologically immediately before it (by reading_datetime, per
-- well_id/well). This is the drift caused by editing, deleting, or
-- backfilling a reading out of order without re-walking the chain — see
-- ReadingHistoryDialog.tsx's resyncLocatorChain() comment (~line 341) for
-- the mechanism, which only exists for `locator`, not `well` or `blending`.
--
-- Nothing here writes to the database. Run in Supabase Dashboard -> SQL
-- Editor. Rows immediately after a meter replacement are excluded from the
-- "drift" flag (their previous_reading is *supposed* to differ / reset —
-- that's not a bug), but still counted correctly in the window function so
-- later rows compare against the right predecessor.
-- =============================================================================

-- ── WELL READINGS ────────────────────────────────────────────────────────────
WITH well_ordered AS (
  SELECT
    wr.id,
    wr.well_id,
    w.name                                                        AS well_name,
    wr.reading_datetime,
    wr.current_reading,
    wr.previous_reading                                           AS stored_previous_reading,
    wr.daily_volume                                                AS stored_daily_volume,
    LAG(wr.current_reading) OVER (
      PARTITION BY wr.well_id ORDER BY wr.reading_datetime, wr.id
    )                                                              AS true_previous_reading,
    wr.is_meter_replacement,
    wr.is_meter_rollover
  FROM well_readings wr
  JOIN wells w ON w.id = wr.well_id
)
SELECT
  'well' AS source,
  well_name,
  reading_datetime,
  current_reading,
  stored_previous_reading,
  true_previous_reading,
  stored_daily_volume,
  (current_reading - true_previous_reading)                        AS recomputed_volume,
  stored_daily_volume - (current_reading - true_previous_reading)   AS drift_m3
FROM well_ordered
WHERE true_previous_reading IS NOT NULL
  AND stored_previous_reading IS DISTINCT FROM true_previous_reading
  AND NOT COALESCE(is_meter_replacement, false)
  AND NOT COALESCE(is_meter_rollover, false)

UNION ALL

-- ── BLENDING EVENTS ──────────────────────────────────────────────────────────
SELECT
  'blending' AS source,
  well_name,
  reading_datetime,
  current_reading,
  stored_previous_reading,
  true_previous_reading,
  stored_daily_volume,
  recomputed_volume,
  drift_m3
FROM (
  SELECT
    w.name                                                         AS well_name,
    be.reading_datetime,
    be.raw_meter_reading                                           AS current_reading,
    be.previous_reading                                            AS stored_previous_reading,
    be.volume_m3                                                   AS stored_daily_volume,
    LAG(be.raw_meter_reading) OVER (
      PARTITION BY be.well_id
      ORDER BY be.event_date, be.reading_datetime NULLS FIRST, be.id
    )                                                               AS true_previous_reading,
    (be.raw_meter_reading - LAG(be.raw_meter_reading) OVER (
      PARTITION BY be.well_id
      ORDER BY be.event_date, be.reading_datetime NULLS FIRST, be.id
    ))                                                              AS recomputed_volume,
    be.volume_m3 - (be.raw_meter_reading - LAG(be.raw_meter_reading) OVER (
      PARTITION BY be.well_id
      ORDER BY be.event_date, be.reading_datetime NULLS FIRST, be.id
    ))                                                              AS drift_m3,
    be.is_meter_replacement
  FROM blending_events be
  JOIN wells w ON w.id = be.well_id
) b
WHERE true_previous_reading IS NOT NULL
  AND stored_previous_reading IS DISTINCT FROM true_previous_reading
  AND NOT COALESCE(is_meter_replacement, false)

ORDER BY drift_m3 DESC NULLS LAST;
