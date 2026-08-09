-- Corrects well_readings_latest (20260809150000_well_readings_latest_view.sql,
-- already applied) to exclude 'retracted' and 'pending_review' rows — the
-- same fix as 20260809170000 for locator_readings_latest, for the same
-- reason: fn_locator_reading_integrity's family of triggers (and
-- hamas_phase15's version of it for product meters) treats a retracted row
-- as voided and a pending_review row as unconfirmed, so neither should
-- surface as "the latest reading" in a freshness badge. well_readings
-- carries the same norm_status column and values (20260514_normalization.sql
-- / 20260718_pending_review_and_cascade_correction.sql).
--
-- CREATE OR REPLACE VIEW is safe: the output column list is unchanged
-- (still `select distinct on (well_id) *`), only the WHERE clause is added.

create or replace view public.well_readings_latest
with (security_invoker = true) as
select distinct on (well_id) *
from public.well_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by well_id, reading_datetime desc;

grant select on public.well_readings_latest to authenticated, anon;
