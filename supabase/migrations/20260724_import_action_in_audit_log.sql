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
