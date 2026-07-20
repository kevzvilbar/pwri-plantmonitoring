-- Migration: 20260531005216_add_well_id_to_ro_trains.sql
-- Recovered from live Supabase migration history (supabase_migrations.schema_migrations)
-- on 2026-07-20. This migration was already applied to production; this file exists
-- to sync version control with prod so a fresh environment matches. DO NOT re-run
-- manually against the existing production project.

-- Add optional well_id FK to ro_trains so each RO train can be linked
-- to the physical well it draws from.
-- Nullable → all existing rows are unaffected; no backfill required.
-- ON DELETE SET NULL → deleting a well never orphans or removes a train.
ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS well_id uuid
    REFERENCES public.wells(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ro_trains.well_id IS
  'Optional FK → wells.id. When set, Dashboard "PER WELL SOURCE" cards '
  'label this train with the linked well name instead of the RO train '
  'name / train number. Null = no well assigned; falls back to train_name.';
;
