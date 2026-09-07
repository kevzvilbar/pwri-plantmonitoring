import { Activity, Bell, BellOff, CheckCircle2, ChevronRight, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useTopBarState } from './useTopBarState';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Signal } from '@/components/ui/Signal';
import { getAlertIcon, sevTier } from './helpers';

export function AlertPanel() {
  const {
    panelOpen,
    setPanelOpen,
    activeTab,
    setActiveTab,
    tierFilter,
    setTierFilter,
    notifs,
    unreadCount,
    plantAlerts,
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
    removeAlerts,
    clearAlerts,
    navigate,
  } = useTopBarState();

  return (
    <div className="flex flex-col h-full max-h-[82vh] overflow-hidden bg-card text-card-foreground">
      <div className="p-3 bg-muted/40 border-b border-border/60 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Bell className="h-3.5 w-3.5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-foreground tracking-tight">Plant Alerts &amp; Activity</h4>
            </div>
            {totalBadge > 0 && (
              <span className={cn(
                'text-3xs font-mono-num font-bold px-1.5 py-0.5 rounded-full border',
                hasCritical ? 'bg-danger/15 text-danger border-danger/30' : 'bg-warn/15 text-amber-500 border-warn/30'
              )}>
                {totalBadge}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {activeTab === 'active' && sortedAlerts.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    sortedAlerts.forEach((a) => snoozeAlert(a.id, 60 * 60 * 1000));
                    toast.success('All alerts snoozed for 1 hour');
                  }}
                  className="flex items-center gap-1 text-2xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-medium min-h-[32px] sm:min-h-[28px]"
                  title="Snooze all active alerts for 1 hour"
                >
                  <BellOff className="h-3 w-3 text-warn" />
                  <span>Snooze all</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearAlerts();
                    toast.success('All alerts dismissed');
                  }}
                  className="text-2xs px-2 py-1 rounded-md text-muted-foreground hover:text-danger hover:bg-danger-soft transition-colors font-medium min-h-[32px] sm:min-h-[28px]"
                  title="Dismiss all alerts"
                >
                  Dismiss all
                </button>
              </>
            )}
            {activeTab === 'logs' && unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-2xs px-2 py-1 rounded-md text-accent hover:bg-accent-soft transition-colors font-medium min-h-[32px] sm:min-h-[28px]"
                title="Mark all notifications as read"
              >
                Mark read
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-background/80 border border-border/60">
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={cn(
              'flex-1 py-1 px-2.5 text-2xs font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1.5',
              activeTab === 'active'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>Active Alarms</span>
            <span className={cn('text-3xs font-mono-num px-1 rounded-full', activeTab === 'active' ? 'bg-primary-foreground/20 text-white' : 'bg-muted text-muted-foreground')}>
              {plantAlerts.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={cn(
              'flex-1 py-1 px-2.5 text-2xs font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1.5',
              activeTab === 'logs'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>System Log</span>
            <span className={cn('text-3xs font-mono-num px-1 rounded-full', activeTab === 'logs' ? 'bg-primary-foreground/20 text-white' : 'bg-muted text-muted-foreground')}>
              {notifs.length}
            </span>
          </button>
        </div>

        {activeTab === 'active' && plantAlerts.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto pt-0.5">
            <button
              type="button"
              onClick={() => setTierFilter('all')}
              className={cn(
                'px-2 py-0.5 text-3xs font-semibold rounded-md transition-all font-mono-num',
                tierFilter === 'all'
                  ? 'bg-muted text-foreground font-bold border border-border/80'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              All ({plantAlerts.length})
            </button>
            {criticalAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setTierFilter('critical')}
                className={cn(
                  'px-2 py-0.5 text-3xs font-semibold rounded-md transition-all flex items-center gap-1 font-mono-num',
                  tierFilter === 'critical'
                    ? 'bg-danger text-white'
                    : 'text-danger hover:bg-danger/10'
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                <span>Crit ({criticalAlerts.length})</span>
              </button>
            )}
            {warningAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setTierFilter('warning')}
                className={cn(
                  'px-2 py-0.5 text-3xs font-semibold rounded-md transition-all flex items-center gap-1 font-mono-num',
                  tierFilter === 'warning'
                    ? 'bg-warn text-warn-foreground'
                    : 'text-amber-500 hover:bg-warn/10'
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                <span>Warn ({warningAlerts.length})</span>
              </button>
            )}
            {infoAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setTierFilter('info')}
                className={cn(
                  'px-2 py-0.5 text-3xs font-semibold rounded-md transition-all font-mono-num',
                  tierFilter === 'info'
                    ? 'bg-info text-white'
                    : 'text-info hover:bg-info/10'
                )}
              >
                <span>Info ({infoAlerts.length})</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-y-auto divide-y divide-border/40 p-2 space-y-1.5 flex-1 min-h-[160px] max-h-[52vh]">
        {activeTab === 'active' && (
          <>
            {displayedAlerts.map((alert) => {
              const Icon = getAlertIcon(alert);
              const tier = sevTier(alert.severity);
              const plantName = plantNameById.get(alert.plantId);

              return (
                <Signal
                  key={alert.id}
                  variant="card"
                  tone={tier}
                  title={alert.title}
                  description={alert.description}
                  icon={Icon}
                  plantName={plantName}
                  source={alert.source}
                  timestamp={alert.timestamp}
                  linkPath={alert.linkPath ?? undefined}
                  onNavigate={(path) => {
                    setPanelOpen(false);
                    navigate(path);
                  }}
                  onSnooze={(ms) => {
                    snoozeAlert(alert.id, ms);
                    toast.success(`Alert snoozed for ${ms === 3600000 ? '1 hour' : '24 hours'}`);
                  }}
                  onDismiss={() => {
                    removeAlerts([alert.id]);
                    toast.success('Alert dismissed');
                  }}
                />
              );
            })}

            {displayedAlerts.length === 0 && (
              <div className="py-10 text-center space-y-2">
                <div className="h-10 w-10 rounded-full bg-accent/15 text-accent flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-foreground">No active alarms</p>
                  <p className="text-2xs text-muted-foreground">All plant systems and sensors operating normally</p>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'logs' && (
          <>
            {notifs.map((n) => {
              const tier = sevTier(n.severity);
              return (
                <Signal
                  key={n.id}
                  variant="card"
                  tone={tier}
                  title={n.title}
                  description={n.message ?? undefined}
                  icon={Activity}
                  timestamp={n.created_at}
                  linkPath={n.link_path ?? undefined}
                  onNavigate={(path) => {
                    setPanelOpen(false);
                    navigate(path);
                  }}
                  onDismiss={() => deleteNotification(n.id)}
                />
              );
            })}

            {notifs.length === 0 && (
              <div className="py-10 text-center space-y-2">
                <div className="h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-foreground">No system logs</p>
                  <p className="text-2xs text-muted-foreground">No historical notifications recorded</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="p-2.5 bg-muted/40 border-t border-border/60 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setPanelOpen(false);
            navigate('/alerts');
          }}
          className="w-full text-xs font-semibold text-primary hover:text-primary/80 py-1.5 px-3 rounded-lg hover:bg-primary/10 transition-colors flex items-center justify-center gap-1.5"
        >
          <span>Open Full Triage Center</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
