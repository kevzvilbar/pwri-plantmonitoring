-- Adds a "latest row per locator" view, same pattern as
-- ro_train_readings_latest (20260725000000_ro_train_readings_latest_view.sql):
-- DISTINCT ON does the reduction in Postgres instead of the client running
-- N per-locator queries (see LocatorSection.tsx's `op-loc-latest` query,
-- which currently issues one request per locator to get this exact row).
--
-- This backs the new "Last reading" badge on:
--   • Plant detail → Locators list (pages/plants/locators/LocatorsList.tsx)
--   • Operations → Locator tab (pages/operations/locators/LocatorSection.tsx),
--     which can migrate its op-loc-latest query onto this view too.
--
-- No new index needed — idx_lr_locator_dt (locator_id, reading_datetime desc)
-- already exists from the initial schema and is exactly what DISTINCT ON
-- needs to skip-scan by locator_id.

create or replace view public.locator_readings_latest
with (security_invoker = true) as
select distinct on (locator_id) *
from public.locator_readings
order by locator_id, reading_datetime desc;

-- PostgREST needs an explicit grant on the view object itself, separate from
-- RLS on the base table. security_invoker (Postgres 15+) keeps the base
-- table's RLS policies applying per-caller instead of running as the view
-- owner and silently bypassing plant-level access control.
grant select on public.locator_readings_latest to authenticated, anon;
