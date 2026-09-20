import {
  getAlertStatus,
  type AlertStatus,
  type PlantAlert,
  type SnoozeMap,
  type ServerStatusMap,
} from '@/store/alertStore';
import type { AlertServerStatusMap } from '../hooks/useAlertEvents';

export type AnyServerStatusMap = AlertServerStatusMap | ServerStatusMap;

/**
 * P3-2/P3-3: the effective status of an alert.
 *
 * Preference order:
 *   1. The latest server-side event (`alert_events` → get_alert_statuses()).
 *      This is what makes an acknowledgement survive a reload and lets a
 *      second user see it.
 *   2. The local Zustand derivation (acknowledgedAt / resolvedAt / snoozeMap).
 *      Used while the server statuses are still loading, when the migration
 *      hasn't been applied, or for an alert nobody has acted on yet.
 *
 * The server value wins even when it is 'active', because "reopened" must be
 * able to clear a locally-acknowledged alert.
 */
export function effectiveAlertStatus(
  alert: PlantAlert,
  snoozeMap: SnoozeMap,
  serverStatuses?: AnyServerStatusMap,
): AlertStatus {
  if (serverStatuses) {
    const server = serverStatuses[alert.id];
    if (server) {
      if (typeof server === 'string') return server as AlertStatus;
      return server.status;
    }
  }
  return getAlertStatus(alert, snoozeMap);
}

/** True when the alert still needs a human: critical/warning and untouched. */
export function needsAttention(
  alert: PlantAlert,
  snoozeMap: SnoozeMap,
  serverStatuses?: AnyServerStatusMap,
): boolean {
  if (alert.severity !== 'critical' && alert.severity !== 'warning') return false;
  return effectiveAlertStatus(alert, snoozeMap, serverStatuses) === 'active';
}

/** Alert keys the caller has acted on, so a recompute can be suppressed. */
export function actedOnKeys(
  alerts: readonly PlantAlert[],
  snoozeMap: SnoozeMap,
  serverStatuses?: AnyServerStatusMap,
): Set<string> {
  const out = new Set<string>();
  for (const a of alerts) {
    const status = effectiveAlertStatus(a, snoozeMap, serverStatuses);
    if (status !== 'active') out.add(a.id);
  }
  return out;
}
