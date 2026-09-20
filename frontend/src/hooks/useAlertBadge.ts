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
