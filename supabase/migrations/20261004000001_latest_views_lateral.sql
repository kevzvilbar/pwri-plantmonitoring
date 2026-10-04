-- =============================================================================
-- Migration: 20261004000001_latest_views_lateral.sql
--
-- Rewrites locator_readings_latest and well_readings_latest from
-- `SELECT DISTINCT ON (entity_id) ... FROM <readings> ORDER BY entity_id, reading_datetime DESC`
-- to a per-entity LATERAL lookup that uses the (entity_id, reading_datetime DESC) index.
--
-- WHY (measured live on 2026-10-04, project sosfbfxovtleuvahxvpm):
--   * pg_stat_statements: locator_readings_latest 184 calls, mean 1,948 ms, max 4,822 ms
--     (358 s total DB time); well_readings_latest 192 calls, mean ~1,220 ms. Together the
--     two views were the largest single consumer of database time.
--   * Cause: PostgREST filters on plant_id cannot be pushed below DISTINCT ON, so every call
--     scanned the whole readings table and ran the RLS policy functions
--     (user_has_plant_access(plant_id) OR is_manager_or_analyst_or_admin(...)) once per ROW.
--   * EXPLAIN ANALYZE as an Operator: old view 1,400 ms / 55,778 buffer hits;
--     lateral view 27 ms / 1,592 buffer hits (~50x faster), identical rows.
--   * Slow queries are a plausible contributor to the "Thread killed by timeout manager"
--     rows (77% of PostgREST log rows on 2026-10-03) and to DB load generally.
--
-- EQUIVALENCE: verified inside a rolled-back transaction, as Admin, Manager, Data Analyst and
-- Operator, comparing the old and new view row-for-row (EXCEPT in both directions = 0 rows
-- for locators and wells; row counts identical for every role).
--
-- NOT INCLUDED: ro_train_readings_latest. Driving it from ro_trains changes what an Operator
-- sees (27 trains today -> 11), because ro_train_readings has a SELECT policy of `true`
-- (every signed-in user can read every plant's RO readings) while ro_trains is plant-scoped.
-- Fix that policy first (docs/DB-ADVISOR-INVESTIGATION.md, finding S-6), then convert the view.
--
-- Semantics preserved: security_invoker = true; same columns, order and types; same
-- norm_status filter; entities with no (visible) reading are omitted, as before.
-- Rollback: re-create the previous DISTINCT ON definitions (see git history of this file's
-- predecessor in the baseline schema).
-- =============================================================================

create or replace view public.locator_readings_latest with (security_invoker = true) as
select
  r.id, r.locator_id, r.plant_id, r.reading_datetime, r.current_reading, r.previous_reading,
  r.daily_volume, r.gps_lat, r.gps_lng, r.off_location_flag, r.recorded_by, r.remarks,
  r.created_at, r.is_meter_replacement, r.is_estimated, r.norm_status, r.locked_at,
  r.locked_by, r.is_meter_rollover, r.meter_rollover_max
from public.locators d
cross join lateral (
  select x.* from public.locator_readings x
  where x.locator_id = d.id
    and (x.norm_status is null or x.norm_status <> all (array['retracted'::text, 'pending_review'::text]))
  order by x.reading_datetime desc
  limit 1
) r;

create or replace view public.well_readings_latest with (security_invoker = true) as
select
  r.id, r.well_id, r.plant_id, r.reading_datetime, r.current_reading, r.previous_reading,
  r.daily_volume, r.power_meter_reading, r.gps_lat, r.gps_lng, r.off_location_flag,
  r.recorded_by, r.created_at, r.is_meter_replacement, r.norm_status, r.tds_ppm,
  r.pressure_psi, r.daily_power_kwh, r.turbidity_ntu, r.locked_at, r.locked_by,
  r.is_meter_rollover, r.meter_rollover_max
from public.wells d
cross join lateral (
  select x.* from public.well_readings x
  where x.well_id = d.id
    and (x.norm_status is null or x.norm_status <> all (array['retracted'::text, 'pending_review'::text]))
  order by x.reading_datetime desc
  limit 1
) r;
