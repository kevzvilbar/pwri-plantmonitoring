// Shared "why is there no data" reason categories.
// Used by:
//  - the Offline/Inactive status-change reason dialog (Wells, Locators, RO Trains)
//  - the "No reading — why?" gap-logging dialog on the same three entity types
//  - the Data Summary popup, to render a short label + tooltip in place of a
//    blank "—" for any cell that has a reason on file
//
// Keep this list in sync with the CHECK constraints on entity_status_audit_log
// and reading_gap_reasons (see 20260719_offline_reason_tracking.sql).

export const REASON_CATEGORIES = [
  { value: 'pump_problem', label: 'Pump problem' },
  { value: 'locked_meter', label: 'Locked / inaccessible meter' },
  { value: 'equipment_malfunction', label: 'Equipment malfunction' },
  { value: 'maintenance', label: 'Under maintenance' },
  { value: 'access_issue', label: 'Access issue' },
  { value: 'other', label: 'Other' },
] as const;

export type ReasonCategory = typeof REASON_CATEGORIES[number]['value'];

// Reasons a locator's meter gets marked locked — utility/account-level
// causes, not equipment-failure reasons, so kept as a separate list rather
// than folded into REASON_CATEGORIES above (that list also drives the
// Well/RO Train offline dialogs, where "Unpaid bill" or "Vacant property"
// don't apply). Both lists write into the same
// entity_status_audit_log.reason_category column — see
// 20260728_locator_lock_status.sql for the CHECK constraint covering both.
export const LOCK_REASON_CATEGORIES = [
  { value: 'unpaid_bill', label: 'Unpaid bill' },
  { value: 'tampering', label: 'Tampering' },
  { value: 'vacant_property', label: 'Vacant property' },
  { value: 'safety_repair', label: 'Safety or repairs' },
  { value: 'other', label: 'Other' },
] as const;

export type LockReasonCategory = typeof LOCK_REASON_CATEGORIES[number]['value'];

export function reasonCategoryLabel(value: string | null | undefined): string {
  return (
    REASON_CATEGORIES.find((c) => c.value === value)?.label ??
    LOCK_REASON_CATEGORIES.find((c) => c.value === value)?.label ??
    (value || 'Other')
  );
}

// Short entity-type prefix used in Data Summary tooltips, e.g. "Well offline:
// pump problem" / "Locator: locked meter" / "Product Meter: equipment malfunction".
export function reasonEntityPrefix(entityType: 'well' | 'locator' | 'ro_train' | 'meter', isStatusChange: boolean): string {
  const label = entityType === 'well' ? 'Well' : entityType === 'locator' ? 'Locator' : entityType === 'ro_train' ? 'Train' : 'Product Meter';
  return isStatusChange ? `${label} offline` : label;
}

