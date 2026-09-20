import React from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import { useAlerts } from './hooks/useAlerts';
import { KpiCards } from './components/KpiCards';
import { ControlConsole } from './components/ControlConsole';
import { ActiveAlertsList } from './components/ActiveAlertsList';
import { SystemLogsList } from './components/SystemLogsList';
import { useAuth } from '@/hooks/useAuth';

export default function Alerts() {
  const { user } = useAuth();
  const {
    navigate,
    activeView, setActiveView,
    tierFilter, setTierFilter,
    plantFilter, setPlantFilter,
    searchQuery, setSearchQuery,
    plantAlerts, visiblePlants, plantNameById,
    filteredPlantAlerts, filteredLogs,
    criticalCount, warningCount, infoCount, unreadLogsCount,
    plantAlertsLength, notifsLength,
    markAllRead, deleteNotification,
    snoozeAlert, acknowledgeAlert, resolveAlert, acknowledgeAll, resolveAll,
  } = useAlerts();

  // Get current user id for acknowledge/resolve audit trail
  const userId = user?.id ?? 'unknown';

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title="Alert & Notification Center"
        subtitle="Unified operations alarm triage, telemetry anomaly surveillance, and system event log."
      />

      <KpiCards
        activeView={activeView} tierFilter={tierFilter} setActiveView={setActiveView} setTierFilter={setTierFilter}
        plantAlertsLength={plantAlertsLength} criticalCount={criticalCount} warningCount={warningCount}
        notifsLength={notifsLength} unreadLogsCount={unreadLogsCount}
      />

      <ControlConsole
        activeView={activeView} setActiveView={setActiveView} tierFilter={tierFilter} setTierFilter={setTierFilter}
        plantFilter={plantFilter} setPlantFilter={setPlantFilter} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        plantAlertsLength={plantAlertsLength} criticalCount={criticalCount} warningCount={warningCount} infoCount={infoCount}
        unreadLogsCount={unreadLogsCount} notifsLength={notifsLength} visiblePlants={visiblePlants}
        onSnoozeAll={() => {
          plantAlerts.forEach((a) => snoozeAlert(a.id, 60 * 60 * 1000));
          toast.success('All active alerts snoozed for 1 hour');
        }}
        onAcknowledgeAll={() => {
          acknowledgeAll(userId);
          toast.success('All alerts acknowledged');
        }}
        onResolveAll={() => {
          resolveAll(userId);
          toast.success('All alerts resolved');
        }}
        onMarkAllRead={markAllRead}
      />

      <div className="space-y-2.5">
        {activeView === 'active' && (
          <ActiveAlertsList
            filteredPlantAlerts={filteredPlantAlerts}
            plantNameById={plantNameById}
            onNavigate={(path) => navigate(path)}
            onSnooze={(id, ms) => {
              snoozeAlert(id, ms);
              toast.success(`Alert snoozed for ${ms === 3600000 ? '1 hour' : '24 hours'}`);
            }}
            onAcknowledge={(id) => {
              acknowledgeAlert(id, userId);
              toast.success('Alert acknowledged');
            }}
            onResolve={(id) => {
              resolveAlert(id, userId);
              toast.success('Alert resolved');
            }}
          />
        )}

        {activeView === 'logs' && (
          <SystemLogsList
            filteredLogs={filteredLogs}
            onNavigate={(path) => navigate(path)}
            onDelete={deleteNotification}
          />
        )}
      </div>
    </div>
  );
}
