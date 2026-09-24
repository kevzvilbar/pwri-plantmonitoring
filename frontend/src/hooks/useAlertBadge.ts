import {
  getAlertStatus,
  useAlertStore,
  type PlantAlert,
  type ServerStatusMap,
  type SnoozeMap,
} from '@/store/alertStore';

/**
 * Alerts that still need a human: critical or warning severity, and not
 * acknowledged, resolved or snoozed. Info alerts never count toward a badge.
 *
 * P3-3: "acknowledged" now comes from the `alert_events` audit trail when it is
 * available (serverStatusByKey), so the count agrees with what a second user
 * sees. It falls back to the local store fields otherwise.
 */
export function selectAttentionAlerts(
  alerts: readonly PlantAlert[],
  snoozeMap: SnoozeMap,
  serverStatusByKey: ServerStatusMap = {},
): PlantAlert[] {
  return alerts.filter(
    (a) =>
      (a.severity === 'critical' || a.severity === 'warning') &&
      getAlertStatus(a, snoozeMap, serverStatusByKey) === 'active',
  );
}

/**
 * All alerts that are currently active (not acknowledged, resolved, or snoozed),
 * including info severity.
 */
export function selectActiveAlerts(
  alerts: readonly PlantAlert[],
  snoozeMap: SnoozeMap,
  serverStatusByKey: ServerStatusMap = {},
): PlantAlert[] {
  return alerts.filter(
    (a) => getAlertStatus(a, snoozeMap, serverStatusByKey) === 'active',
  );
}

/**
 * Alerts that are still open — any severity, any status except resolved.
 * Acknowledged and snoozed alerts stay in this set, so a list built from it
 * (the bell panel's "Active Alarms" tab) keeps showing an alert — with its
 * "Acknowledged by …" status line — until someone actually resolves it,
 * instead of the alert vanishing the moment it's acknowledged.
 *
 * This is the selector for *what to list*. `selectAttentionAlerts` and
 * `selectActiveAlerts` are for *what to count* on a badge — do not reuse
 * either of those to drive a list of alerts a person needs to keep reading.
 */
export function selectOpenAlerts(
  alerts: readonly PlantAlert[],
  snoozeMap: SnoozeMap,
  serverStatusByKey: ServerStatusMap = {},
): PlantAlert[] {
  return alerts.filter(
    (a) => getAlertStatus(a, snoozeMap, serverStatusByKey) !== 'resolved',
  );
}

/** Nav badge state, read from the in-memory alert store. Two primitive
 *  selectors, so subscribers only re-render when a value actually changes. */
export function useAlertBadge(): { count: number; hasCritical: boolean } {
  const count = useAlertStore(
    (s) => selectAttentionAlerts(s.plantAlerts, s.snoozeMap, s.serverStatusByKey).length,
  );
  const hasCritical = useAlertStore((s) =>
    selectAttentionAlerts(s.plantAlerts, s.snoozeMap, s.serverStatusByKey).some(
      (a) => a.severity === 'critical',
    ),
  );
  return { count, hasCritical };
}
