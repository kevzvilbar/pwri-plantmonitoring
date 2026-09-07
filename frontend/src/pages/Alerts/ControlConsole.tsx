import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Bell, BellOff, CheckCheck, FileText, Search, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ControlConsoleProps {
  activeView: 'active' | 'logs';
  setActiveView: (view: 'active' | 'logs') => void;
  tierFilter: string;
  setTierFilter: (tier: 'all' | 'critical' | 'warning' | 'info') => void;
  plantFilter: string;
  setPlantFilter: (filter: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  plantAlertsLength: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  unreadLogsCount: number;
  notifsLength: number;
  visiblePlants: Array<{ id: string; name: string }>;
  onSnoozeAll: () => void;
  onClearAll: () => void;
  onMarkAllRead: () => void;
}

export function ControlConsole({
  activeView, setActiveView, tierFilter, setTierFilter,
  plantFilter, setPlantFilter, searchQuery, setSearchQuery,
  plantAlertsLength, criticalCount, warningCount, infoCount, unreadLogsCount, notifsLength,
  visiblePlants, onSnoozeAll, onClearAll, onMarkAllRead,
}: ControlConsoleProps) {
  return (
    <div className="p-3.5 rounded-2xl border-border/80 space-y-3 shadow-xs">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center p-1 bg-muted/60 rounded-xl border border-border/70">
          <button
            type="button"
            onClick={() => setActiveView('active')}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
              activeView === 'active'
                ? 'bg-card text-foreground shadow-2xs border border-border/60'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Bell className="h-3.5 w-3.5 text-primary" />
            <span>Active Alarms ({plantAlertsLength})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveView('logs')}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
              activeView === 'logs'
                ? 'bg-card text-foreground shadow-2xs border border-border/60'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FileText className="h-3.5 w-3.5 text-accent" />
            <span>System Log ({notifsLength})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeView === 'active' && plantAlertsLength > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={onSnoozeAll} className="h-8 gap-1.5 text-xs border-border/80">
                <BellOff className="h-3.5 w-3.5 text-warn" />
                <span>Snooze all (1h)</span>
              </Button>
              <Button size="sm" variant="outline" onClick={onClearAll} className="h-8 gap-1.5 text-xs text-danger hover:bg-danger-soft border-danger/30 hover:border-danger/60">
                <Trash2 className="h-3.5 w-3.5" />
                <span>Dismiss all</span>
              </Button>
            </>
          )}

          {activeView === 'logs' && unreadLogsCount > 0 && (
            <Button size="sm" variant="outline" onClick={onMarkAllRead} className="h-8 gap-1.5 text-xs text-accent border-accent/40 hover:bg-accent-soft">
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Mark all read</span>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1 border-t border-border/50">
        <div className="sm:col-span-4 flex items-center gap-1 overflow-x-auto p-0.5">
          <button type="button" onClick={() => setTierFilter('all')} className={cn('px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all whitespace-nowrap', tierFilter === 'all' ? 'bg-primary text-primary-foreground shadow-2xs' : 'text-muted-foreground hover:bg-muted')}>
            All
          </button>
          <button type="button" onClick={() => setTierFilter('critical')} className={cn('px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all flex items-center gap-1 whitespace-nowrap', tierFilter === 'critical' ? 'bg-danger text-white shadow-2xs' : 'text-danger hover:bg-danger-soft')}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>Critical ({criticalCount})</span>
          </button>
          <button type="button" onClick={() => setTierFilter('warning')} className={cn('px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all flex items-center gap-1 whitespace-nowrap', tierFilter === 'warning' ? 'bg-warn text-warn-foreground shadow-2xs' : 'text-amber-500 hover:bg-warn-soft')}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>Warning ({warningCount})</span>
          </button>
          <button type="button" onClick={() => setTierFilter('info')} className={cn('px-2.5 py-1 rounded-lg text-2xs font-semibold transition-all whitespace-nowrap', tierFilter === 'info' ? 'bg-info text-white shadow-2xs' : 'text-info hover:bg-info-soft')}>
            Info ({infoCount})
          </button>
        </div>

        {activeView === 'active' && (
          <div className="sm:col-span-3">
            <Select value={plantFilter} onValueChange={setPlantFilter}>
              <SelectTrigger className="h-8 text-xs bg-muted/30 border-border/70">
                <SelectValue placeholder="All Plants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plants</SelectItem>
                {visiblePlants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className={cn(activeView === 'active' ? 'sm:col-span-5' : 'sm:col-span-8', 'relative')}>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input type="text" placeholder="Search by title, equipment, source, plant…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-8 pl-8 text-xs bg-muted/30 border-border/70" />
        </div>
      </div>
    </div>
  );
}
