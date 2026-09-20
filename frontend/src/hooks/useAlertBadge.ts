import { getAlertStatus, useAlertStore, type PlantAlert, type SnoozeMap } from '@/store/alertStore';

/**
 * Alerts that still need a human: critical or warning severity, and not
 * acknowledged, resolved or snoozed. Info alerts never count toward a badge.
 */
export function selectAttentionAlerts(alerts: readonly PlantAlert[], snoozeMap: SnoozeMap): PlantAlert[] {
  return alerts.filter(
    (a) => (a.severity === 'critical' || a.severity === 'warning') && getAlertStatus(a, snoozeMap) === 'active',
  );
}

/** Nav badge state, read from the in-memory alert store. Two primitive
 *  selectors, so subscribers only re-render when a value actually changes. */
export function useAlertBadge(): { count: number; hasCritical: boolean } {
  const count = useAlertStore((s) => selectAttentionAlerts(s.plantAlerts, s.snoozeMap).length);
  const hasCritical = useAlertStore((s) =>
    selectAttentionAlerts(s.plantAlerts, s.snoozeMap).some((a) => a.severity === 'critical'),
  );
  return { count, hasCritical };
}
