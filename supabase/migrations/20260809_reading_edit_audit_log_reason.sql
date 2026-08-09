-- =============================================================================
-- Migration: 20260809_reading_edit_audit_log_reason.sql
--
-- CONTEXT: correctionReasons.ts already defines a shared CORRECTION_REASONS
-- taxonomy, and two surfaces already require picking one — an operator's
-- CorrectionRequestDialog (goes to supervisor approval) and an admin's
-- EditValueModal on the Pending Review tab (DataCorrections.tsx). But the
-- day-to-day "edit an already-saved reading" dialogs used throughout
-- Operations (RO trains, pretreatment, locators, wells, product, blending,
-- power, dosing/CIP logs) never got wired to it — they log a field-level
-- diff via logReadingEdit() -> reading_edit_audit_log, but nothing about
-- *why*. This adds the column that was missing to actually record it.
--
-- Plain TEXT, no CHECK constraint: mirrors correction_requests.reason,
-- which is enforced against CORRECTION_REASONS only at the app layer (the
-- shared dropdown), including a free-typed 'Other' value. Nullable —
-- existing rows have none, and by product decision this only applies to
-- 'update' actions going forward (not 'delete' or bulk 'import'), so NULL
-- stays a normal, valid state at the DB level; the requirement is enforced
-- client-side by gating each dialog's Save button, same pattern the two
-- existing consumers already use.
-- =============================================================================

ALTER TABLE public.reading_edit_audit_log
  ADD COLUMN IF NOT EXISTS reason TEXT;

NOTIFY pgrst, 'reload schema';
