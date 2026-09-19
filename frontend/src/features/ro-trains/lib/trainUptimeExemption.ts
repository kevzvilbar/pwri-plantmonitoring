/**
 * The "was actually running — failed to encode" exemption reason.
 *
 * Selected in the downtime-reason dropdown when the 2h auto-offline flag is
 * a false positive: the train genuinely kept running, only the encoding
 * stopped (operator forgot, or the terminal/app was down). Filing it writes
 * a retroactive attestation (ro_train_uptime_reports) instead of downtime:
 * the open Auto-flagged row is removed, the train flips back to Running,
 * history keeps the attestation text, and flowrate calc bridges the gap.
 * The train never stopped, so Offline Since is the gap's start (informational)
 * and Back Online At is not applicable.
 */
export const WAS_ACTUALLY_RUNNING_REASON = 'Was actually running — failed to encode';

/**
 * Sub-reasons for the exemption — the "why is there a reading gap" answer.
 * Shared by the RO log page dropdown and the history modal's attestation
 * dialog so the two surfaces can't drift apart.
 */
export const UPTIME_EXEMPTION_SUBREASONS = [
  { value: 'operator_failed_to_encode', label: 'Operator failed to encode readings' },
  { value: 'system_error', label: 'System / app error prevented encoding' },
  { value: 'other', label: 'Other (explain in details)' },
] as const;

export type UptimeExemptionSubreason = typeof UPTIME_EXEMPTION_SUBREASONS[number]['value'];

/** True when the selected downtime reason is the "was actually running" exemption. */
export function isWasActuallyRunningReason(reason: string | null | undefined): boolean {
  return reason === WAS_ACTUALLY_RUNNING_REASON;
}

