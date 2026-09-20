/**
 * AlertsRuntime — P3-7 of docs/NAV-IA-REMEDIATION-PLAN.md
 *
 * Mounted exactly ONCE, in AppShell. Two jobs:
 *
 *  1. Run the alarm computation on every route, not just the Dashboard. It
 *     mounts `useAlertsData()`, which drives `useDashboardAlerts()`.
 *
 *     Watch for double mounting: `useTrainAutoOffline` documents that two
 *     mounted instances write duplicate Offline status-log rows for the same
 *     train in the same tick. It carries a single-writer guard, and
 *     `pages/Dashboard.tsx` no longer mounts the alert hook at all — the
 *     domain hooks it does mount use identical query keys, so React Query
 *     dedupes the fetches rather than doubling them.
 *
 *  2. Pull the `alert_events` audit trail and hand it to the store, so the nav
 *     badge and every list agree on what has been acknowledged/resolved, and
 *     so a second user sees the same state. This is the P3-2 → P3-3 bridge.
 *
 * Renders nothing: keeping it a null-rendering leaf means a status change never
 * re-renders the shell tree (same rationale as BackgroundSyncMount).
 */
import { useEffect } from 'react';
import { useAlertsData } from './hooks/useAlertsData';
import { useAlertEvents, type AlertServerStatus } from './hooks/useAlertEvents';
import { useAlertStore } from '@/store/alertStore';
import type { ServerStatusMap } from '@/store/alertStore';

export function AlertsRuntime() {
  const { plantIds, plantIdsKey } = useAlertsData();
  const { statuses } = useAlertEvents(plantIds);
  const setServerStatuses = useAlertStore((s) => s.setServerStatuses);

  useEffect(() => {
    // Flatten the server payload to alert_key → status; the store only needs
    // the status to answer "does this still need a human?".
    const flat: ServerStatusMap = {};
    for (const [key, value] of Object.entries(statuses)) {
      const serverStatus = value as AlertServerStatus | undefined;
      if (serverStatus?.status) flat[key] = serverStatus.status;
    }
    setServerStatuses(flat);
    // plantIdsKey intentionally participates: the payload is scoped per plant
    // set, so a plant change must re-apply (and clear anything now out of scope).
  }, [statuses, plantIdsKey, setServerStatuses]);

  return null;
}
