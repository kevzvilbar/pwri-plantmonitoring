-- [Consolidated 20260719010000_offline_reason_tracking.sql]
-- Moved here from the repo's separate top-level supabase/migrations/ folder
-- during a wiring audit (2026-07-20). Originally intended as a one-off
-- 'Dashboard -> SQL Editor' script rather than a CLI-tracked migration;
-- consolidated so there is one migrations folder and the timestamp reflects
-- roughly where it falls in the actual apply order. Verified against the live
-- schema at consolidation time; see original filename below for provenance.
-- Original filename: 20260719_offline_reason_tracking.sql

-- =============================================================================
-- Migration: 20260719_offline_reason_tracking.sql
-- Adds "why is there no data" reason tracking for Wells, Locators, and RO
-- Trains, replacing blank Data Summary cells with an explanation.
--
-- Two distinct situations, two mechanisms:
--
-- 1. Entity marked Offline/Inactive (a status change, may span many days).
--    entity_status_audit_log never existed as a real table (only ever written
--    through a defensive try/catch — "table may not exist yet"), so this
--    creates it for the first time, with reason columns included from the
--    start.
--
-- 2. Entity still Active/Running, but no reading was logged for a specific
--    day (no status change involved). New table: reading_gap_reasons, one
--    row per (entity, day).
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. entity_status_audit_log ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_status_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  plant_id        UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  entity_type     TEXT        NOT NULL CHECK (entity_type IN ('Well', 'Locator', 'RO Train')),
  entity_id       UUID        NOT NULL,
  entity_label    TEXT,
  from_status     TEXT        NOT NULL,
  to_status       TEXT        NOT NULL,
  reason_category TEXT        CHECK (reason_category IN
                    ('pump_problem', 'locked_meter', 'equipment_malfunction',
                     'maintenance', 'access_issue', 'other')),
  reason_detail   TEXT,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Defensive — in case the table already exists (e.g. created ad hoc via
-- Studio) without these columns.
ALTER TABLE entity_status_audit_log ADD COLUMN IF NOT EXISTS reason_category TEXT;
ALTER TABLE entity_status_audit_log ADD COLUMN IF NOT EXISTS reason_detail TEXT;

CREATE INDEX IF NOT EXISTS idx_entity_status_audit_entity
  ON entity_status_audit_log (entity_type, entity_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_entity_status_audit_plant
  ON entity_status_audit_log (plant_id, timestamp DESC);

ALTER TABLE entity_status_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entity_status_audit_read" ON entity_status_audit_log;
CREATE POLICY "entity_status_audit_read" ON entity_status_audit_log FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "entity_status_audit_write" ON entity_status_audit_log;
CREATE POLICY "entity_status_audit_write" ON entity_status_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

-- ── 2. reading_gap_reasons ────────────────────────────────────────────────────
-- Any operator with plant access may log/update these — unlike status
-- changes, this isn't manager-gated, since it's the day-to-day operator who
-- knows why a reading wasn't taken.

CREATE TABLE IF NOT EXISTS reading_gap_reasons (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT        NOT NULL CHECK (entity_type IN ('well', 'locator', 'ro_train')),
  entity_id       UUID        NOT NULL,
  plant_id        UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  gap_date        DATE        NOT NULL,
  reason_category TEXT        NOT NULL CHECK (reason_category IN
                    ('pump_problem', 'locked_meter', 'equipment_malfunction',
                     'maintenance', 'access_issue', 'other')),
  reason_detail   TEXT,
  logged_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, gap_date)
);

CREATE INDEX IF NOT EXISTS idx_reading_gap_reasons_lookup
  ON reading_gap_reasons (entity_type, entity_id, gap_date);
CREATE INDEX IF NOT EXISTS idx_reading_gap_reasons_plant
  ON reading_gap_reasons (plant_id, gap_date DESC);

ALTER TABLE reading_gap_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reading_gap_reasons_plant_access" ON reading_gap_reasons;
CREATE POLICY "reading_gap_reasons_plant_access" ON reading_gap_reasons FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));
