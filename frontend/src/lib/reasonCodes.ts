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

export function reasonCategoryLabel(value: string | null | undefined): string {
  return REASON_CATEGORIES.find((c) => c.value === value)?.label ?? (value || 'Other');
}

// Short entity-type prefix used in Data Summary tooltips, e.g. "Well offline:
// pump problem" / "Locator: locked meter".
export function reasonEntityPrefix(entityType: 'well' | 'locator' | 'ro_train', isStatusChange: boolean): string {
  const label = entityType === 'well' ? 'Well' : entityType === 'locator' ? 'Locator' : 'Train';
  return isStatusChange ? `${label} offline` : label;
}
