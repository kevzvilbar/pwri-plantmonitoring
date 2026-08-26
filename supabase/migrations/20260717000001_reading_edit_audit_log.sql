-- =====================================================================
-- Reading Edit Audit Log
-- Run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)
--
-- Captures every edit/delete made to an already-submitted operational
-- reading (RO train readings, pretreatment readings, chemical dosing
-- logs) so managers can see who changed what and when. Written from the
-- frontend by logReadingEdit() in ROTrains.tsx, right after a successful
-- update/delete — best-effort (a failed insert here never blocks the
-- actual save).
-- =====================================================================

create table if not exists public.reading_edit_audit_log (
  id              uuid        primary key default gen_random_uuid(),
  table_name      text        not null check (table_name in (
                                'ro_train_readings',
                                'ro_pretreatment_readings',
                                'chemical_dosing_logs'
                              )),
  record_id       uuid        not null,
  plant_id        uuid        references public.plants(id) on delete set null,
  train_id        uuid,
  action          text        not null default 'update' check (action in ('update', 'delete')),
  actor_user_id   uuid        references auth.users(id) on delete set null,
  actor_label     text,
  changes         jsonb,
  edited_at       timestamptz not null default now()
);

create index if not exists reading_edit_audit_log_record_idx
  on public.reading_edit_audit_log (table_name, record_id);

create index if not exists reading_edit_audit_log_plant_idx
  on public.reading_edit_audit_log (plant_id, edited_at desc);

alter table public.reading_edit_audit_log enable row level security;

-- Admins and Managers may read the full log.
drop policy if exists "reading edit log readable by admin/manager"
  on public.reading_edit_audit_log;
create policy "reading edit log readable by admin/manager"
  on public.reading_edit_audit_log
  for select
  using (public.is_manager_or_admin(auth.uid()));

-- Any authenticated user with access to the plant may insert a log row —
-- operators log their own edits, not just managers, since operators are
-- now allowed to edit their own recent entries.
drop policy if exists "reading edit log insertable by plant users"
  on public.reading_edit_audit_log;
create policy "reading edit log insertable by plant users"
  on public.reading_edit_audit_log
  for insert
  with check (
    plant_id is null or public.user_has_plant_access(plant_id)
  );

-- Log rows are immutable: no update / delete policies -> denied by default.
