-- =============================================================================
-- Migration: 20260908000002_002_meters_and_audits.sql
-- Baseline 002: Normalization, Meters & Audits (May–July 2026)
-- Partition of baseline schema covering archived migrations #19 to #36
-- =============================================================================

-- >>>>>>> BEGIN ARCHIVED: 20260514000001_normalization.sql >>>>>>>
-- =============================================================================
-- Migration: 20260514_normalization.sql
-- Data Normalization Workflow — reading_normalizations audit table +
-- norm_status columns on all reading tables.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. Enum for normalization actions ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE reading_norm_action AS ENUM ('tag', 'normalize', 'retract');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Normalization audit table ──────────────────────────────────────────────
-- Append-only. One row per action (tag / normalize / retract).
-- Preserves original_value so any retraction can restore it.
CREATE TABLE IF NOT EXISTS reading_normalizations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table    TEXT        NOT NULL,  -- 'locator_readings' | 'well_readings' | …
  source_id       UUID        NOT NULL,  -- FK to the reading row (polymorphic)
  action          reading_norm_action NOT NULL,
  original_value  NUMERIC,               -- preserved reading value at time of action
  adjusted_value  NUMERIC,               -- corrected value (NULL for tag-only)
  note            TEXT,                  -- analyst note
  performed_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_role  TEXT        NOT NULL,  -- 'Admin' | 'Data Analyst'
  performed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  retractable     BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_reading_norm_source
  ON reading_normalizations (source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_reading_norm_performed_at
  ON reading_normalizations (performed_at DESC);

-- ── 3. norm_status column on reading tables ───────────────────────────────────
-- 'normal'     → no anomaly detected
-- 'erroneous'  → flagged by analyst / regression engine
-- 'normalized' → value corrected by analyst (adjusted_value stored in audit table)
-- 'retracted'  → normalization undone; original value still applies

ALTER TABLE locator_readings
  ADD COLUMN IF NOT EXISTS norm_status TEXT
  CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
  DEFAULT 'normal';

ALTER TABLE well_readings
  ADD COLUMN IF NOT EXISTS norm_status TEXT
  CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
  DEFAULT 'normal';

-- product_meter_readings is created by a later migration in fresh installs;
-- apply this column when the table already exists, otherwise let its owning
-- migration add the column after creating the table.
DO $$ BEGIN
  ALTER TABLE product_meter_readings
    ADD COLUMN IF NOT EXISTS norm_status TEXT
    CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
    DEFAULT 'normal';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ro_train_readings may not exist in all deployments; guard with a DO block
DO $$ BEGIN
  ALTER TABLE ro_train_readings
    ADD COLUMN IF NOT EXISTS norm_status TEXT
    CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
    DEFAULT 'normal';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 4. Add 'Data Analyst' to app_role enum ────────────────────────────────────
-- Supabase enums cannot be altered with IF NOT EXISTS, so we guard manually.
DO $$ BEGIN
  ALTER TYPE app_role ADD VALUE 'Data Analyst';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. RLS policies for reading_normalizations ────────────────────────────────
ALTER TABLE reading_normalizations ENABLE ROW LEVEL SECURITY;

-- Admin and Data Analyst can read all normalization records
CREATE POLICY "analyst_read_normalizations"
  ON reading_normalizations FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
    )
  );

-- Admin and Data Analyst can insert normalization records
CREATE POLICY "analyst_insert_normalizations"
  ON reading_normalizations FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
    )
    AND performed_by = auth.uid()
  );

-- No UPDATE or DELETE — audit table is append-only
-- (Retract creates a new 'retract' row, it does not delete the previous one)

-- ── 6. RLS: allow Analysts to update norm_status on reading tables ─────────────
-- locator_readings
CREATE POLICY "analyst_update_norm_status_locator"
  ON locator_readings FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'Admin')
    OR public.has_role(auth.uid(), 'Data Analyst')
  )
  WITH CHECK (true);

-- well_readings
CREATE POLICY "analyst_update_norm_status_well"
  ON well_readings FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'Admin')
    OR public.has_role(auth.uid(), 'Data Analyst')
  )
  WITH CHECK (true);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this migration:
--   1. Assign the 'Data Analyst' role to users via Admin → Users tab.
--   2. The NormalizeButton will appear on reading rows for those users.
--   3. The Normalization tab in the Admin console will show flagged readings.

-- <<<<<<< END ARCHIVED: 20260514000001_normalization.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260515000001_supabase_only_and_data_analysis.sql >>>>>>>
-- =============================================================================
-- Migration: 20260515_supabase_only_and_data_analysis.sql
-- Replaces all MongoDB-backed collections with Supabase tables.
-- Adds Data Analysis & Review Page infrastructure (regression results).
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. status_checks (was MongoDB) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS status_checks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name  TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. downtime_events (was MongoDB) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS downtime_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id     UUID        REFERENCES plants(id) ON DELETE CASCADE,
  event_date   DATE        NOT NULL,
  duration_hrs NUMERIC     NOT NULL DEFAULT 0,
  subsystem    TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_downtime_plant_date ON downtime_events (plant_id, event_date DESC);

ALTER TABLE downtime_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_downtime" ON downtime_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "analyst_write_downtime" ON downtime_events FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'Admin') OR
    public.has_role(auth.uid(), 'Data Analyst') OR
    public.has_role(auth.uid(), 'Manager')
  )
);

-- ── 3. blending_wells (was MongoDB) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blending_wells (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  well_id     UUID        UNIQUE NOT NULL,
  plant_id    UUID        NOT NULL,
  well_name   TEXT,
  plant_name  TEXT,
  tagged_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  tagged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_blending_wells_plant ON blending_wells (plant_id);

ALTER TABLE blending_wells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_blending_wells" ON blending_wells FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "analyst_write_blending_wells" ON blending_wells FOR ALL USING (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
);

-- ── 4. blending_events (was MongoDB) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blending_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id    UUID        NOT NULL,
  well_id     UUID        NOT NULL,
  well_name   TEXT,
  plant_name  TEXT,
  event_date  DATE        NOT NULL,
  volume_m3   NUMERIC     NOT NULL DEFAULT 0,
  noted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blending_events_plant_date ON blending_events (plant_id, event_date DESC);

ALTER TABLE blending_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_blending_events" ON blending_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "analyst_write_blending_events" ON blending_events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 5. compliance_thresholds (was MongoDB) ────────────────────────────────────
-- scope = 'global' or a plant_id UUID
CREATE TABLE IF NOT EXISTS compliance_thresholds (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        TEXT        NOT NULL UNIQUE,
  thresholds   JSONB       NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE compliance_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_thresholds" ON compliance_thresholds FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin_write_thresholds" ON compliance_thresholds FOR ALL USING (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
);

-- ── 6. compliance_snapshots (was MongoDB) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id      UUID        REFERENCES plants(id) ON DELETE CASCADE,
  evaluated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  violations    JSONB       NOT NULL DEFAULT '[]',
  summary       TEXT
);
CREATE INDEX IF NOT EXISTS idx_compliance_snap_plant ON compliance_snapshots (plant_id, evaluated_at DESC);

ALTER TABLE compliance_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_snapshots" ON compliance_snapshots FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "analyst_write_snapshots" ON compliance_snapshots FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 7. operator_switch_log (was MongoDB) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_switch_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id         UUID        REFERENCES plants(id) ON DELETE SET NULL,
  from_operator_id UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  to_operator_id   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  switched_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  switched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE operator_switch_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_switch_log" ON operator_switch_log FOR SELECT USING (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Manager')
);
CREATE POLICY "auth_write_switch_log" ON operator_switch_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ── 8. ai_chat_sessions (was MongoDB) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  session_id   TEXT        PRIMARY KEY,
  user_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  messages     JSONB       NOT NULL DEFAULT '[]',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON ai_chat_sessions (user_id, updated_at DESC);

ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_sessions" ON ai_chat_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "admin_read_sessions" ON ai_chat_sessions FOR SELECT USING (
  public.has_role(auth.uid(), 'Admin')
);

-- ── 9. Data Analysis Regression Results ───────────────────────────────────────
-- Stores per-column regression analysis results linked to reading tables.
-- One row per (source_table, column_name, plant_id, analysis run).
CREATE TABLE IF NOT EXISTS regression_results (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table   TEXT        NOT NULL,        -- 'well_readings' | 'locator_readings' | ...
  column_name    TEXT        NOT NULL,         -- e.g. 'daily_volume', 'current_reading'
  plant_id       UUID        REFERENCES plants(id) ON DELETE CASCADE,
  date_from      DATE,
  date_to        DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_role   TEXT        NOT NULL DEFAULT 'Data Analyst',
  row_count      INT         NOT NULL DEFAULT 0,
  r_squared      NUMERIC,                      -- goodness of fit
  slope          NUMERIC,
  intercept      NUMERIC,
  -- Array of per-reading corrections.  Each element:
  -- { reading_id, original_value, corrected_value, z_score, is_outlier, note }
  corrections    JSONB       NOT NULL DEFAULT '[]',
  status         TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'retracted'))
);
CREATE INDEX IF NOT EXISTS idx_regression_table_col ON regression_results (source_table, column_name);
CREATE INDEX IF NOT EXISTS idx_regression_plant ON regression_results (plant_id, created_at DESC);

ALTER TABLE regression_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analyst_read_regression" ON regression_results FOR SELECT USING (
  auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'Admin') OR
    public.has_role(auth.uid(), 'Data Analyst') OR
    public.has_role(auth.uid(), 'Manager')
  )
);

CREATE POLICY "analyst_insert_regression" ON regression_results FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'Admin') OR
    public.has_role(auth.uid(), 'Data Analyst')
  )
);

CREATE POLICY "analyst_update_regression" ON regression_results FOR UPDATE USING (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
);

-- ── 10. Raw-edit audit log ─────────────────────────────────────────────────────
-- Tracks direct edits to raw values made from the Data Analysis page.
CREATE TABLE IF NOT EXISTS raw_edit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table    TEXT        NOT NULL,
  source_id       UUID        NOT NULL,
  column_name     TEXT        NOT NULL,
  old_value       NUMERIC,
  new_value       NUMERIC,
  edited_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_role     TEXT        NOT NULL,
  edited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_raw_edit_source ON raw_edit_log (source_table, source_id);

ALTER TABLE raw_edit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analyst_read_raw_edit_log" ON raw_edit_log FOR SELECT USING (
  public.has_role(auth.uid(), 'Admin') OR
  public.has_role(auth.uid(), 'Data Analyst') OR
  public.has_role(auth.uid(), 'Manager')
);

CREATE POLICY "analyst_insert_raw_edit_log" ON raw_edit_log FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')
);

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this migration:
--   1. All MongoDB collections are now Supabase tables with RLS.
--   2. regression_results and raw_edit_log support the Data Analysis page.
--   3. Remove MONGO_URL / DB_NAME from your environment variables.
--   4. Assign 'Data Analyst' roles to relevant users in Admin → Users.

-- <<<<<<< END ARCHIVED: 20260515000001_supabase_only_and_data_analysis.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260717000001_reading_edit_audit_log.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260717000001_reading_edit_audit_log.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260718000001_pending_review_and_cascade_correction.sql >>>>>>>
-- =============================================================================
-- Migration: 20260718_pending_review_and_cascade_correction.sql
-- Fixes two bugs found in the Data Corrections / reading-guard workflow:
--
-- 1. src/lib/readingGuards.ts (and LocatorSection.tsx / WellSection.tsx) save
--    backward or spike-flagged readings with norm_status = 'pending_review'.
--    The 20260514_normalization.sql CHECK constraint only allowed
--    'normal' | 'erroneous' | 'normalized' | 'retracted', so every one of
--    those saves was failing with a check-constraint violation. This adds
--    'pending_review' to the allowed set.
--
-- 2. src/pages/DataCorrections.tsx calls a Postgres RPC function
--    fn_cascade_reading_correction(p_table, p_row_id, p_new_current,
--    p_admin_id, p_reason) that was never created in any migration, so the
--    "Edit value" / "Approve correction request" actions always failed.
--    This creates it.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. Allow 'pending_review' on all four reading tables ────────────────────

ALTER TABLE locator_readings DROP CONSTRAINT IF EXISTS locator_readings_norm_status_check;
ALTER TABLE locator_readings
  ADD CONSTRAINT locator_readings_norm_status_check
  CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));

ALTER TABLE well_readings DROP CONSTRAINT IF EXISTS well_readings_norm_status_check;
ALTER TABLE well_readings
  ADD CONSTRAINT well_readings_norm_status_check
  CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));

DO $$ BEGIN
  ALTER TABLE product_meter_readings DROP CONSTRAINT IF EXISTS product_meter_readings_norm_status_check;
  ALTER TABLE product_meter_readings
    ADD CONSTRAINT product_meter_readings_norm_status_check
    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ro_train_readings may not exist in all deployments; guard as the original migration did
DO $$ BEGIN
  ALTER TABLE ro_train_readings DROP CONSTRAINT IF EXISTS ro_train_readings_norm_status_check;
  ALTER TABLE ro_train_readings
    ADD CONSTRAINT ro_train_readings_norm_status_check
    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 2. wells.gps_lat / gps_lng ───────────────────────────────────────────────
-- WellDialogs.tsx (Add and Edit) has always read/written these two columns,
-- with defensive fallback logic for when they're missing from the schema
-- cache — but no migration ever actually created them.

ALTER TABLE wells
  ADD COLUMN IF NOT EXISTS gps_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_lng NUMERIC;

-- ── 3. fn_cascade_reading_correction ─────────────────────────────────────────
-- Corrects a single reading's current_reading and cascades the change forward:
--   - Recomputes this row's own daily_volume (for tables where it's a plain
--     stored column — locator_readings.daily_volume is GENERATED ALWAYS AS
--     and is left for Postgres to recompute).
--   - Finds the NEXT chronological reading for the same entity and updates
--     its previous_reading (and, where applicable, its own daily_volume) so
--     the delta chain stays consistent.
--   - Marks the row 'normalized' and writes an append-only audit row to
--     reading_normalizations.
-- Only usable by Admin / Data Analyst, matching the reading_normalizations
-- RLS policies.

-- The function may already exist (with parameter defaults that CREATE OR
-- REPLACE cannot change) from an earlier partial attempt — drop it first so
-- this definition applies cleanly either way.
DROP FUNCTION IF EXISTS public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_cascade_reading_correction(
  p_table       TEXT,
  p_row_id      UUID,
  p_new_current NUMERIC,
  p_admin_id    UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_col      TEXT;
  v_has_stored_vol  BOOLEAN;
  v_old_current     NUMERIC;
  v_prev_reading    NUMERIC;
  v_entity_id       UUID;
  v_reading_dt      TIMESTAMPTZ;
  v_new_daily_vol   NUMERIC;
  v_next_id         UUID;
  v_cascade_id      UUID;
  v_role            TEXT;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')) THEN
    RAISE EXCEPTION 'Not authorized to correct readings';
  END IF;

  IF p_table NOT IN ('locator_readings', 'well_readings', 'product_meter_readings', 'ro_train_readings') THEN
    RAISE EXCEPTION 'Unknown source table: %', p_table;
  END IF;

  IF p_table = 'ro_train_readings' THEN
    RAISE EXCEPTION 'ro_train_readings does not use the single-value cascade correction model';
  END IF;

  v_entity_col := CASE p_table
    WHEN 'locator_readings' THEN 'locator_id'
    WHEN 'well_readings' THEN 'well_id'
    WHEN 'product_meter_readings' THEN 'meter_id'
  END;
  -- locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres recomputes
  -- it automatically and it must never appear in an UPDATE SET list. The other
  -- two tables store it as a plain column that this function must maintain.
  v_has_stored_vol := (p_table <> 'locator_readings');

  EXECUTE format(
    'SELECT current_reading, previous_reading, reading_datetime, %I FROM %I WHERE id = $1',
    v_entity_col, p_table
  ) INTO v_old_current, v_prev_reading, v_reading_dt, v_entity_id
  USING p_row_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reading % not found in %', p_row_id, p_table;
  END IF;

  IF v_has_stored_vol THEN
    v_new_daily_vol := GREATEST(0, p_new_current - COALESCE(v_prev_reading, 0));
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, daily_volume = $2, norm_status = ''normalized'' WHERE id = $3',
      p_table
    ) USING p_new_current, v_new_daily_vol, p_row_id;
  ELSE
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, norm_status = ''normalized'' WHERE id = $2',
      p_table
    ) USING p_new_current, p_row_id;
  END IF;

  -- Cascade: the next chronological reading for this entity has its
  -- previous_reading pinned to the OLD current_reading — fix it to match.
  EXECUTE format(
    'SELECT id FROM %I WHERE %I = $1 AND reading_datetime > $2 ORDER BY reading_datetime ASC LIMIT 1',
    p_table, v_entity_col
  ) INTO v_next_id
  USING v_entity_id, v_reading_dt;

  IF v_next_id IS NOT NULL THEN
    IF v_has_stored_vol THEN
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = GREATEST(0, current_reading - $1) WHERE id = $2',
        p_table
      ) USING p_new_current, v_next_id;
    ELSE
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING p_new_current, v_next_id;
    END IF;
    v_cascade_id := v_next_id;
  END IF;

  SELECT role INTO v_role FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Data Analyst' THEN 2 ELSE 3 END
    LIMIT 1;

  INSERT INTO public.reading_normalizations (
    source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role
  ) VALUES (
    p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason,
    COALESCE(auth.uid(), p_admin_id), COALESCE(v_role, 'Admin')
  );

  RETURN jsonb_build_object('success', true, 'cascade_id', v_cascade_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- <<<<<<< END ARCHIVED: 20260718000001_pending_review_and_cascade_correction.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260719000001_offline_reason_tracking.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260719000001_offline_reason_tracking.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260720000001_recursive_cascade_and_meter_rollover.sql >>>>>>>
-- =============================================================================
-- Migration: 20260720_recursive_cascade_and_meter_rollover.sql
-- Fixes two data-integrity gaps found in a follow-up audit of the Data
-- Corrections workflow:
--
-- 1. fn_cascade_reading_correction only repaired the SINGLE next reading's
--    previous_reading after a correction. In the common case (correcting one
--    isolated bad reading) that is sufficient, because only the immediate
--    next row's previous_reading depends on the corrected row's
--    current_reading. But real deployments can already have BROKEN chains
--    further downstream — from raw edits made via /data-analysis/edit-raw,
--    from regression-applied corrections (which write corrected_value
--    directly and never call this function at all), or from earlier manual
--    DB fixes — where previous_reading no longer matches the prior row's
--    current_reading for two or more consecutive links. This migration
--    replaces the single-hop fix with a bounded walk that keeps repairing
--    previous_reading / daily_volume forward until it reaches a link that
--    is already internally consistent (or runs out of rows), so a
--    correction actually heals the whole downstream chain, not just the
--    first link of it.
--
-- 2. Meter rollovers (mechanical odometer wraps, e.g. 99999 -> 00012) were
--    indistinguishable from data-entry backward readings: readingGuards.ts
--    flagged both as 'pending_review' with the same code path, and daily
--    volume for either case was clamped to 0 (GREATEST(0, current -
--    previous)), silently discarding real production on legitimate
--    rollover days. This adds `is_meter_rollover` and `meter_rollover_max`
--    columns to the three volumetric reading tables so a rollover can be
--    marked explicitly and its true delta computed as
--    (meter_max - previous) + current instead of clamped to zero.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. Meter-rollover columns ────────────────────────────────────────────────
-- meter_rollover_max is the odometer's wrap point (e.g. 99999 for a 5-digit
-- mechanical counter). Stored per-reading (not looked up from the entity
-- config table) so the generated/derived daily_volume expression for
-- locator_readings — which can only reference columns on the same row —
-- has everything it needs without a cross-table lookup.

ALTER TABLE well_readings
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

DO $$ BEGIN
  ALTER TABLE product_meter_readings
    ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- locator_readings.daily_volume is GENERATED ALWAYS AS (current_reading -
-- COALESCE(previous_reading,0)) STORED with no rollover awareness AND no
-- floor at zero — a rollover previously produced a large *negative* daily
-- volume that fed straight into dashboards and NRW calculations. Add the
-- rollover columns, then rebuild the generated expression to be both
-- rollover-aware and floored at zero (matching the clamping already used
-- everywhere else in the app for this table's siblings).
ALTER TABLE locator_readings
  ADD COLUMN IF NOT EXISTS is_meter_rollover BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

ALTER TABLE locator_readings DROP COLUMN IF EXISTS daily_volume;
ALTER TABLE locator_readings ADD COLUMN daily_volume NUMERIC GENERATED ALWAYS AS (
  CASE
    WHEN is_meter_rollover AND meter_rollover_max IS NOT NULL THEN
      GREATEST(0, (meter_rollover_max - COALESCE(previous_reading, 0)) + current_reading)
    ELSE
      GREATEST(0, current_reading - COALESCE(previous_reading, 0))
  END
) STORED;

COMMENT ON COLUMN well_readings.is_meter_rollover IS
  'True when current_reading < previous_reading because the mechanical meter wrapped around, not because of a data-entry error. Distinct from the pre-existing meter REPLACEMENT flow (new physical meter installed).';
COMMENT ON COLUMN well_readings.meter_rollover_max IS
  'The odometer wrap point for this reading (e.g. 99999). Used with is_meter_rollover to compute the true delta instead of clamping to zero.';

-- ── 2. fn_cascade_reading_correction — recursive downstream repair ──────────

DROP FUNCTION IF EXISTS public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_cascade_reading_correction(
  p_table       TEXT,
  p_row_id      UUID,
  p_new_current NUMERIC,
  p_admin_id    UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_col      TEXT;
  v_has_stored_vol  BOOLEAN;
  v_old_current     NUMERIC;
  v_prev_reading    NUMERIC;
  v_entity_id       UUID;
  v_reading_dt      TIMESTAMPTZ;
  v_new_daily_vol   NUMERIC;
  v_role            TEXT;

  -- Walk state for the recursive downstream repair.
  v_cursor_current  NUMERIC;      -- the "true" current_reading to propagate forward
  v_cursor_dt       TIMESTAMPTZ;  -- reading_datetime of the row we just fixed
  v_iter_id         UUID;
  v_iter_prev       NUMERIC;
  v_iter_current    NUMERIC;
  v_iter_dt         TIMESTAMPTZ;
  v_iter_rollover   BOOLEAN;
  v_iter_max        NUMERIC;
  v_iter_daily_vol  NUMERIC;
  v_cascade_ids     UUID[] := ARRAY[]::UUID[];
  v_hops            INT := 0;
  v_max_hops        CONSTANT INT := 500;  -- safety cap against runaway loops on corrupt data
BEGIN
  IF NOT (public.has_role(auth.uid(), 'Admin') OR public.has_role(auth.uid(), 'Data Analyst')) THEN
    RAISE EXCEPTION 'Not authorized to correct readings';
  END IF;

  IF p_table NOT IN ('locator_readings', 'well_readings', 'product_meter_readings', 'ro_train_readings') THEN
    RAISE EXCEPTION 'Unknown source table: %', p_table;
  END IF;

  IF p_table = 'ro_train_readings' THEN
    RAISE EXCEPTION 'ro_train_readings does not use the single-value cascade correction model';
  END IF;

  v_entity_col := CASE p_table
    WHEN 'locator_readings' THEN 'locator_id'
    WHEN 'well_readings' THEN 'well_id'
    WHEN 'product_meter_readings' THEN 'meter_id'
  END;
  -- locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres recomputes
  -- it automatically and it must never appear in an UPDATE SET list. The other
  -- two tables store it as a plain column that this function must maintain.
  v_has_stored_vol := (p_table <> 'locator_readings');

  EXECUTE format(
    'SELECT current_reading, previous_reading, reading_datetime, %I FROM %I WHERE id = $1',
    v_entity_col, p_table
  ) INTO v_old_current, v_prev_reading, v_reading_dt, v_entity_id
  USING p_row_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reading % not found in %', p_row_id, p_table;
  END IF;

  IF v_has_stored_vol THEN
    v_new_daily_vol := GREATEST(0, p_new_current - COALESCE(v_prev_reading, 0));
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, daily_volume = $2, norm_status = ''normalized'' WHERE id = $3',
      p_table
    ) USING p_new_current, v_new_daily_vol, p_row_id;
  ELSE
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, norm_status = ''normalized'' WHERE id = $2',
      p_table
    ) USING p_new_current, p_row_id;
  END IF;

  -- ── Recursive cascade ────────────────────────────────────────────────────
  -- Walk forward link by link. At each hop, check whether the next row's
  -- previous_reading already matches the upstream current_reading we're
  -- propagating. If it does, the chain is consistent from here on and we
  -- stop — this is what makes a normal single-point correction terminate
  -- after exactly one hop, same as before. If it does NOT match (a
  -- pre-existing broken link further down the chain), fix it and keep
  -- walking using that row's own current_reading as the new cursor value.
  v_cursor_current := p_new_current;
  v_cursor_dt := v_reading_dt;

  LOOP
    v_hops := v_hops + 1;
    EXIT WHEN v_hops > v_max_hops;

    EXECUTE format(
      'SELECT id, previous_reading, current_reading, reading_datetime, is_meter_rollover, meter_rollover_max
         FROM %I WHERE %I = $1 AND reading_datetime > $2 ORDER BY reading_datetime ASC LIMIT 1',
      p_table, v_entity_col
    ) INTO v_iter_id, v_iter_prev, v_iter_current, v_iter_dt, v_iter_rollover, v_iter_max
    USING v_entity_id, v_cursor_dt;

    EXIT WHEN v_iter_id IS NULL;

    -- Chain is already consistent from this point on — nothing further to fix.
    EXIT WHEN v_iter_prev IS NOT DISTINCT FROM v_cursor_current;

    IF v_has_stored_vol THEN
      IF v_iter_rollover AND v_iter_max IS NOT NULL THEN
        v_iter_daily_vol := GREATEST(0, (v_iter_max - v_cursor_current) + v_iter_current);
      ELSE
        v_iter_daily_vol := GREATEST(0, v_iter_current - v_cursor_current);
      END IF;
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = $2 WHERE id = $3',
        p_table
      ) USING v_cursor_current, v_iter_daily_vol, v_iter_id;
    ELSE
      -- locator_readings: daily_volume is GENERATED and recomputes itself
      -- from previous_reading / is_meter_rollover / meter_rollover_max —
      -- only previous_reading needs writing here.
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING v_cursor_current, v_iter_id;
    END IF;

    v_cascade_ids := array_append(v_cascade_ids, v_iter_id);

    -- This row's own current_reading is what the NEXT row's previous_reading
    -- must match, so it becomes the new cursor for the next iteration.
    v_cursor_current := v_iter_current;
    v_cursor_dt := v_iter_dt;
  END LOOP;

  SELECT role INTO v_role FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Data Analyst' THEN 2 ELSE 3 END
    LIMIT 1;

  INSERT INTO public.reading_normalizations (
    source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role
  ) VALUES (
    p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason,
    COALESCE(auth.uid(), p_admin_id), COALESCE(v_role, 'Admin')
  );

  RETURN jsonb_build_object(
    'success', true,
    'cascade_id', v_cascade_ids[1],           -- kept for backward compatibility with existing callers
    'cascade_ids', to_jsonb(v_cascade_ids),
    'cascade_hops', array_length(v_cascade_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- ── 3. regression_results.truncated ──────────────────────────────────────────
-- run_regression() previously applied a hard 2 000-row .limit() with no way
-- for the caller to know the date range actually had more data than was
-- used. The service now fetches one row past the limit to detect this and
-- needs a column to persist the flag alongside each stored result.

ALTER TABLE regression_results
  ADD COLUMN IF NOT EXISTS truncated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN regression_results.truncated IS
  'True when the source date range had more rows than was read (see ROW_LIMIT in regression_service.py) — the fitted line only reflects the first ROW_LIMIT rows in chronological order.';

-- <<<<<<< END ARCHIVED: 20260720000001_recursive_cascade_and_meter_rollover.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260721000001_missing_rls_policies.sql >>>>>>>
-- =============================================================================
-- Migration: 20260721_missing_rls_policies.sql
--
-- Adds missing RLS policies to tables that have ALTER TABLE … ENABLE ROW
-- LEVEL SECURITY but zero CREATE POLICY statements, and adds RLS entirely to
-- status_checks (which had neither).
--
-- With RLS enabled but no policies, Supabase defaults to DENY ALL for
-- authenticated users. This migration fixes the silent read/write failures
-- these tables currently cause in the app.
-- =============================================================================

-- ── Tables that all follow the user_has_plant_access(plant_id) pattern ────────

-- afm_readings
DROP POLICY IF EXISTS "afm_readings_plant_access" ON afm_readings;
CREATE POLICY "afm_readings_plant_access" ON afm_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- cartridge_readings
DROP POLICY IF EXISTS "cartridge_readings_plant_access" ON cartridge_readings;
CREATE POLICY "cartridge_readings_plant_access" ON cartridge_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- checklist_executions (plant_id nullable; fall back to plant_id IS NULL for global templates)
DROP POLICY IF EXISTS "checklist_executions_plant_access" ON checklist_executions;
CREATE POLICY "checklist_executions_plant_access" ON checklist_executions
  FOR ALL TO authenticated
  USING  (plant_id IS NULL OR public.user_has_plant_access(plant_id))
  WITH CHECK (plant_id IS NULL OR public.user_has_plant_access(plant_id));

-- chemical_dosing_logs
DROP POLICY IF EXISTS "chemical_dosing_logs_plant_access" ON chemical_dosing_logs;
CREATE POLICY "chemical_dosing_logs_plant_access" ON chemical_dosing_logs
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- chemical_inventory
DROP POLICY IF EXISTS "chemical_inventory_plant_access" ON chemical_inventory;
CREATE POLICY "chemical_inventory_plant_access" ON chemical_inventory
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- cip_logs
DROP POLICY IF EXISTS "cip_logs_plant_access" ON cip_logs;
CREATE POLICY "cip_logs_plant_access" ON cip_logs
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- incidents
DROP POLICY IF EXISTS "incidents_plant_access" ON incidents;
CREATE POLICY "incidents_plant_access" ON incidents
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- locator_meter_replacements
DROP POLICY IF EXISTS "locator_meter_replacements_plant_access" ON locator_meter_replacements;
CREATE POLICY "locator_meter_replacements_plant_access" ON locator_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- power_readings
DROP POLICY IF EXISTS "power_readings_plant_access" ON power_readings;
CREATE POLICY "power_readings_plant_access" ON power_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- pump_readings
DROP POLICY IF EXISTS "pump_readings_plant_access" ON pump_readings;
CREATE POLICY "pump_readings_plant_access" ON pump_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ro_train_readings
DROP POLICY IF EXISTS "ro_train_readings_plant_access" ON ro_train_readings;
CREATE POLICY "ro_train_readings_plant_access" ON ro_train_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- well_meter_replacements
DROP POLICY IF EXISTS "well_meter_replacements_plant_access" ON well_meter_replacements;
CREATE POLICY "well_meter_replacements_plant_access" ON well_meter_replacements
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- well_pms_records
DROP POLICY IF EXISTS "well_pms_records_plant_access" ON well_pms_records;
CREATE POLICY "well_pms_records_plant_access" ON well_pms_records
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── Audit-log tables: read = admin only, write = service role ─────────────────

-- reading_edit_audit_log
DROP POLICY IF EXISTS "reading_edit_audit_log_read" ON reading_edit_audit_log;
CREATE POLICY "reading_edit_audit_log_read" ON reading_edit_audit_log
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "reading_edit_audit_log_write" ON reading_edit_audit_log;
CREATE POLICY "reading_edit_audit_log_write" ON reading_edit_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- deletion_audit_log  (admin-read only; writes via service-role backend)
DROP POLICY IF EXISTS "deletion_audit_log_admin_read" ON deletion_audit_log;
CREATE POLICY "deletion_audit_log_admin_read" ON deletion_audit_log
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- import_analysis  (admin-read only)
DROP POLICY IF EXISTS "import_analysis_admin_read" ON import_analysis;
CREATE POLICY "import_analysis_admin_read" ON import_analysis
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

DROP POLICY IF EXISTS "import_analysis_write" ON import_analysis;
CREATE POLICY "import_analysis_write" ON import_analysis
  FOR ALL TO authenticated
  WITH CHECK (public.is_manager_or_admin(auth.uid()));

-- login_attempts  (admin-read only; written by auth triggers / service role)
DROP POLICY IF EXISTS "login_attempts_admin_read" ON login_attempts;
CREATE POLICY "login_attempts_admin_read" ON login_attempts
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- ── status_checks: add RLS (currently has none at all) ────────────────────────
-- This is an internal heartbeat table — any authenticated user can insert a
-- row; reads are admin-only.
ALTER TABLE status_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_checks_write" ON status_checks;
CREATE POLICY "status_checks_write" ON status_checks
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "status_checks_admin_read" ON status_checks;
CREATE POLICY "status_checks_admin_read" ON status_checks
  FOR SELECT TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- <<<<<<< END ARCHIVED: 20260721000001_missing_rls_policies.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260721000002_outlier_count_column.sql >>>>>>>
-- ============================================================
-- §4 item 4 — Materialize outlier_count on regression_results
-- ============================================================
--
-- PROBLEM:
--   Every call to DataAnalysis.tsx's regression-results query was pulling
--   the full `corrections` JSONB array (potentially hundreds of rows × many
--   KB each) purely to count how many entries have is_outlier=true.
--   That count is then shown in the result-list card header.
--
-- FIX:
--   Add a real integer column that is kept in sync with the corrections array
--   by a trigger.  Reads only need to select `outlier_count`; the full
--   `corrections` blob is only fetched when a result card is expanded.
--
-- BACKFILL:
--   Existing rows are populated immediately via UPDATE.
--
-- TRIGGER:
--   Fires BEFORE INSERT OR UPDATE on regression_results so the column is
--   always correct at write time — no async job needed.

-- 1) Add column (idempotent)
ALTER TABLE public.regression_results
  ADD COLUMN IF NOT EXISTS outlier_count integer NOT NULL DEFAULT 0;

-- 2) Backfill existing rows
UPDATE public.regression_results
SET outlier_count = (
  SELECT COUNT(*)::int
  FROM jsonb_array_elements(
    COALESCE(corrections, '[]'::jsonb)
  ) AS elem
  WHERE (elem ->> 'is_outlier')::boolean IS TRUE
)
WHERE outlier_count = 0;   -- skip rows already set (safe for re-runs)

-- 3) Trigger function — recomputes on every insert/update that touches corrections
CREATE OR REPLACE FUNCTION public.trg_regression_results_outlier_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.outlier_count := (
    SELECT COUNT(*)::int
    FROM jsonb_array_elements(
      COALESCE(NEW.corrections, '[]'::jsonb)
    ) AS elem
    WHERE (elem ->> 'is_outlier')::boolean IS TRUE
  );
  RETURN NEW;
END;
$$;

-- 4) Attach trigger (drop first so migration is re-runnable)
DROP TRIGGER IF EXISTS trg_regression_results_outlier_count
  ON public.regression_results;

CREATE TRIGGER trg_regression_results_outlier_count
BEFORE INSERT OR UPDATE OF corrections
ON public.regression_results
FOR EACH ROW EXECUTE FUNCTION public.trg_regression_results_outlier_count();

-- <<<<<<< END ARCHIVED: 20260721000002_outlier_count_column.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260721000003_pressure_unique_constraint.sql >>>>>>>
-- =============================================================================
-- Migration: 20260721_pressure_unique_constraint.sql
--
-- Codifies the `uix_well_one_per_user_per_hour` unique index that was created
-- directly in the Supabase dashboard (ad-hoc) and therefore missing from
-- migrations. Without this migration, a full DB rebuild from migrations would
-- silently lose the constraint.
--
-- Constraint intent: prevent an operator from inserting two separate
-- well_readings rows for the same well within the same clock-hour. Updates
-- to an existing row are not affected.
--
-- Uses IF NOT EXISTS — safe to run against a DB that already has the index.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uix_well_one_per_user_per_hour
  ON well_readings (well_id, recorded_by, date_trunc('hour', reading_datetime, 'Asia/Manila'));

-- <<<<<<< END ARCHIVED: 20260721000003_pressure_unique_constraint.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260721000004_product_meters_and_readings.sql >>>>>>>
-- =============================================================================
-- Migration: 20260721_product_meters_and_readings.sql
--
-- Adds product_meters and product_meter_readings tables, which are referenced
-- throughout the frontend (ProductMeters.tsx, Dashboard.tsx,
-- EntityHistoryChart.tsx, LocatorDialogs.tsx) but were never codified in a
-- migration — they appear to have been created ad-hoc via the Supabase
-- dashboard.
--
-- Also adds:
--   • product_meter_audit_log (referenced in ProductMeters.tsx)
--   • locators.product_meter_id FK  (referenced in LocatorDialogs.tsx)
--   • ro_trains.product_meter_id FK (referenced in Dashboard.tsx)
--
-- All CREATE TABLE statements use IF NOT EXISTS so this is safe to run
-- against a database that already has these tables from a prior dashboard
-- operation.
-- =============================================================================

-- ── 1. product_meters ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_meters (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id             UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'Active'
                         CHECK (status IN ('Active', 'Inactive')),
  sort_order           INTEGER     NOT NULL DEFAULT 0,
  meter_brand          TEXT,
  meter_size           TEXT,
  meter_serial         TEXT,
  meter_installed_date DATE,
  gps_lat              NUMERIC,
  gps_lng              NUMERIC,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_meters_plant
  ON product_meters (plant_id, status);

ALTER TABLE product_meters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_meters_plant_access" ON product_meters;
CREATE POLICY "product_meters_plant_access" ON product_meters
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 2. product_meter_readings ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_meter_readings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id          UUID        NOT NULL REFERENCES product_meters(id) ON DELETE CASCADE,
  plant_id          UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  reading_datetime  TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_reading   NUMERIC,
  previous_reading  NUMERIC,
  daily_volume      NUMERIC,
  recorded_by       UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  norm_status       TEXT        NOT NULL DEFAULT 'normal'
                    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted')),
  is_meter_rollover  BOOLEAN     NOT NULL DEFAULT false,
  meter_rollover_max NUMERIC,
  is_meter_replacement BOOLEAN NOT NULL DEFAULT false
);

-- Keep databases that already had this table aligned with fresh installs.
ALTER TABLE product_meter_readings
  ADD COLUMN IF NOT EXISTS norm_status TEXT
  CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
  DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS idx_pmr_meter_dt
  ON product_meter_readings (meter_id, reading_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_pmr_plant_dt
  ON product_meter_readings (plant_id, reading_datetime DESC);

ALTER TABLE product_meter_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_meter_readings_plant_access" ON product_meter_readings;
CREATE POLICY "product_meter_readings_plant_access" ON product_meter_readings
  FOR ALL TO authenticated
  USING  (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 3. product_meter_audit_log ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_meter_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id    UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  meter_id    UUID        NOT NULL,
  meter_name  TEXT,
  old_value   TEXT,
  new_value   TEXT,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pm_audit_plant
  ON product_meter_audit_log (plant_id, timestamp DESC);

ALTER TABLE product_meter_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_meter_audit_read" ON product_meter_audit_log;
CREATE POLICY "product_meter_audit_read" ON product_meter_audit_log
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "product_meter_audit_write" ON product_meter_audit_log;
CREATE POLICY "product_meter_audit_write" ON product_meter_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── 4. FK columns on existing tables ─────────────────────────────────────────
-- locators.product_meter_id  (LocatorDialogs.tsx, Dashboard.tsx)
-- ro_trains.product_meter_id (Dashboard.tsx)

ALTER TABLE locators  ADD COLUMN IF NOT EXISTS product_meter_id UUID
  REFERENCES product_meters(id) ON DELETE SET NULL;

ALTER TABLE ro_trains ADD COLUMN IF NOT EXISTS product_meter_id UUID
  REFERENCES product_meters(id) ON DELETE SET NULL;

-- Reload PostgREST schema cache so the new tables are immediately visible.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260721000004_product_meters_and_readings.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260722000001_derived_meter_support.sql >>>>>>>
-- Derived-meter support (Section 7.3 of master plan)
-- Allows a locator to be marked as "has no physical meter" with its value
-- derived from mother-meter minus all sibling locators. Optionally mirrors
-- the computed value into a product_meters row on another plant.

ALTER TABLE locators
  ADD COLUMN IF NOT EXISTS is_derived        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_meter_id UUID REFERENCES product_meters(id);

ALTER TABLE product_meters
  ADD COLUMN IF NOT EXISTS is_derived             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_locator_id UUID REFERENCES locators(id);

-- Index for the cron sweep to find derived locators quickly
CREATE INDEX IF NOT EXISTS idx_locators_is_derived
  ON locators (is_derived) WHERE is_derived = true;

CREATE INDEX IF NOT EXISTS idx_product_meters_is_derived
  ON product_meters (is_derived) WHERE is_derived = true;

COMMENT ON COLUMN locators.is_derived IS
  'When true, this locator has no physical meter; its reading is computed as mother_meter − Σ(sibling locators).';
COMMENT ON COLUMN locators.derived_from_meter_id IS
  'The product meter (mother meter) this derived locator''s reading is subtracted from. NULL when is_derived=false.';
COMMENT ON COLUMN product_meters.is_derived IS
  'When true, this meter''s reading is a mirror of a derived locator from another plant.';
COMMENT ON COLUMN product_meters.derived_from_locator_id IS
  'The locator whose derived value is mirrored into this product meter row. NULL when is_derived=false.';

-- <<<<<<< END ARCHIVED: 20260722000001_derived_meter_support.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260722000002_mother_meter_derived.sql >>>>>>>
-- ============================================================
-- §7.3 — Mother Meter / Locators derived-meter config
-- ============================================================
--
-- CONTEXT:
--   The "Hamas case" (plant SRP supplies Mambaling through a shared
--   pipeline).  A locator at SRP (Hamas) has no physical meter — its
--   daily volume is derived: total through the mother product meter
--   minus the sum of all other metered locators on the same meter.
--   That derived value must also mirror into a product_meters row at
--   Mambaling so NRW/Dashboard on BOTH plants remain self-consistent.
--
--   Key insight: calc.nrw() is already a single formula fed by pivot
--   sums grouped by plant_id.  No NRW or Dashboard code changes are
--   needed — the feature reduces to "compute one number, write it into
--   two existing tables."
--
-- SCHEMA ADDITIONS:
--   locators
--     is_derived            BOOL  — true = no physical meter; value computed
--     derived_from_meter_id UUID  — the product_meter whose readings are the
--                                   basis for residual computation
--
--   product_meters
--     is_derived            BOOL  — true = mirrors a derived locator's value
--     derived_from_locator_id UUID — which locator provides the value to mirror
--
-- CONSTRAINT:
--   At most ONE derived (is_derived=true) locator per mother meter
--   is enforced via a partial unique index.  The residual formula has
--   no unique answer for two unknowns.

-- ── locators ──────────────────────────────────────────────────────────────────
ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS is_derived              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_meter_id   uuid    REFERENCES public.product_meters(id) ON DELETE SET NULL;

-- Enforce at most one derived locator per mother meter at the DB level.
-- A partial unique index is cheaper than a trigger and self-documenting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_derived_locator_per_meter
  ON public.locators (derived_from_meter_id)
  WHERE is_derived = true AND derived_from_meter_id IS NOT NULL;

-- ── product_meters ────────────────────────────────────────────────────────────
ALTER TABLE public.product_meters
  ADD COLUMN IF NOT EXISTS is_derived               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_locator_id  uuid    REFERENCES public.locators(id) ON DELETE SET NULL;

-- ── is_estimated — mark cron-computed readings so the UI can distinguish them ─
-- Operator-entered readings are is_estimated=false (default).
-- Cron-computed derived readings are is_estimated=true so they can be filtered
-- or labelled in DataSummaryModal and the per-locator history view.
ALTER TABLE public.locator_readings
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.product_meter_readings
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;

-- ── Derived-meter sweep audit table ──────────────────────────────────────────
-- Records every cron run so we can answer "when was this derived value last
-- recomputed?" and skip dates already processed (incremental, not full-history).
CREATE TABLE IF NOT EXISTS public.derived_meter_sweep_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  swept_at        timestamptz NOT NULL DEFAULT now(),
  locator_id      uuid        NOT NULL REFERENCES public.locators(id)  ON DELETE CASCADE,
  date_key        date        NOT NULL,
  old_value       numeric,
  new_value       numeric,
  changed         boolean     NOT NULL DEFAULT false,
  mirror_meter_id uuid        REFERENCES public.product_meters(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dms_log_locator_date
  ON public.derived_meter_sweep_log (locator_id, date_key);

-- ── RLS: service-role only (cron job uses service key) ───────────────────────
-- Regular users never read/write this table directly; it's an internal audit log.
ALTER TABLE public.derived_meter_sweep_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY derived_meter_sweep_log_service_only
  ON public.derived_meter_sweep_log
  FOR ALL
  USING (auth.role() = 'service_role');

-- <<<<<<< END ARCHIVED: 20260722000002_mother_meter_derived.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260722000003_well_readings_optional_columns.sql >>>>>>>
-- =============================================================================
-- Migration: 20260722_well_readings_optional_columns.sql
--
-- Formally adds four columns to well_readings that were created ad-hoc via
-- the Supabase dashboard and therefore absent from all migrations.  Missing
-- from migrations means:
--   1. A DB rebuild from migrations loses the columns silently.
--   2. PostgREST's schema cache may be stale (no NOTIFY was ever sent after
--      adding them ad-hoc), causing UPDATE payloads that include these columns
--      to fail with the misleading error:
--        "relation 'well_readings' does not exist"
--
-- Affected frontend:  ReadingHistoryDialog.tsx → saveEdit() (well module)
--                     WellSection.tsx → saveTds(), saveNtu(), savePressure()
--
-- All ADD COLUMN statements use IF NOT EXISTS — safe against any DB that
-- already has the columns from the prior ad-hoc additions.
-- =============================================================================

-- ── 1. tds_ppm ────────────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS tds_ppm NUMERIC
    CHECK (tds_ppm IS NULL OR tds_ppm >= 0);

COMMENT ON COLUMN public.well_readings.tds_ppm IS
  'Total dissolved solids in parts-per-million. Measured at point of well discharge.';

-- ── 2. turbidity_ntu ─────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS turbidity_ntu NUMERIC
    CHECK (turbidity_ntu IS NULL OR turbidity_ntu >= 0);

COMMENT ON COLUMN public.well_readings.turbidity_ntu IS
  'Water turbidity in Nephelometric Turbidity Units.';

-- ── 3. pressure_psi ──────────────────────────────────────────────────────────
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS pressure_psi NUMERIC
    CHECK (pressure_psi IS NULL OR pressure_psi >= 0);

COMMENT ON COLUMN public.well_readings.pressure_psi IS
  'Wellhead pressure in pounds per square inch.';

-- ── 4. is_meter_replacement ──────────────────────────────────────────────────
-- Flags readings where the meter was physically replaced.  When true, the
-- daily_volume delta is zeroed so dashboards do not miscount the new meter's
-- lower reading as a production loss.
ALTER TABLE public.well_readings
  ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.well_readings.is_meter_replacement IS
  'True when this reading immediately follows a physical meter swap. daily_volume is treated as 0 for this row.';

-- ── 5. Index — TDS / NTU queries for water quality reports ──────────────────
CREATE INDEX IF NOT EXISTS idx_well_readings_water_quality
  ON public.well_readings (well_id, reading_datetime DESC)
  WHERE tds_ppm IS NOT NULL OR turbidity_ntu IS NOT NULL;

-- ── 6. Reload PostgREST schema cache ─────────────────────────────────────────
-- Without this, PostgREST keeps its stale in-memory schema and UPDATE
-- payloads that include the new columns are rejected with:
--   "relation 'well_readings' does not exist"
-- This NOTIFY unblocks the issue immediately without needing a server restart.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260722000003_well_readings_optional_columns.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260722000004_z_pgrst_schema_reload.sql >>>>>>>
-- =============================================================================
-- Migration: 20260722_pgrst_schema_reload.sql
--
-- Forces PostgREST to reload its in-memory schema cache.
--
-- 12 prior migrations added columns, tables, or views to the database without
-- sending NOTIFY pgrst, 'reload schema'.  PostgREST periodically auto-reloads
-- (default: every 10 s in Supabase), but a stale cache in the window between
-- reloads causes UPDATE/INSERT requests to reject columns with the misleading
-- error "relation '<table>' does not exist" instead of a column-not-found msg.
--
-- This is a one-time catch-up.  All future migrations that add schema objects
-- should end with:
--     NOTIFY pgrst, 'reload schema';
-- =============================================================================

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260722000004_z_pgrst_schema_reload.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260723000001_manager_data_corrections_access.sql >>>>>>>
-- =============================================================================
-- Migration: 20260723_manager_data_corrections_access.sql
--
-- src/pages/DataCorrections.tsx already gates its own UI on
--   isAdmin || isManager || isDataAnalyst
-- (see the "Access restricted" card in that file), and the sidebar/bottom-nav
-- link is now shown to Manager too. But the two things that actually enforce
-- write access underneath the page were never updated to match:
--
-- 1. fn_cascade_reading_correction (used by "Edit value" and "Approve
--    correction request") only allows Admin / Data Analyst. A Manager
--    hitting either action gets 'Not authorized to correct readings'.
-- 2. reading_normalizations — the append-only audit table that Pending /
--    Inbox / History all read from and write to directly (approve, reject,
--    retract) — only has RLS policies for Admin / Data Analyst. A Manager's
--    direct inserts/selects against that table are silently denied by RLS.
--
-- This migration adds 'Manager' to both, so Manager gets the same
-- correction/approve/reject/retract capability Admin and Data Analyst
-- already have — not just a view of the page.
--
-- Note: correction_requests (the table backing the "Inbox" tab / operator
-- submitted correction requests) is not created by any migration in this
-- repo — it was set up directly in the Supabase dashboard at some point, so
-- its current RLS can't be inspected or safely rewritten from here. It has a
-- plant_id column, so it most likely already follows the same
-- "*_plant_access" FOR ALL pattern as every other operational table (see
-- 20260419_initial_schema_enums_and_roles.sql), in which case Manager
-- already has read/update access via plant assignment and no change is
-- needed. If it turns out to have its own Admin/Data-Analyst-only policies,
-- apply the same fix as below to it directly in the Supabase SQL editor.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. fn_cascade_reading_correction — allow Manager ─────────────────────────
-- Redefinition is identical to the 20260720_recursive_cascade_and_meter_rollover.sql
-- version (recursive downstream repair), with Manager added to the role check.

DROP FUNCTION IF EXISTS public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_cascade_reading_correction(
  p_table       TEXT,
  p_row_id      UUID,
  p_new_current NUMERIC,
  p_admin_id    UUID,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_col      TEXT;
  v_has_stored_vol  BOOLEAN;
  v_old_current     NUMERIC;
  v_prev_reading    NUMERIC;
  v_entity_id       UUID;
  v_reading_dt      TIMESTAMPTZ;
  v_new_daily_vol   NUMERIC;
  v_role            TEXT;

  -- Walk state for the recursive downstream repair.
  v_cursor_current  NUMERIC;      -- the "true" current_reading to propagate forward
  v_cursor_dt       TIMESTAMPTZ;  -- reading_datetime of the row we just fixed
  v_iter_id         UUID;
  v_iter_prev       NUMERIC;
  v_iter_current    NUMERIC;
  v_iter_dt         TIMESTAMPTZ;
  v_iter_rollover   BOOLEAN;
  v_iter_max        NUMERIC;
  v_iter_daily_vol  NUMERIC;
  v_cascade_ids     UUID[] := ARRAY[]::UUID[];
  v_hops            INT := 0;
  v_max_hops        CONSTANT INT := 500;  -- safety cap against runaway loops on corrupt data
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'Admin')
    OR public.has_role(auth.uid(), 'Data Analyst')
    OR public.has_role(auth.uid(), 'Manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to correct readings';
  END IF;

  IF p_table NOT IN ('locator_readings', 'well_readings', 'product_meter_readings', 'ro_train_readings') THEN
    RAISE EXCEPTION 'Unknown source table: %', p_table;
  END IF;

  IF p_table = 'ro_train_readings' THEN
    RAISE EXCEPTION 'ro_train_readings does not use the single-value cascade correction model';
  END IF;

  v_entity_col := CASE p_table
    WHEN 'locator_readings' THEN 'locator_id'
    WHEN 'well_readings' THEN 'well_id'
    WHEN 'product_meter_readings' THEN 'meter_id'
  END;
  -- locator_readings.daily_volume is GENERATED ALWAYS AS — Postgres recomputes
  -- it automatically and it must never appear in an UPDATE SET list. The other
  -- two tables store it as a plain column that this function must maintain.
  v_has_stored_vol := (p_table <> 'locator_readings');

  EXECUTE format(
    'SELECT current_reading, previous_reading, reading_datetime, %I FROM %I WHERE id = $1',
    v_entity_col, p_table
  ) INTO v_old_current, v_prev_reading, v_reading_dt, v_entity_id
  USING p_row_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reading % not found in %', p_row_id, p_table;
  END IF;

  IF v_has_stored_vol THEN
    v_new_daily_vol := GREATEST(0, p_new_current - COALESCE(v_prev_reading, 0));
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, daily_volume = $2, norm_status = ''normalized'' WHERE id = $3',
      p_table
    ) USING p_new_current, v_new_daily_vol, p_row_id;
  ELSE
    EXECUTE format(
      'UPDATE %I SET current_reading = $1, norm_status = ''normalized'' WHERE id = $2',
      p_table
    ) USING p_new_current, p_row_id;
  END IF;

  -- ── Recursive cascade ────────────────────────────────────────────────────
  -- Walk forward link by link. At each hop, check whether the next row's
  -- previous_reading already matches the upstream current_reading we're
  -- propagating. If it does, the chain is consistent from here on and we
  -- stop — this is what makes a normal single-point correction terminate
  -- after exactly one hop, same as before. If it does NOT match (a
  -- pre-existing broken link further down the chain), fix it and keep
  -- walking using that row's own current_reading as the new cursor value.
  v_cursor_current := p_new_current;
  v_cursor_dt := v_reading_dt;

  LOOP
    v_hops := v_hops + 1;
    EXIT WHEN v_hops > v_max_hops;

    EXECUTE format(
      'SELECT id, previous_reading, current_reading, reading_datetime, is_meter_rollover, meter_rollover_max
         FROM %I WHERE %I = $1 AND reading_datetime > $2 ORDER BY reading_datetime ASC LIMIT 1',
      p_table, v_entity_col
    ) INTO v_iter_id, v_iter_prev, v_iter_current, v_iter_dt, v_iter_rollover, v_iter_max
    USING v_entity_id, v_cursor_dt;

    EXIT WHEN v_iter_id IS NULL;

    -- Chain is already consistent from this point on — nothing further to fix.
    EXIT WHEN v_iter_prev IS NOT DISTINCT FROM v_cursor_current;

    IF v_has_stored_vol THEN
      IF v_iter_rollover AND v_iter_max IS NOT NULL THEN
        v_iter_daily_vol := GREATEST(0, (v_iter_max - v_cursor_current) + v_iter_current);
      ELSE
        v_iter_daily_vol := GREATEST(0, v_iter_current - v_cursor_current);
      END IF;
      EXECUTE format(
        'UPDATE %I SET previous_reading = $1, daily_volume = $2 WHERE id = $3',
        p_table
      ) USING v_cursor_current, v_iter_daily_vol, v_iter_id;
    ELSE
      -- locator_readings: daily_volume is GENERATED and recomputes itself
      -- from previous_reading / is_meter_rollover / meter_rollover_max —
      -- only previous_reading needs writing here.
      EXECUTE format('UPDATE %I SET previous_reading = $1 WHERE id = $2', p_table)
        USING v_cursor_current, v_iter_id;
    END IF;

    v_cascade_ids := array_append(v_cascade_ids, v_iter_id);

    -- This row's own current_reading is what the NEXT row's previous_reading
    -- must match, so it becomes the new cursor for the next iteration.
    v_cursor_current := v_iter_current;
    v_cursor_dt := v_iter_dt;
  END LOOP;

  SELECT role INTO v_role FROM public.user_roles
    WHERE user_id = auth.uid()
    ORDER BY CASE role WHEN 'Admin' THEN 1 WHEN 'Data Analyst' THEN 2 WHEN 'Manager' THEN 3 ELSE 4 END
    LIMIT 1;

  INSERT INTO public.reading_normalizations (
    source_table, source_id, action, original_value, adjusted_value, note, performed_by, performed_role
  ) VALUES (
    p_table, p_row_id, 'normalize', v_old_current, p_new_current, p_reason,
    COALESCE(auth.uid(), p_admin_id), COALESCE(v_role, 'Admin')
  );

  RETURN jsonb_build_object(
    'success', true,
    'cascade_id', v_cascade_ids[1],           -- kept for backward compatibility with existing callers
    'cascade_ids', to_jsonb(v_cascade_ids),
    'cascade_hops', array_length(v_cascade_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cascade_reading_correction(TEXT, UUID, NUMERIC, UUID, TEXT) TO authenticated;

-- ── 2. reading_normalizations RLS — allow Manager ────────────────────────────
-- Same policies as 20260514_normalization.sql, with Manager added.

DROP POLICY IF EXISTS "analyst_read_normalizations" ON reading_normalizations;
CREATE POLICY "analyst_read_normalizations"
  ON reading_normalizations FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
      OR public.has_role(auth.uid(), 'Manager')
    )
  );

DROP POLICY IF EXISTS "analyst_insert_normalizations" ON reading_normalizations;
CREATE POLICY "analyst_insert_normalizations"
  ON reading_normalizations FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'Admin')
      OR public.has_role(auth.uid(), 'Data Analyst')
      OR public.has_role(auth.uid(), 'Manager')
    )
    AND performed_by = auth.uid()
  );

-- No UPDATE or DELETE — audit table stays append-only.

-- ── Done ──────────────────────────────────────────────────────────────────────
-- locator_readings / well_readings / product_meter_readings need no changes:
-- they're already covered by each table's blanket "<table>_plant_access" FOR ALL
-- policy (USING public.user_has_plant_access(plant_id)), which is role-agnostic —
-- any authenticated user assigned to the plant, Manager included, can already
-- UPDATE norm_status on those tables directly.

-- <<<<<<< END ARCHIVED: 20260723000001_manager_data_corrections_access.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260724000001_import_action_in_audit_log.sql >>>>>>>
-- =============================================================================
-- Migration: 20260724_import_action_in_audit_log.sql
-- Extends reading_edit_audit_log to accept 'import' batch log entries.
--
-- Problem: CSV import via ImportROReadingsDialog has no provenance trail —
-- imported rows are currently indistinguishable from live operator entries.
--
-- Changes:
--   1. Widen action CHECK: ('update','delete') → ('update','delete','import')
--   2. Allow record_id to be NULL for import rows (a CSV import covers N records,
--      not a single source_id; we store metadata in the changes jsonb instead).
--   3. Re-enforce NOT NULL for update/delete rows via a compensating CHECK.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- 1. Drop and re-add the action constraint with 'import' included
ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_action_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_action_check
  CHECK (action IN ('update', 'delete', 'import'));

-- 2. Make record_id nullable — import log rows cover many records, not one
ALTER TABLE public.reading_edit_audit_log
  ALTER COLUMN record_id DROP NOT NULL;

-- 3. Compensating check: update/delete rows still require a non-null record_id
ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_record_id_required;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_record_id_required
  CHECK (action = 'import' OR record_id IS NOT NULL);

-- <<<<<<< END ARCHIVED: 20260724000001_import_action_in_audit_log.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260725000001_ro_train_readings_latest_view.sql >>>>>>>
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

-- <<<<<<< END ARCHIVED: 20260725000001_ro_train_readings_latest_view.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260726000001_opex_budgets.sql >>>>>>>
-- opex_budgets: monthly power/chemical opex budget targets per plant, compared
-- against actuals already tracked in production_costs (Costs → Rollup/Budget tabs).
--
-- Visibility AND edit rights are both restricted to Manager/Admin — this is
-- financial planning data, not an operational reading, so unlike most tables
-- in this schema it is NOT read-visible to every role with plant access.

CREATE TABLE public.opex_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  budget_month date NOT NULL,               -- always the 1st of the month
  power_budget numeric NOT NULL DEFAULT 0,
  chem_budget numeric NOT NULL DEFAULT 0,
  total_budget numeric GENERATED ALWAYS AS (power_budget + chem_budget) STORED,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plant_id, budget_month),
  CONSTRAINT opex_budgets_month_is_first_of_month
    CHECK (budget_month = date_trunc('month', budget_month)::date),
  CONSTRAINT opex_budgets_non_negative
    CHECK (power_budget >= 0 AND chem_budget >= 0)
);

CREATE INDEX idx_opex_budgets_plant_month ON public.opex_budgets(plant_id, budget_month DESC);

ALTER TABLE public.opex_budgets ENABLE ROW LEVEL SECURITY;

-- Read: Manager/Admin only, still scoped to plants they're assigned to
-- (is_admin short-circuits user_has_plant_access, so Admins see every plant).
CREATE POLICY opex_budgets_read ON public.opex_budgets FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_insert ON public.opex_budgets FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_update ON public.opex_budgets FOR UPDATE TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_delete ON public.opex_budgets FOR DELETE TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE TRIGGER trg_opex_budgets_updated BEFORE UPDATE ON public.opex_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- <<<<<<< END ARCHIVED: 20260726000001_opex_budgets.sql <<<<<<<

