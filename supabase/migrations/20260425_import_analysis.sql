-- =====================================================================
-- AI Universal Import — analysis & decision log
-- Run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- =====================================================================

create table if not exists public.import_analysis (
  id                  uuid        primary key default gen_random_uuid(),
  actor_user_id       uuid        references auth.users(id) on delete set null,
  actor_label         text,
  plant_id            uuid        references public.plants(id) on delete set null,
  filename            text        not null,
  file_kind           text,                          -- xlsx | xlsm | txt | csv | docx | ...
  file_size           integer,
  ai_provider         text,                          -- openai | rule-based
  ai_model            text,
  status              text        not null default 'pending'
                                  check (status in ('pending', 'synced', 'rejected', 'partial')),
  wellmeter_detected  boolean     not null default false,
  tables              jsonb       not null,          -- per-table classification + sample rows
  decisions           jsonb,                         -- per-table approve/reject + edits made by admin
  reason              text,
  decided_by          uuid        references auth.users(id) on delete set null,
  decided_at          timestamptz,
  sync_summary        jsonb,                         -- {created: {wells: N, ...}, inserted: {well_readings: N, ...}, skipped: [...]}
  created_at          timestamptz not null default now()
);

create index if not exists import_analysis_actor_idx
  on public.import_analysis (actor_user_id);

create index if not exists import_analysis_status_idx
  on public.import_analysis (status, created_at desc);

create index if not exists import_analysis_created_idx
  on public.import_analysis (created_at desc);

alter table public.import_analysis enable row level security;

-- Admin / Manager may read every analysis row.
drop policy if exists "import_analysis readable by admin/manager"
  on public.import_analysis;
create policy "import_analysis readable by admin/manager"
  on public.import_analysis
  for select
  using (public.is_manager_or_admin(auth.uid()));

-- Admin / Manager may insert their own analysis runs.
drop policy if exists "import_analysis insertable by admin/manager"
  on public.import_analysis;
create policy "import_analysis insertable by admin/manager"
  on public.import_analysis
  for insert
  with check (public.is_manager_or_admin(auth.uid()));

-- Admin / Manager may update only the decision fields (status, decisions, etc.).
-- We don't enforce column-level guards here — server endpoints write the
-- approved fields atomically, and the audit log captures the decision separately.
drop policy if exists "import_analysis updatable by admin/manager"
  on public.import_analysis;
create policy "import_analysis updatable by admin/manager"
  on public.import_analysis
  for update
  using (public.is_manager_or_admin(auth.uid()))
  with check (public.is_manager_or_admin(auth.uid()));

-- No delete policy — analysis rows are kept for audit history.
