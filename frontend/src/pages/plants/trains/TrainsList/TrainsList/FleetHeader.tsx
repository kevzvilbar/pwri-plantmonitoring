import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { Search, Plus, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FleetHeaderProps {
  isManager: boolean;
  isAdmin: boolean;
  onAddTrain: () => void;
  onImportCsv: () => void;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  statusFilter: 'all' | 'Running' | 'Maintenance' | 'Offline';
  onStatusFilterChange: (v: 'all' | 'Running' | 'Maintenance' | 'Offline') => void;
  totalTrains: number;
  runningCount: number;
  maintenanceCount: number;
  offlineCount: number;
}

export function FleetHeader({
  isManager, isAdmin, onAddTrain, onImportCsv,
  searchTerm, onSearchChange, statusFilter, onStatusFilterChange,
  totalTrains, runningCount, maintenanceCount, offlineCount,
}: FleetHeaderProps) {
  return (
    <div className="p-4 rounded-2xl border border-border/80 bg-card shadow-2xs space-y-3">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <ROTrainIcon className="h-5 w-5 text-muted-foreground shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-foreground tracking-tight">RO Trains &amp; Pre-treatment Fleet</h2>
              <span className="px-2 py-0.5 rounded-full text-3xs font-bold bg-primary-soft text-primary border border-primary/30">
                {runningCount}/{totalTrains} Online
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Media Filtration ➔ Booster Pumps ➔ Pre-filter Housings ➔ High Pressure Pumps ➔ RO Permeate
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {isManager && (
            <Button size="sm" className="h-8 px-3 text-xs gap-1.5 font-bold shadow-2xs" onClick={onAddTrain}>
              <Plus className="h-3.5 w-3.5" /><span>Add Train</span>
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs gap-1" onClick={onImportCsv} title="Import CSV">
              <Upload className="h-3.5 w-3.5" /><span className="hidden sm:inline">Import</span>
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col md:flex-row items-center justify-between gap-2.5 pt-2.5 border-t border-border/50">
        <div className="relative w-full md:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={searchTerm} onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search train # or name…" className="h-8 pl-8 text-xs bg-background" />
        </div>
        <div className="flex items-center gap-1 w-full md:w-auto overflow-x-auto pb-0.5">
          {(['all', 'Running', 'Maintenance', 'Offline'] as const).map((s) => (
            <button key={s} onClick={() => onStatusFilterChange(s)} className={[
              'h-7 px-2.5 text-2xs font-medium rounded-md transition-all border shrink-0 flex items-center gap-1.5',
              statusFilter === s ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                : 'bg-muted/40 text-muted-foreground border-border hover:text-foreground hover:bg-muted',
            ].join(' ')}>
              {s === 'all' && <span>All ({totalTrains})</span>}
              {s === 'Running' && <><span className="h-1.5 w-1.5 rounded-full bg-accent" /><span>Online ({runningCount})</span></>}
              {s === 'Maintenance' && <><span className="h-1.5 w-1.5 rounded-full bg-warn" /><span>Maintenance ({maintenanceCount})</span></>}
              {s === 'Offline' && <><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" /><span>Offline ({offlineCount})</span></>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
