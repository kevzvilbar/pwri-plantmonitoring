/**
 * correctionReasons.ts
 * ═════════════════════
 * Single shared taxonomy for "why was this reading wrong," used by:
 *  - CorrectionRequestDialog.tsx   (operator requesting a correction — Item 8)
 *  - DataCorrections.tsx EditValueModal (admin correcting a system-flagged
 *    reading directly from the Pending Review tab)
 *  - CorrectionReasonField.tsx (shared Select — every direct "edit an
 *    already-saved reading" dialog: RO train, pretreatment, locator, well,
 *    product, blending, power, dosing/CIP logs), feeding
 *    reading_edit_audit_log.reason via logReadingEdit()
 *
 * These were previously two independently hand-maintained lists with
 * different wording for the same underlying causes (e.g. "Meter replaced —
 * baseline reset" vs. "Meter replaced — should be marked as replacement"),
 * which meant the "why" field on an operator request and the "why" field on
 * an admin edit couldn't be rolled up together for reporting (e.g. an
 * eventual reason breakdown alongside the Operator Stats / item 7 error-rate
 * table). Keep this as the ONLY place either dialog defines its options —
 * add new fault modes here, not inline in a component.
 */

export const CORRECTION_REASONS = [
  'Meter misread — wrong digits copied',
  'Data entry typo — extra/missing digit',
  'Wrong previous value used as anchor',
  'Meter replaced — baseline reset',
  'Duplicate entry — this one is the wrong one',
  'Reading entered for wrong locator/well',
  'Other',
] as const;

export type CorrectionReason = typeof CORRECTION_REASONS[number];

// Folds a selected reason + its free-typed detail (only used when
// reason === 'Other') into the single string every consumer stores —
// same flattening CorrectionRequestDialog.tsx has always done for
// correction_requests.reason, reused here so reading_edit_audit_log.reason
// stays in the same shape instead of introducing a second convention.
export function resolveReason(reason: string, customReason: string): string {
  return reason === 'Other' ? (customReason.trim() || 'Other') : reason;
}
