import { Card } from '@/components/ui/card';
import { Bell, Activity } from 'lucide-react';
import { Lamp } from '@/components/ui/Lamp';
import { cn } from '@/lib/utils';

interface KpiCardsProps {
  activeView: 'active' | 'logs';
  tierFilter: string;
  setActiveView: (view: 'active' | 'logs') => void;
  setTierFilter: (tier: 'all' | 'critical' | 'warning' | 'info') => void;
  plantAlertsLength: number;
  criticalCount: number;
  warningCount: number;
  notifsLength: number;
  unreadLogsCount: number;
}

export function KpiCards({
  activeView, tierFilter, setActiveView, setTierFilter,
  plantAlertsLength, criticalCount, warningCount, notifsLength, unreadLogsCount,
}: KpiCardsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card
        onClick={() => { setActiveView('active'); setTierFilter('all'); }}
        className={cn(
          'p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs',
          activeView === 'active' && tierFilter === 'all'
            ? 'border-primary ring-1 ring-primary/30 bg-primary/5'
            : 'border-border/80 bg-card',
        )}
      >
        <div className="flex items-center justify-between text-muted-foreground mb-1.5">
          <span className="text-2xs font-bold uppercase tracking-wider font-mono-num">Active Alerts</span>
          <Bell className="h-4 w-4 text-primary" />
        </div>
        <div className="text-2xl font-bold font-mono-num text-foreground tracking-tight">
          {plantAlertsLength}
        </div>
        <p className="text-3xs text-muted-foreground mt-1">Live telemetry conditions</p>
      </Card>

      <Card
        onClick={() => { setActiveView('active'); setTierFilter('critical'); }}
        className={cn(
          'p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs',
          activeView === 'active' && tierFilter === 'critical'
            ? 'border-danger ring-1 ring-danger/30 bg-danger/5'
            : 'border-border/80 bg-card',
        )}
      >
        <div className="flex items-center justify-between text-muted-foreground mb-1.5">
          <span className="text-2xs font-bold uppercase tracking-wider font-mono-num text-danger">Critical</span>
          <Lamp tone="danger" pulse size={8} />
        </div>
        <div className="text-2xl font-bold font-mono-num text-danger tracking-tight">
          {criticalCount}
        </div>
        <p className="text-3xs text-muted-foreground mt-1">Immediate action required</p>
      </Card>

      <Card
        onClick={() => { setActiveView('active'); setTierFilter('warning'); }}
        className={cn(
          'p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs',
          activeView === 'active' && tierFilter === 'warning'
            ? 'border-warn ring-1 ring-warn/30 bg-warn/5'
            : 'border-border/80 bg-card',
        )}
      >
        <div className="flex items-center justify-between text-muted-foreground mb-1.5">
          <span className="text-2xs font-bold uppercase tracking-wider font-mono-num text-amber-500">Warning</span>
          <Lamp tone="warn" size={8} />
        </div>
        <div className="text-2xl font-bold font-mono-num text-amber-500 tracking-tight">
          {warningCount}
        </div>
        <p className="text-3xs text-muted-foreground mt-1">Elevated telemetry drift</p>
      </Card>

      <Card
        onClick={() => { setActiveView('logs'); setTierFilter('all'); }}
        className={cn(
          'p-3.5 rounded-xl border transition-all cursor-pointer hover:shadow-xs',
          activeView === 'logs'
            ? 'border-accent ring-1 ring-accent/30 bg-accent/5'
            : 'border-border/80 bg-card',
        )}
      >
        <div className="flex items-center justify-between text-muted-foreground mb-1.5">
          <span className="text-2xs font-bold uppercase tracking-wider font-mono-num">System Log</span>
          <Activity className="h-4 w-4 text-accent" />
        </div>
        <div className="text-2xl font-bold font-mono-num text-foreground tracking-tight">
          {notifsLength}
          {unreadLogsCount > 0 && (
            <span className="text-xs font-semibold text-accent ml-2 font-sans">
              ({unreadLogsCount} unread)
            </span>
          )}
        </div>
        <p className="text-3xs text-muted-foreground mt-1">Audit & workflow records</p>
      </Card>
    </div>
  );
}
