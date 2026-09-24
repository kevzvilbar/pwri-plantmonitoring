import React, { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import { useAlerts } from './hooks/useAlerts';
import { KpiCards } from './components/KpiCards';
import { ControlConsole } from './components/ControlConsole';
import { ActiveAlertsList } from './components/ActiveAlertsList';
import { SystemLogsList } from './components/SystemLogsList';
import { ResolveNoteDialog } from './components/ResolveNoteDialog';
import { ConfirmBulkDialog } from './components/ConfirmBulkDialog';
import { useAlertActorNames } from './hooks/useAlertActorNames';
import { alertStatusLine } from './lib/alertStatusLine';
import { useAuth } from '@/hooks/useAuth';
import { NoPlantsAssigned } from '@/components/NoPlantsAssigned';
import { MAX_SNOOZE_MS } from './hooks/useAlertEvents';

export default function Alerts() {
  const { user } = useAuth();
  const actorNames = useAlertActorNames();
  const {
    navigate,
    activeView, setActiveView,
    tierFilter, setTierFilter,
    statusFilter, setStatusFilter,
    plantFilter, setPlantFilter,
    searchQuery, setSearchQuery,
    plantAlerts, visiblePlants, needsAssignment, plantNameById,
    filteredPlantAlerts, filteredLogs,
    criticalCount, warningCount, infoCount, unreadLogsCount,
    plantAlertsLength, notifsLength,
    markAllRead, deleteNotification,
    ackAlert, ackAll, resolveWithNote, snoozeMany, snoozableIds,
  } = useAlerts();

  // ── P3-5: bulk actions confirm, and resolve requires a note (D2) ──────────
  const [bulkAction, setBulkAction] = useState<'acknowledge' | 'snooze' | 'resolve' | null>(null);
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);

  const openBulk = (action: 'acknowledge' | 'snooze' | 'resolve') => setBulkAction(action);

  const runBulk = () => {
    if (bulkAction === 'acknowledge') {
      ackAll();
      toast.success('All alerts acknowledged');
    } else if (bulkAction === 'snooze') {
      // P3-5: critical alerts are never bulk-snoozed — snoozableIds excludes them.
      snoozeMany(snoozableIds, 60 * 60 * 1000);
      toast.success(
        snoozableIds.length === plantAlerts.length
          ? 'All alerts snoozed for 1 hour'
          : `${snoozableIds.length} alert${snoozableIds.length === 1 ? '' : 's'} snoozed for 1 hour (critical alarms stay on)`,
      );
    }
    // 'resolve' is handled through its own note dialog, never here.
    setBulkAction(null);
  };

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title="Alerts"
        subtitle="Unified operations alarm triage, telemetry anomaly surveillance, and system event log."
      />

      {needsAssignment && <NoPlantsAssigned />}

      <KpiCards
        activeView={activeView} tierFilter={tierFilter} setActiveView={setActiveView} setTierFilter={setTierFilter}
        plantAlertsLength={plantAlertsLength} criticalCount={criticalCount} warningCount={warningCount}
        notifsLength={notifsLength} unreadLogsCount={unreadLogsCount}
      />

      <ControlConsole
        activeView={activeView} setActiveView={setActiveView} tierFilter={tierFilter} setTierFilter={setTierFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        plantFilter={plantFilter} setPlantFilter={setPlantFilter} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        plantAlertsLength={plantAlertsLength} criticalCount={criticalCount} warningCount={warningCount} infoCount={infoCount}
        unreadLogsCount={unreadLogsCount} notifsLength={notifsLength} visiblePlants={visiblePlants}
        snoozableCount={snoozableIds.length}
        onSnoozeAll={() => openBulk('snooze')}
        onAcknowledgeAll={() => openBulk('acknowledge')}
        onResolveAll={() => openBulk('resolve')}
        onMarkAllRead={markAllRead}
      />

      <div className="space-y-2.5">
        {activeView === 'active' && (
          <ActiveAlertsList
            filteredPlantAlerts={filteredPlantAlerts}
            plantNameById={plantNameById}
            actorNames={actorNames}
            onNavigate={(path) => navigate(path)}
            onSnooze={(id, ms) => {
              snoozeMany([id], ms);
              toast.success(`Alert snoozed for ${ms === 3600000 ? '1 hour' : '24 hours'}`);
            }}
            onAcknowledge={(id) => {
              ackAlert(id);
              toast.success('Alert acknowledged');
            }}
            onResolve={(id) => setResolveTarget(id)}
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

      {/* ── P3-5: confirm + note dialogs ─────────────────────────────────── */}
      <ConfirmBulkDialog
        open={bulkAction === 'acknowledge' || bulkAction === 'snooze'}
        action={bulkAction === 'snooze' ? 'snooze' : 'acknowledge'}
        count={bulkAction === 'snooze' ? snoozableIds.length : plantAlertsLength}
        snoozeLabel="1 hour"
        criticalExcluded={
          bulkAction === 'snooze' && snoozableIds.length !== plantAlertsLength
        }
        onOpenChange={(open) => { if (!open) setBulkAction(null); }}
        onConfirm={runBulk}
      />
      <ResolveNoteDialog
        open={resolveTarget != null || bulkAction === 'resolve'}
        count={resolveTarget ? 1 : plantAlertsLength}
        onOpenChange={(open) => {
          if (!open) { setResolveTarget(null); setBulkAction(null); }
        }}
        onConfirm={(note) => {
          if (resolveTarget) {
            resolveWithNote(resolveTarget, note);
            toast.success('Alert resolved');
          } else {
            plantAlerts.forEach((a) => resolveWithNote(a.id, note));
            toast.success(`All ${plantAlertsLength} alerts resolved`);
          }
          setResolveTarget(null);
          setBulkAction(null);
        }}
      />
    </div>
  );
}
