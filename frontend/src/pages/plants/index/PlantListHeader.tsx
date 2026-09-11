import { useMemo } from 'react';
import { fmtNum } from '@/lib/calculations';
import { Building2, Droplets } from 'lucide-react';

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
    <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-xs">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Title & Telemetry badge */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0 shadow-2xs">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                Water Production Facilities
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-3xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                Live Telemetry
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-medium pl-0.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-muted/40 border border-border/40 text-foreground font-semibold">
              <Droplets className="h-3 w-3 text-sky-500" />
              <span>{facilityCount} {facilityCount === 1 ? 'Facility' : 'Facilities'} Monitored</span>
            </span>
            <span className="opacity-40">&bull;</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <span>Synced</span>
              <strong className="text-foreground font-semibold font-mono">{secondsAgo}s</strong>
              <span>ago</span>
            </span>
          </div>
        </div>

        {/* Cohesive KPI Telemetry Ribbon */}
        <div className="flex items-center gap-4 sm:gap-6 divide-x divide-border/60 border-t lg:border-t-0 lg:border-l border-border/60 pt-3 lg:pt-0 lg:pl-6">
          <div className="text-left sm:text-right">
            <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">Total Capacity</div>
            <div className="text-lg sm:text-xl font-black text-foreground font-mono leading-tight mt-0.5">
              {totalCapacity > 0 ? fmtNum(totalCapacity) : '—'}{' '}
              <span className="text-2xs font-bold text-primary font-sans">MLD</span>
            </div>
            {totalCapacity > 0 && (
              <div className="text-3xs text-muted-foreground font-mono font-medium">
                {fmtNum(totalCapacity * 1000)} m³/d
              </div>
            )}
          </div>

          <div className="pl-4 sm:pl-6 text-left sm:text-right">
            <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">RO Utilization</div>
            <div
              className="text-lg sm:text-xl font-black font-mono leading-tight mt-0.5"
              style={{
                color: roUtilPct >= 70
                  ? 'hsl(var(--primary))'
                  : roUtilPct >= 40
                    ? 'hsl(var(--info))'
                    : 'hsl(var(--danger))',
              }}
            >
              {roUtilPct}%
            </div>
            <div className="text-3xs text-muted-foreground font-medium mt-0.5">
              {roUtilPct >= 70 ? 'Optimal' : roUtilPct >= 40 ? 'Moderate' : 'Offline/Low'}
            </div>
          </div>

          <div className="pl-4 sm:pl-6 text-left sm:text-right">
            <div className="text-3xs uppercase font-bold tracking-wider text-muted-foreground">Fleet Health</div>
            <div
              className="text-lg sm:text-xl font-black font-mono leading-tight mt-0.5"
              style={{
                color: avgHealth >= 75
                  ? 'hsl(var(--primary))'
                  : avgHealth >= 50
                    ? 'hsl(var(--warning, var(--info)))'
                    : 'hsl(var(--danger))',
              }}
            >
              {avgHealth}%
            </div>
            <div className="text-3xs text-muted-foreground font-medium mt-0.5">
              {avgHealth >= 75 ? 'Nominal' : avgHealth >= 50 ? 'Attention' : 'Action Req'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

