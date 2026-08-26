-- Extend reading_edit_audit_log to cover power_readings, blending_events, and
-- well_readings.
--
-- PowerSection.tsx previously had no edit-window gating or audit logging at
-- all (see Design Audit / Critical Issue #3 — the edit path existed but was
-- ungated and unaudited, and delete didn't exist). Investigating that surfaced
-- a bigger issue: the actual edit/delete UI for readings isn't in
-- PowerSection.tsx at all (its local editingId/startEdit are dead code, never
-- called) -- it's the shared ReadingHistoryDialog.tsx, used by all four
-- reading modules (locator, well, power, blending), which had
-- `const canEditDelete = true` hardcoded with no role/ownership/time-window
-- check and no audit logging whatsoever. The frontend fix wires all four
-- modules up to the same canEditEntry/logReadingEdit primitive already used
-- by ro_train_readings/ro_pretreatment_readings/chemical_dosing_logs/
-- locator_readings -- this migration is the DB-side half of that, following
-- the exact same DROP/ADD pattern 20260727_hamas_phase0_roles_and_audit.sql
-- used when locator_readings was added. well_readings is added alongside the
-- other two for the same reason -- it went through this exact dialog too and
-- had no audit coverage despite locator_readings (its closest sibling) having
-- had it since Phase 0.
--
-- blending_events has no recorded_by column (never had per-operator
-- ownership tracking), so canEditEntry naturally degrades to admin/manager/
-- data-analyst-only there -- no schema change needed for the permission
-- check itself, just adding it here so admin-performed blending edits and
-- deletes actually get logged like everywhere else.

ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'locator_readings',
    'power_readings',
    'blending_events',
    'well_readings'
  ));

NOTIFY pgrst, 'reload schema';
