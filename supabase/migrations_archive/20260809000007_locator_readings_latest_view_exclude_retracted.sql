-- Corrects locator_readings_latest (20260809140000_locator_readings_latest_view.sql,
-- already applied) to exclude 'retracted' and 'pending_review' rows, matching
-- fn_locator_reading_integrity's own definition of "the real previous
-- reading" and the same fix just applied to well_readings_latest and
-- product_meter_readings_latest (20260809150000 / 20260809160000, same
-- batch) — this one was missed when 140000 was written since the
-- norm_status column and its implications weren't on the radar yet at that
-- point. CREATE OR REPLACE VIEW is safe here: the output column list is
-- unchanged (still `select distinct on (locator_id) *`), only the WHERE
-- clause is added, so this doesn't need to drop the view or touch anything
-- that depends on it.
--
-- Without this, a locator whose most recent row happens to be retracted (a
-- normalization undone) or pending_review (an unconfirmed spike/backward
-- reading, not yet resolved via Data Corrections) would show that voided or
-- unconfirmed row as "the latest reading" in the freshness badge, instead of
-- the last row that's actually confirmed.

create or replace view public.locator_readings_latest
with (security_invoker = true) as
select distinct on (locator_id) *
from public.locator_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by locator_id, reading_datetime desc;

grant select on public.locator_readings_latest to authenticated, anon;
