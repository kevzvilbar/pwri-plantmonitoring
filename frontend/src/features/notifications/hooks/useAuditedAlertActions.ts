/**
 * useAuditedAlertActions — P3-2/P3-5
 *
 * Every acknowledge / resolve / snooze writes one `alert_events` row in
 * addition to updating the in-memory store, so the action survives a reload
 * and is visible to a second user on the same plant.
 *
 * Shared by the TopBar bell panel and the Alerts triage page so there is no
 * path that updates the store without persisting the event.
 */
import { useCallback, useMemo } from 'react';
import { useAlertStore } from '@/store/alertStore';
import { useAuth } from '@/hooks/useAuth';
import { useAlertEvents, MAX_SNOOZE_MS, isSnoozeAllowed } from './useAlertEvents';

export function useAuditedAlertActions() {
  const { user } = useAuth();
  const plantAlerts = useAlertStore((s) => s.plantAlerts);
  const acknowledgeAlert = useAlertStore((s) => s.acknowledgeAlert);
  const resolveAlert = useAlertStore((s) => s.resolveAlert);
  const acknowledgeAll = useAlertStore((s) => s.acknowledgeAll);
  const snoozeAlert = useAlertStore((s) => s.snoozeAlert);
  const { record: recordAlertEvent } = useAlertEvents();

  /** One alert acknowledged. */
  const ackAlert = useCallback((id: string) => {
    const alert = plantAlerts.find((a) => a.id === id);
    acknowledgeAlert(id, user?.id ?? 'unknown');
    void recordAlertEvent({ alertKey: id, action: 'acknowledged', plantId: alert?.plantId });
  }, [plantAlerts, user?.id, acknowledgeAlert, recordAlertEvent]);

  /** Every untouched alert acknowledged. */
  const ackAll = useCallback(() => {
    acknowledgeAll(user?.id ?? 'unknown');
    plantAlerts
      .filter((a) => a.acknowledgedAt == null && a.resolvedAt == null)
      .forEach((a) =>
        void recordAlertEvent({ alertKey: a.id, action: 'acknowledged', plantId: a.plantId }));
  }, [plantAlerts, user?.id, acknowledgeAll, recordAlertEvent]);

  /** D2: resolving requires a note, which is stored on the event row. */
  const resolveWithNote = useCallback((id: string, note: string) => {
    const alert = plantAlerts.find((a) => a.id === id);
    resolveAlert(id, user?.id ?? 'unknown');
    void recordAlertEvent({
      alertKey: id,
      action: 'resolved',
      plantId: alert?.plantId,
      note: note.trim(),
    });
  }, [plantAlerts, user?.id, resolveAlert, recordAlertEvent]);

  /** P3-5: bulk snooze caps at 24 h and never touches critical alerts. */
  const snoozeMany = useCallback((ids: string[], durationMs: number) => {
    ids.forEach((id) => {
      const alert = plantAlerts.find((a) => a.id === id);
      if (alert && isSnoozeAllowed(alert.severity, durationMs)) {
        snoozeAlert(id, durationMs);
        void recordAlertEvent({
          alertKey: id,
          action: 'snoozed',
          plantId: alert.plantId,
          snoozeUntil: new Date(Date.now() + durationMs).toISOString(),
        });
      }
    });
  }, [plantAlerts, snoozeAlert, recordAlertEvent]);

  /** Non-critical ids only — "Snooze all" greys out when this is empty. */
  const snoozableIds = useMemo(
    () => plantAlerts.filter((a) => isSnoozeAllowed(a.severity, MAX_SNOOZE_MS)).map((a) => a.id),
    [plantAlerts],
  );

  return { ackAlert, ackAll, resolveWithNote, snoozeMany, snoozableIds };
}
