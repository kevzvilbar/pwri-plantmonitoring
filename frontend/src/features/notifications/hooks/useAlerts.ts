import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlants } from '@/hooks/usePlants';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
import { useAlertStore } from '@/store/alertStore';
import { useDebounce } from '@/hooks/useDebounce';
import { selectActiveAlerts } from '@/hooks/useAlertBadge';
import { sevTier } from '../lib/constants';
import { useAuditedAlertActions } from './useAuditedAlertActions';
import { useNotifications } from './useNotifications';
import { effectiveAlertStatus } from '../lib/alertStatus';
import type { AlertStatus } from '@/store/alertStore';

export type StatusFilter = 'all' | AlertStatus;

export function useAlerts() {
  const navigate = useNavigate();
  const { data: plants } = usePlants();
  const { plantAlerts, snoozeMap, serverStatusByKey } = useAlertStore();

  const [activeView, setActiveView] = useState<'active' | 'logs'>('active');
  const [tierFilter, setTierFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  // P3-3: Active / Acknowledged / Snoozed / Resolved filter over derived status.
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'acknowledged' | 'snoozed' | 'resolved'>('all');
  const [plantFilter, setPlantFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 250);

  // P5-1 (D5): the shared visibility rule. Feeds the plant filter dropdown.
  const { plants: visiblePlants, needsAssignment } = useVisiblePlants();

  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p) => m.set(p.id, p.name ?? p.id));
    return m;
  }, [plants]);

  // Single shared notifications hook
  const {
    notifs,
    notificationsData,
    logsLoading,
    unreadCount: unreadLogsCount,
    markAllRead,
    deleteNotification,
  } = useNotifications();

  const filteredPlantAlerts = useMemo(() => {
    return plantAlerts
      .filter((alert) => {
        if (plantFilter !== 'all' && alert.plantId !== plantFilter) return false;
        const tier = sevTier(alert.severity);
        if (tierFilter !== 'all' && tier !== tierFilter) return false;
        // P3-3: the status filter runs over the audit trail when it has landed,
        // falling back to the local fields while it loads.
        if (statusFilter !== 'all' && effectiveAlertStatus(alert, snoozeMap, serverStatusByKey) !== statusFilter) {
          return false;
        }
        if (debouncedSearchQuery.trim()) {
          const q = debouncedSearchQuery.toLowerCase();
          const pName = plantNameById.get(alert.plantId) || '';
          const matchTitle = (alert.title || '').toLowerCase().includes(q);
          const matchDesc = (alert.description || '').toLowerCase().includes(q);
          const matchSource = (alert.source || '').toLowerCase().includes(q);
          const matchPlant = pName.toLowerCase().includes(q);
          if (!matchTitle && !matchDesc && !matchSource && !matchPlant) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[sevTier(a.severity)] - order[sevTier(b.severity)] || b.timestamp - a.timestamp;
      });
  }, [plantAlerts, plantFilter, tierFilter, statusFilter, snoozeMap, serverStatusByKey, debouncedSearchQuery, plantNameById]);

  const filteredLogs = useMemo(() => {
    return notifs.filter((n) => {
      const tier = sevTier(n.severity);
      if (tierFilter !== 'all' && tier !== tierFilter) return false;
      if (debouncedSearchQuery.trim()) {
        const q = debouncedSearchQuery.toLowerCase();
        const matchTitle = (n.title || '').toLowerCase().includes(q);
        const matchMsg = (n.message || '').toLowerCase().includes(q);
        if (!matchTitle && !matchMsg) return false;
      }
      return true;
    });
  }, [notifs, tierFilter, debouncedSearchQuery]);

  // Active alerts across the fleet (filters out acknowledged, resolved, snoozed)
  const activeAlerts = useMemo(
    () => selectActiveAlerts(plantAlerts, snoozeMap, serverStatusByKey),
    [plantAlerts, snoozeMap, serverStatusByKey],
  );

  const criticalCount = useMemo(
    () => activeAlerts.filter((a) => sevTier(a.severity) === 'critical').length,
    [activeAlerts],
  );
  const warningCount = useMemo(
    () => activeAlerts.filter((a) => sevTier(a.severity) === 'warning').length,
    [activeAlerts],
  );
  const infoCount = useMemo(
    () => activeAlerts.filter((a) => sevTier(a.severity) === 'info').length,
    [activeAlerts],
  );

  // ── P3-2: audited actions — local store update + one alert_events row ──────
  const { ackAlert, ackAll, resolveWithNote, snoozeMany, snoozableIds } = useAuditedAlertActions();

  return {
    navigate,
    activeView, setActiveView,
    tierFilter, setTierFilter,
    statusFilter, setStatusFilter,
    plantFilter, setPlantFilter,
    searchQuery, setSearchQuery,
    plantAlerts, activeAlerts, visiblePlants, needsAssignment, plantNameById,
    notificationsData, logsLoading, notifs,
    filteredPlantAlerts, filteredLogs,
    criticalCount, warningCount, infoCount, unreadLogsCount,
    plantAlertsLength: activeAlerts.length, notifsLength: notifs.length,
    markAllRead, deleteNotification,
    // P3-2: audited actions (local store update + one alert_events row)
    ackAlert, ackAll, resolveWithNote, snoozeMany, snoozableIds,
  };
}
