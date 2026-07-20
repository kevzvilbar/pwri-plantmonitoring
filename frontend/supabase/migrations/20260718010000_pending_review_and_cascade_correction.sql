-- [Consolidated 20260718010000_pending_review_and_cascade_correction.sql]
-- Moved here from the repo's separate top-level supabase/migrations/ folder
-- during a wiring audit (2026-07-20). Originally intended as a one-off
-- 'Dashboard -> SQL Editor' script rather than a CLI-tracked migration;
-- consolidated so there is one migrations folder and the timestamp reflects
-- roughly where it falls in the actual apply order. Verified against the live
-- schema at consolidation time; see original filename below for provenance.
-- Original filename: 20260718_pending_review_and_cascade_correction.sql

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

ALTER TABLE product_meter_readings DROP CONSTRAINT IF EXISTS product_meter_readings_norm_status_check;
ALTER TABLE product_meter_readings
  ADD CONSTRAINT product_meter_readings_norm_status_check
  CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));

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
