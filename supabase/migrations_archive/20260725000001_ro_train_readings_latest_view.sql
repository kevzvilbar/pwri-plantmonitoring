-- Replaces the "select * from ro_train_readings, keep first row per train_id
-- client-side" pattern in ROTrains.tsx (was pulling the entire unbounded
-- history over the wire on every 60s poll).
--
-- DISTINCT ON (train_id) does the "latest row per train" reduction inside
-- Postgres instead of on the client, so payload size stops growing with
-- history depth and stays O(number of trains).

create or replace view public.ro_train_readings_latest
with (security_invoker = true) as
select distinct on (train_id) *
from public.ro_train_readings
order by train_id, reading_datetime desc;

-- Supporting index: without this, DISTINCT ON still needs a sort over the
-- whole table. With it, Postgres can skip-scan by train_id and only touch
-- the newest row per train, which is what keeps this cheap forever.
create index if not exists idx_ro_train_readings_train_id_reading_datetime
  on public.ro_train_readings (train_id, reading_datetime desc);

-- PostgREST needs explicit grants on the view object itself, separate from
-- RLS on the base table. security_invoker (Postgres 15+, which Supabase
-- runs) makes sure the base table's RLS policies still apply per-caller
-- instead of running as the view owner and silently bypassing RLS.
grant select on public.ro_train_readings_latest to authenticated, anon;
