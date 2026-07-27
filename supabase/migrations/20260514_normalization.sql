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

ALTER TABLE product_meter_readings
  ADD COLUMN IF NOT EXISTS norm_status TEXT
  CHECK (norm_status IN ('normal', 'erroneous', 'normalized', 'retracted'))
  DEFAULT 'normal';

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
