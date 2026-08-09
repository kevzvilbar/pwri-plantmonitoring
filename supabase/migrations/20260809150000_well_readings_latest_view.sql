-- Adds a "latest row per well" view, same pattern as ro_train_readings_latest
-- (20260725000000_ro_train_readings_latest_view.sql) and locator_readings_latest
-- (20260809140000_locator_readings_latest_view.sql).
--
-- Unlike locator_readings, well_readings has no (well_id, reading_datetime)
-- index yet — only idx_wr_plant_dt (plant_id, reading_datetime desc). Without
-- a well_id-led index, DISTINCT ON (well_id) would still need a sort over the
-- whole table, so this migration adds both, matching the RO train migration's
-- shape rather than the locator one's.
--
-- This also fixes a real gap, not just adds a badge: WellSection.tsx's
-- existing latestByWell is reduced client-side from a 30-day rolling window
-- (see the `op-well-recent` query), so a well that hasn't been read in over
-- 30 days currently reads as "no reading" instead of "very stale" — the
-- wrong message. Pointing that query at this view instead removes the
-- window entirely.

create index if not exists idx_well_readings_well_dt
  on public.well_readings (well_id, reading_datetime desc);

create or replace view public.well_readings_latest
with (security_invoker = true) as
select distinct on (well_id) *
from public.well_readings
order by well_id, reading_datetime desc;

grant select on public.well_readings_latest to authenticated, anon;
