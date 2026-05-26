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
