-- =====================================================================
-- Migration state (Admin → Migrations panel)
--
-- The FastAPI backend used to track "mark applied" overrides and apply
-- history in two local JSON files beside the server process
-- (backend/state/migration_overrides.json, migration_apply_history.json).
-- That was already fragile (lost on every backend redeploy) and now that
-- the app is Supabase-only, there's no server filesystem to keep it on
-- at all. This table replaces both files with one persistent, RLS-gated
-- row-per-migration-file store.
--
-- One row per filename; either or both of manual_override / apply_history
-- may be null. A file with no row at all has neither.
-- =====================================================================

create table if not exists public.migration_state (
  filename        text primary key,
  -- { marked_at, by_user_id, by_label, note } | null — "I ran this by hand".
  manual_override jsonb,
  -- { applied_at, by_label, note, source } | null — permanent first-known
  -- apply event, preserved even after manual_override is cleared.
  apply_history   jsonb,
  updated_at      timestamptz not null default now()
);

alter table public.migration_state enable row level security;

-- Admin-only, matching require_roles(caller, {"Admin"}) on every route this
-- table replaces (list/mark/unmark/import-history were all Admin-only,
-- stricter than the Manager-inclusive is_manager_or_admin used elsewhere).
drop policy if exists "migration_state_admin_all" on public.migration_state;
create policy "migration_state_admin_all" on public.migration_state
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop trigger if exists trg_migration_state_updated on public.migration_state;
create trigger trg_migration_state_updated
  before update on public.migration_state
  for each row execute function public.update_updated_at_column();
