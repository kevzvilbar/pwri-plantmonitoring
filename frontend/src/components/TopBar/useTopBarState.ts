import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePlantStore } from '@/store/plantStore';
import { useAlertStore } from '@/store/alertStore';
import { usePlants } from '@/hooks/usePlants';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
import { usePlantSelectionGuard } from '@/hooks/usePlantSelectionGuard';
import { useNavigate } from 'react-router-dom';
import { useSidebar } from '@/components/ui/sidebar';
import { selectActiveAlerts, selectAttentionAlerts } from '@/hooks/useAlertBadge';
import { useNotifications } from '@/features/notifications/hooks/useNotifications';
import { SevTier } from './types';
import { sevTier } from './helpers';

export function useTopBarState() {
  const { user } = useAuth();
  const { isMobile, state } = useSidebar();
  const sidebarCollapsed = state === 'collapsed';
  const { data: plants } = usePlants();
  const { selectedPlantId, setSelectedPlantId } = usePlantStore();
  const {
    plantAlerts,
    alertsReady,
    snoozeMap,
    serverStatusByKey,
    snoozeAlert,
    unsnoozeAlert,
    pruneSnooze,
    acknowledgeAlert,
    resolveAlert,
    acknowledgeAll,
    resolveAll,
  } = useAlertStore();

  const navigate = useNavigate();

  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'logs'>('active');
  const [tierFilter, setTierFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [isRinging, setIsRinging] = useState(false);

  // P5-1 (D5): one visibility rule shared with the Alerts page, the alert
  // runtime, the Plants page and the Dashboard.
  const { plants: visiblePlants, needsAssignment } = useVisiblePlants();
  // P5-2: drop a persisted plant selection this user cannot see.
  usePlantSelectionGuard();

  // De-duplicated notifications hook
  const {
    notifs,
    unreadCount,
    markAllRead,
    deleteNotification,
  } = useNotifications();

  useEffect(() => {
    pruneSnooze();
  }, [pruneSnooze]);

  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p) => m.set(p.id, p.name ?? p.id));
    return m;
  }, [plants]);

  // Global attention alerts (critical + warning, active status across all visible plants)
  // Guarantees exact count parity with sidebar badge.
  const attentionAlerts = useMemo(
    () => selectAttentionAlerts(plantAlerts, snoozeMap, serverStatusByKey),
    [plantAlerts, snoozeMap, serverStatusByKey],
  );
  const attentionCount = attentionAlerts.length;

  // Active alerts (all active status alerts across all plants, including info)
  const activeAlerts = useMemo(
    () => selectActiveAlerts(plantAlerts, snoozeMap, serverStatusByKey),
    [plantAlerts, snoozeMap, serverStatusByKey],
  );
  const activeAlarmsCount = activeAlerts.length;

  // Total badge sums unread workflow notifications and attention alerts
  const totalBadge = unreadCount + attentionCount;
  const hasCritical = useMemo(
    () => attentionAlerts.some((a) => a.severity === 'critical'),
    [attentionAlerts],
  );

  const prevCriticalIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const currentCriticalIds = attentionAlerts
      .filter((a) => a.severity === 'critical')
      .map((a) => a.id);
    const hasNewCritical = currentCriticalIds.some((id) => !prevCriticalIdsRef.current.includes(id));
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (hasNewCritical && currentCriticalIds.length > 0) {
      setIsRinging(true);
      timer = setTimeout(() => setIsRinging(false), 700);
    }
    prevCriticalIdsRef.current = currentCriticalIds;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [attentionAlerts]);

  // ── P3-8: AlertPanel list displays active alarms, optionally filtered to selectedPlantId
  const scopedAlerts = useMemo(() => {
    if (!selectedPlantId) return activeAlerts;
    return activeAlerts.filter((a) => !a.plantId || a.plantId === selectedPlantId);
  }, [activeAlerts, selectedPlantId]);

  const sortedAlerts = useMemo(
    () =>
      [...scopedAlerts].sort((a, b) => {
        const order: Record<SevTier, number> = { critical: 0, warning: 1, info: 2 };
        return order[sevTier(a.severity)] - order[sevTier(b.severity)] || b.timestamp - a.timestamp;
      }),
    [scopedAlerts],
  );

  const criticalAlerts = useMemo(
    () => sortedAlerts.filter((a) => sevTier(a.severity) === 'critical'),
    [sortedAlerts],
  );
  const warningAlerts = useMemo(
    () => sortedAlerts.filter((a) => sevTier(a.severity) === 'warning'),
    [sortedAlerts],
  );
  const infoAlerts = useMemo(
    () => sortedAlerts.filter((a) => sevTier(a.severity) === 'info'),
    [sortedAlerts],
  );

  const displayedAlerts = useMemo(() => {
    if (tierFilter === 'critical') return criticalAlerts;
    if (tierFilter === 'warning') return warningAlerts;
    if (tierFilter === 'info') return infoAlerts;
    return sortedAlerts;
  }, [tierFilter, sortedAlerts, criticalAlerts, warningAlerts, infoAlerts]);

  return {
    panelOpen,
    setPanelOpen,
    activeTab,
    setActiveTab,
    tierFilter,
    setTierFilter,
    visiblePlants,
    needsAssignment,
    notifs,
    unreadCount,
    plantAlerts,
    activeAlerts,
    activeAlarmsCount,
    attentionAlerts,
    attentionCount,
    alertsReady,
    totalBadge,
    sortedAlerts,
    criticalAlerts,
    warningAlerts,
    infoAlerts,
    hasCritical,
    displayedAlerts,
    plantNameById,
    markAllRead,
    deleteNotification,
    snoozeAlert,
    unsnoozeAlert,
    acknowledgeAlert,
    resolveAlert,
    acknowledgeAll,
    resolveAll,
    isMobile,
    sidebarCollapsed,
    selectedPlantId,
    setSelectedPlantId,
    isRinging,
    setIsRinging,
    navigate,
  };
}
