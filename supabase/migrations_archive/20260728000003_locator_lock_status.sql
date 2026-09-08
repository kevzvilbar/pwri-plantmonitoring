-- =============================================================================
-- Migration: 20260728_locator_lock_status.sql
-- Phase 1 of the locked-meter + illegal-consumption flagging feature.
--
-- Adds a locator-level is_locked flag, independent of the existing Active/
-- Inactive `status` column. Deliberately NOT reusing `status`:
-- LocatorSection.tsx (~line 386), Dashboard.tsx, ReadingCoverageCard.tsx, and
-- PlantTopology.tsx all filter locators on status = 'Active' — a locator set
-- Inactive drops out of the Operations reading-entry list entirely. Since
-- catching illegal consumption on a locked meter requires readings to KEEP
-- being logged against it, the lock state has to live on a column nothing
-- already filters on.
--
-- Covers both a padlocked-but-connected meter and a physically disconnected
-- one under the single is_locked flag — no need to distinguish the two for
-- how this is handled downstream, so this stays a plain boolean (matching
-- the is_derived / is_estimated convention already used on this table)
-- instead of a multi-value status column.
--
-- Why a meter gets locked is a utility/account-level cause (unpaid bill,
-- tampering, vacant property, safety/repair work) — a different domain from
-- the equipment-failure reasons in the existing entity_status_audit_log
-- constraint (pump problem, equipment malfunction, etc.), which exists for
-- the Well/RO Train offline dialogs and the reading-gap dialog. Both sets
-- write into the same reason_category column, so the constraint below
-- extends to allow both. Keep this list in sync with
-- frontend/src/lib/reasonCodes.ts — REASON_CATEGORIES for the first six,
-- LOCK_REASON_CATEGORIES for the last four ('other' is shared, listed once).
--
-- No changes needed to reading_gap_reasons — the meter-lock reason dialog
-- only writes to entity_status_audit_log (via logStatusChange), not to the
-- reading-gap flow, so only that one constraint needs extending.
--
-- Phase 2 (separate migration) adds locator_lock_violation_flags + the
-- AFTER INSERT trigger on locator_readings that actually flags movement,
-- following the pattern in 20260727_hamas_phase0/phase3.
--
-- NOTE: an earlier draft of this migration (already pushed) created a
-- lock_status TEXT column instead. If that ran against this database, drop
-- it first so it doesn't linger unused alongside is_locked:
--   ALTER TABLE public.locators DROP COLUMN IF EXISTS lock_status;
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.locators.is_locked IS
  'Meter is padlocked/sealed or physically disconnected — independent of '
  'status (Active/Inactive). Unlike status=Inactive, this column is never '
  'filtered on when loading locators for reading entry — operators must '
  'keep being able to log readings against a locked meter so movement can '
  'be caught. See the 20260727 hamas migrations for the sibling '
  'review-flag pattern this feature follows.';

-- Partial index: only the (small) set of locked locators is ever queried by
-- name, so no need to index the common false case.
CREATE INDEX IF NOT EXISTS idx_locators_is_locked
  ON public.locators (is_locked) WHERE is_locked = true;

ALTER TABLE public.entity_status_audit_log
  DROP CONSTRAINT IF EXISTS entity_status_audit_log_reason_category_check;
ALTER TABLE public.entity_status_audit_log
  ADD CONSTRAINT entity_status_audit_log_reason_category_check
  CHECK (reason_category IN
    ('pump_problem', 'locked_meter', 'equipment_malfunction',
     'maintenance', 'access_issue', 'other',
     'unpaid_bill', 'tampering', 'vacant_property', 'safety_repair'));

NOTIFY pgrst, 'reload schema';
