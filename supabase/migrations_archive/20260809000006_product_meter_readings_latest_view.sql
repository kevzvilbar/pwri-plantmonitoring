-- Adds a "latest row per product meter" view, same pattern as
-- ro_train_readings_latest, locator_readings_latest, and well_readings_latest.
-- idx_pmr_meter_dt (meter_id, reading_datetime desc) already exists from
-- 20260721_product_meters_and_readings.sql — no new index needed.
--
-- This also replaces a real correctness bug in ProductSection.tsx's existing
-- 'product-readings-latest' query, not just adds a badge: that query pulls
-- the last 200 rows for the whole plant, order by reading_datetime desc, and
-- keeps the first row seen per meter_id. On a plant where some meters are
-- read far more often than others, the 200-row window can be entirely
-- consumed by the frequently-read meters before ever reaching a row for a
-- rarely-read one — that meter then reads as "no reading ever" rather than
-- "reading exists, just old", with no relationship to how stale it actually
-- is. Pointing that query at this view instead makes "latest per meter"
-- correct by construction, for the same reading_datetime/daily_volume shape
-- that ProductMeterRow.tsx already consumes from it.
--
-- norm_status filter: matches fn_product_meter_reading_integrity's own
-- definition of "the real previous reading" (see hamas_phase15, same day) —
-- 'retracted' rows are voided and 'pending_review' rows are unconfirmed,
-- so neither should surface as "the latest reading" in a freshness badge.
-- 'erroneous' and 'normalized' are left in, same as that trigger treats
-- them: flagged or corrected, but still a real recorded reading. The
-- `norm_status IS NULL OR` guard is defensive, not load-bearing — the
-- column carries `DEFAULT 'normal'` (20260514_normalization.sql), which
-- Postgres backfills onto pre-existing rows, so there shouldn't be any
-- nulls left in practice.

create or replace view public.product_meter_readings_latest
with (security_invoker = true) as
select distinct on (meter_id) *
from public.product_meter_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by meter_id, reading_datetime desc;

grant select on public.product_meter_readings_latest to authenticated, anon;
