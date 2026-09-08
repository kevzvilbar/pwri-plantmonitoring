-- =============================================================================
-- Migration: 20260811_reading_audit_log_add_product_meter.sql
--
-- ProductMeterHistoryDialog (frontend/src/pages/operations/product/
-- ProductSection.tsx) is the "edit an already-saved reading" surface for
-- product meters — the direct sibling of the well/locator/power/blending
-- edit flow in ReadingHistoryDialog.tsx and the RO train/pretreatment/CIP/
-- dosing edit dialogs. Every one of those already requires picking a reason
-- from CORRECTION_REASONS (CorrectionReasonField) and logs the edit via
-- logReadingEdit() -> reading_edit_audit_log. ProductMeterHistoryDialog's
-- saveEdit()/deleteRow() never did either — confirmed by
-- 20260807_reading_anomaly_remarks.sql's own comment describing
-- product_meter_readings as "the one reading table that audit log doesn't
-- cover yet", and by 20260809_reading_edit_audit_log_reason.sql listing
-- "product" among the surfaces the reason column was meant to cover.
--
-- Paired with a frontend fix (ProductSection.tsx, helpers.tsx) that now
-- requires a reason and calls logReadingEdit() with
-- table_name: 'product_meter_readings'. Without this migration, that insert
-- would fail the table_name CHECK constraint — logReadingEdit() swallows
-- insert failures on purpose (audit logging must never block the actual
-- save), so the edit would keep silently going unaudited exactly as before.
-- Same DROP/ADD pattern as 20260806_reading_audit_log_add_power_blending_well.sql
-- and 20260809_reading_audit_log_add_cip_logs.sql.
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
    'well_readings',
    'product_meter_readings'
  ));

NOTIFY pgrst, 'reload schema';
