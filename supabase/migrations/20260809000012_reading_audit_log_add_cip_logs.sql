-- =============================================================================
-- Migration: 20260809_reading_audit_log_add_cip_logs.sql
--
-- CIPLog.tsx's saveEdit() has always called logReadingEdit() with
-- `table_name: 'chemical_dosing_logs' as any` — the comment right above it
-- said why: "cast table_name since cip_logs isn't in the type union yet."
-- 'cip_logs' was never in this table's CHECK constraint either, so casting
-- to a table name that WAS allowed was the only way it worked at all — every
-- CIP edit has been silently misattributed to Chemical Dosing in the audit
-- trail since this page shipped, including now that CIP edits carry a
-- required reason (20260809_reading_edit_audit_log_reason.sql) — that reason
-- has been landing under the wrong table_name too.
--
-- Paired with a frontend fix (CIPLog.tsx, helpers.tsx) that now passes the
-- correct 'cip_logs' literal. Without this migration, that fix alone would
-- turn a silent mislabeling into a silent non-write instead (logReadingEdit
-- swallows insert failures on purpose — audit logging must never block the
-- actual save), which would be worse: CIP edits would stop being audited at
-- all instead of just being audited under the wrong table name.
-- =============================================================================

ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'cip_logs',
    'locator_readings',
    'power_readings',
    'blending_events',
    'well_readings'
  ));

NOTIFY pgrst, 'reload schema';
