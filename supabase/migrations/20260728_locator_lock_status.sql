-- =============================================================================
-- Migration: 20260728_locator_lock_status.sql
-- Phase 1 of the locked/disconnected meter + illegal-consumption flagging
-- feature.
--
-- Adds a locator-level lock_status, independent of the existing Active/
-- Inactive `status` column. Deliberately NOT reusing `status`:
-- LocatorSection.tsx (~line 386), Dashboard.tsx, ReadingCoverageCard.tsx, and
-- PlantTopology.tsx all filter locators on status = 'Active' — a locator set
-- Inactive drops out of the Operations reading-entry list entirely. Since
-- catching illegal consumption on a locked/disconnected meter requires
-- readings to KEEP being logged against it, the lock state has to live on a
-- column nothing already filters on.
--
-- Also extends the existing reason-category system (used for Active/Inactive
-- status changes and reading-gap logging on Wells/Locators/RO Trains) with a
-- 'disconnected_meter' category alongside the existing 'locked_meter', so a
-- meter lock event can be told apart from a disconnection at a glance in
-- entity_status_audit_log / reading_gap_reasons and in the UI.
--
-- Keep the reason_category list here in sync with
-- frontend/src/lib/reasonCodes.ts REASON_CATEGORIES.
--
-- Phase 2 (separate migration) adds locator_lock_violation_flags + the
-- AFTER INSERT trigger on locator_readings that actually flags movement,
-- following the pattern in 20260727_hamas_phase0/phase3.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 1. locators.lock_status ─────────────────────────────────────────────────

ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS lock_status TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE public.locators
  DROP CONSTRAINT IF EXISTS locators_lock_status_check;
ALTER TABLE public.locators
  ADD CONSTRAINT locators_lock_status_check
  CHECK (lock_status IN ('normal', 'locked', 'disconnected'));

COMMENT ON COLUMN public.locators.lock_status IS
  'Physical meter access state, independent of status (Active/Inactive). '
  '''locked'' = padlocked/sealed but still physically connected. '
  '''disconnected'' = physically removed/cut. Unlike status=Inactive, this '
  'column is never filtered on when loading locators for reading entry — '
  'operators must keep being able to log readings against a locked or '
  'disconnected meter so movement can be caught. See the 20260727 hamas '
  'migrations for the sibling review-flag pattern this feature follows.';

-- Partial index: only the (small) set of non-normal locators is ever queried
-- by name, so no need to index the common 'normal' case.
CREATE INDEX IF NOT EXISTS idx_locators_lock_status
  ON public.locators (lock_status) WHERE lock_status <> 'normal';

-- ── 2. New reason category: disconnected_meter ──────────────────────────────
-- 'locked_meter' already existed (used for the Active/Inactive offline-reason
-- flow). Adding 'disconnected_meter' alongside it lets the SAME dialog/table
-- also carry lock_status change reasons without a parallel mechanism.

ALTER TABLE public.entity_status_audit_log
  DROP CONSTRAINT IF EXISTS entity_status_audit_log_reason_category_check;
ALTER TABLE public.entity_status_audit_log
  ADD CONSTRAINT entity_status_audit_log_reason_category_check
  CHECK (reason_category IN
    ('pump_problem', 'locked_meter', 'disconnected_meter',
     'equipment_malfunction', 'maintenance', 'access_issue', 'other'));

ALTER TABLE public.reading_gap_reasons
  DROP CONSTRAINT IF EXISTS reading_gap_reasons_reason_category_check;
ALTER TABLE public.reading_gap_reasons
  ADD CONSTRAINT reading_gap_reasons_reason_category_check
  CHECK (reason_category IN
    ('pump_problem', 'locked_meter', 'disconnected_meter',
     'equipment_malfunction', 'maintenance', 'access_issue', 'other'));

NOTIFY pgrst, 'reload schema';
