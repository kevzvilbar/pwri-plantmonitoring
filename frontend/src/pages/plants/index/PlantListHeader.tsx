import { useMemo } from 'react';
import { fmtNum } from '@/lib/calculations';

export function PlantListHeader({
  list, summaryCounts, secondsAgo, totalCapacity, roUtilPct, avgHealth,
}: {
  list: any[];
  summaryCounts: any;
  secondsAgo: number;
  totalCapacity: number;
  roUtilPct: number;
  avgHealth: number;
}) {
  const facilityCount = list?.length ?? 0;

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-foreground">Water Production Facilities</h1>
            <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-primary-soft text-primary border border-primary/20">
              Live Overview
            </span>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-2 font-medium">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
            </span>
            <span>{facilityCount} {facilityCount === 1 ? 'Facility' : 'Facilities'} Monitored</span>
            <span className="opacity-40">&bull;</span>
            <span>Synced <strong className="text-foreground font-semibold font-mono">{secondsAgo}s</strong> ago</span>
          </p>
        </div>

        <div className="flex items-center gap-4 sm:gap-6 border-t sm:border-t-0 sm:border-l border-border/60 pt-3 sm:pt-0 sm:pl-6">
          <div className="text-left sm:text-right">
            <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">Total Capacity</div>
            <div className="text-lg sm:text-xl font-black text-foreground font-mono leading-tight">
              {totalCapacity > 0 ? fmtNum(totalCapacity) : '—'}{' '}
              <span className="text-2xs font-bold text-primary font-sans">MLD</span>
            </div>
            {totalCapacity > 0 && (
              <div className="text-3xs text-muted-foreground font-mono font-medium">
                {fmtNum(totalCapacity * 1000)} m³/d
              </div>
            )}
          </div>
          <div className="h-8 w-px bg-border/60" />
          <div className="text-left sm:text-right">
            <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">RO Utilization</div>
            <div className="text-lg sm:text-xl font-black text-info font-mono">
              {roUtilPct}%
            </div>
          </div>
          <div className="h-8 w-px bg-border/60" />
          <div className="text-left sm:text-right">
            <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">Avg Health</div>
            <div className="text-lg sm:text-xl font-black text-accent font-mono">
              {avgHealth}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
