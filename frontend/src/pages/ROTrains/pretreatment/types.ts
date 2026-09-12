export type AfmRow = {
  unit: number;
  bw: boolean;
  bwStart: string;
  bwEnd: string;
  meterStart: string;
  meterEnd: string;
  pressureIn: string;
  pressureOut: string;
};

export const AFM_REASON_OPTIONS = [
  'Pressure gauge broken / unreadable',
  'Unit isolated / in bypass',
  'Unit in standby / offline',
  'Under maintenance / media replacement',
  'Differential pressure gauge faulty',
  'Other',
];

export const BOOSTER_REASON_OPTIONS = [
  'Pump in standby / not running',
  'Ammeter broken / unreadable',
  'VFD fault / tripped',
  'Under maintenance / isolated',
  'Pressure transmitter offline',
  'Other',
];

export const STANDARD_OFFLINE_REASONS = [
  'Scheduled Maintenance',
  'Membrane Replacement',
  'CIP In Progress',
  'Power Outage',
  'High Pressure Trip',
  'Low Feed Flow',
  'Instrumentation Fault',
  'Pump Failure',
  'Feedwater Quality Issue',
  'Operator Shutdown',
  'Peak/Off-Peak Program',
];

/**
 * "Was actually running" exemption for the 2h auto-offline rule.
 *
 * The auto-offline flag measures DATA staleness, not pump state. When an
 * operator fails to encode readings for >2h (forgot, or the terminal/app was
 * down), the train genuinely kept running but gets auto-flagged Offline — a
 * false positive. Selecting this reason in the offline form files a
 * retroactive attestation (ro_train_uptime_reports) instead of downtime:
 * the open Auto-flagged row is removed, the train flips back to Running,
 * history keeps the attestation text, and flowrate calc bridges the gap.
 * There is nothing to "come back" from, so Back Online At is disabled.
 */
export const WAS_ACTUALLY_RUNNING_REASON = 'Was actually running — failed to encode';

/** Sub-reasons for the exemption — mirrors UPTIME_REPORT_CATEGORIES in TrainLogModal.tsx. */
export const UPTIME_EXEMPTION_SUBREASONS = [
  { value: 'operator_failed_to_encode', label: 'Operator failed to encode readings' },
  { value: 'system_error', label: 'System / app error prevented encoding' },
  { value: 'other', label: 'Other (explain in details)' },
] as const;

export type UptimeExemptionSubreason = typeof UPTIME_EXEMPTION_SUBREASONS[number]['value'];

/** True when the selected offline reason is the "was actually running" exemption. */
export function isWasActuallyRunningReason(reason: string | null | undefined): boolean {
  return reason === WAS_ACTUALLY_RUNNING_REASON;
}

export const HPP_REASON_OPTIONS = [
  'HPP pressure gauge broken / unreadable',
  'HPP in standby / not running',
  'Pressure transmitter fault',
  'Under maintenance',
  'Other',
];

export const HOUSING_REASON_OPTIONS = [
  'Pressure gauge broken / stuck',
  'Housing bypassed / isolated',
  'Housing in standby',
  'Under maintenance / filter change in progress',
  'Other',
];

export function getUnitReasonText(entry?: { reason: string; custom: string } | string | null) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry.trim();
  if (entry.reason === 'Other') return entry.custom?.trim() || 'Other';
  return entry.reason?.trim() || '';
}
