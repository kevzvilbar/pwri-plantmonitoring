import React from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { useAlerts } from './Alerts/useAlerts';
import { KpiCards } from './Alerts/KpiCards';
import { ControlConsole } from './Alerts/ControlConsole';
import { ActiveAlertsList } from './Alerts/ActiveAlertsList';
import { SystemLogsList } from './Alerts/SystemLogsList';

export default function Alerts() {
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
    removeAlerts, clearAlerts, snoozeAlert,
  } = useAlerts();

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
        onClearAll={() => {
          clearAlerts();
          toast.success('All active alerts dismissed');
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
            onDismiss={(id) => {
              removeAlerts([id]);
              toast.success('Alert dismissed');
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
