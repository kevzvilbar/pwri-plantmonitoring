import { useState, useEffect, useMemo } from 'react';
import { Lamp } from '@/components/ui/Lamp';
import { TrendBadge } from './StatCard';
import { fmtNum } from '@/lib/calculations';
import { usePlants } from '@/hooks/usePlants';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  History, LayoutGrid, ListCollapse, ExternalLink, ShieldAlert, Building2,
  Droplets, Gauge, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { DashboardViewMode } from './types';

interface PlantPulseHeroProps {
  plantIds: string[];
  selectedPlantName: string;
  openIncidentCount?: number;
  secondsAgo?: number;
  production: number | null;
  dProduction: number | null;
  rawWaterVol?: number | null;
  recovery?: number | null;
  specificPower?: number | null;
  chartData?: any[];
  viewMode: DashboardViewMode;
  onViewModeChange: (mode: DashboardViewMode) => void;
  onOpenDowntime: () => void;
  onSelectPlant?: (plantId: string) => void;
  onViewIncidents?: () => void;
}

export function PlantPulseHero({
  plantIds,
  selectedPlantName,
  openIncidentCount = 0,
  secondsAgo = 2,
  production,
  dProduction,
  rawWaterVol,
  recovery,
  specificPower,
  chartData,
  viewMode,
  onViewModeChange,
  onOpenDowntime,
  onSelectPlant,
  onViewIncidents,
}: PlantPulseHeroProps) {
  const { data: plants } = usePlants();
  const [timeStr, setTimeStr] = useState('');

  // Live PHT Clock updated every 10 seconds
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(format(now, 'hh:mm a') + ' PHT');
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  // Filtered plant list
  const activePlants = useMemo(
    () => (plants ?? []).filter((p) => !plantIds.length || plantIds.includes(p.id)),
    [plants, plantIds],
  );

  // Query latest readings to compute live fleet online / stale / offline counts
  const { data: wellLastDt } = useQuery({
    queryKey: ['plant-pulse-hero-wells', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return {} as Record<string, string>;
      const { data } = await supabase
        .from('well_readings')
        .select('plant_id, reading_datetime')
        .in('plant_id', plantIds)
        .order('reading_datetime', { ascending: false })
        .limit(300);
      const map: Record<string, string> = {};
      (data ?? []).forEach((r) => {
        if (!map[r.plant_id]) map[r.plant_id] = r.reading_datetime;
      });
      return map;
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });

  const fleetCounts = useMemo(() => {
    let online = 0;
    let stale = 0;
    let offline = 0;

    activePlants.forEach((p) => {
      const dt = wellLastDt?.[p.id];
      if (!dt) {
        offline++;
      } else {
        const hoursAgo = (Date.now() - new Date(dt).getTime()) / 3_600_000;
        if (hoursAgo < 2) online++;
        else if (hoursAgo < 8) stale++;
        else offline++;
      }
    });

    return { online, stale, offline };
  }, [activePlants, wellLastDt]);

  return (
    <div className="rounded-[20px] sm:rounded-[24px] p-1 bg-gradient-to-b from-primary/25 via-primary/10 to-transparent border border-primary/30 shadow-xl shadow-black/20">
      <div
        style={{ background: 'var(--gradient-stat)' }}
        className="hero-arrival rounded-[16px] sm:rounded-[20px] text-white p-4 sm:p-5 relative overflow-hidden shadow-inner border border-white/10"
      >
        {/* Decorative ambient blurred glow orbs */}
        <div className="pointer-events-none absolute -top-20 -left-20 w-64 h-64 bg-primary/20 rounded-full blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 -right-20 w-64 h-64 bg-accent/15 rounded-full blur-3xl" aria-hidden />

        {/* ── Top Bar: Title, Facility Badge, Incident Flag, Downtime & View Toggle ── */}
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3.5 border-b border-white/10">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <span>PWRI Operations Telemetry</span>
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-black/40 text-white/90 border border-primary/40 flex items-center gap-1.5 font-mono shadow-xs">
              <Building2 className="h-3 w-3 text-primary-foreground" />
              {selectedPlantName}
            </span>
            {openIncidentCount > 0 && (
              <button
                type="button"
                onClick={onViewIncidents}
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-950/80 text-rose-300 border border-rose-500/40 text-2xs font-semibold hover:bg-rose-900/80 transition-colors shadow-xs"
                title={`${openIncidentCount} open incident${openIncidentCount > 1 ? 's' : ''} — click to view`}
              >
                <ShieldAlert className="h-3 w-3 text-rose-400" aria-hidden />
                <span>{openIncidentCount} open incident{openIncidentCount > 1 ? 's' : ''}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenDowntime}
              className="h-8 text-xs gap-1.5 font-medium bg-white/10 hover:bg-white/20 border-white/20 text-white shadow-xs rounded-lg"
            >
              <History className="h-3.5 w-3.5 text-white/80" />
              <span className="hidden sm:inline">Downtime Log</span>
            </Button>

            {/* View Mode Toggle */}
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && onViewModeChange(v as DashboardViewMode)}
              className="h-8 bg-black/50 border border-white/15 rounded-lg p-0.5"
              data-testid="dashboard-view-mode"
            >
              <ToggleGroupItem
                value="inline"
                className="h-7 px-2.5 text-xs gap-1 text-slate-300 hover:text-white data-[state=on]:bg-primary/30 data-[state=on]:text-white data-[state=on]:border data-[state=on]:border-primary/50 data-[state=on]:shadow-xs rounded-md font-medium transition-colors"
                title="Inline — all trend graphs visible directly on the dashboard"
                aria-label="Inline view"
              >
                <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden md:inline">Inline</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="sections"
                className="h-7 px-2.5 text-xs gap-1 text-slate-300 hover:text-white data-[state=on]:bg-primary/30 data-[state=on]:text-white data-[state=on]:border data-[state=on]:border-primary/50 data-[state=on]:shadow-xs rounded-md font-medium transition-colors"
                title="Sections — click any KPI card to fold/unfold its trend chart inline"
                aria-label="Sections view"
              >
                <ListCollapse className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden md:inline">Sections</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="popup"
                className="h-7 px-2.5 text-xs gap-1 text-slate-300 hover:text-white data-[state=on]:bg-primary/30 data-[state=on]:text-white data-[state=on]:border data-[state=on]:border-primary/50 data-[state=on]:shadow-xs rounded-md font-medium transition-colors"
                title="Dialog — click a KPI card to open its trend chart in a dialog"
                aria-label="Dialog view"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden md:inline">Dialog</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {/* ── Main Hero Row: Headline Metric · Live Pulse Status · 7-Day Sparkline · Fleet Lamps ── */}
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-4 items-center pt-3.5">
          {/* Left: Headline Metric & Status */}
          <div className="md:col-span-4 space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="readout-num text-4xl sm:text-5xl font-bold leading-none text-white tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]">
                {fmtNum(production)}
              </span>
              <span className="text-base font-sans font-normal text-white/70">m³</span>
            </div>
            
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-3xs uppercase tracking-wider font-semibold text-white/80">
                Today's Production
              </span>
              {dProduction !== null && <TrendBadge delta={dProduction} />}
            </div>

            <div className="text-2xs text-slate-300/90 flex items-center gap-1.5 pt-0.5 font-mono tabular-nums">
              <Lamp tone="live" pulse size={6} />
              <span className="text-emerald-400 font-semibold">Live Telemetry</span>
              <span className="text-white/30">&bull;</span>
              <span>Updated {secondsAgo}s ago</span>
              <span className="text-white/30">&bull;</span>
              <span>24h Period ({timeStr || '—'})</span>
            </div>
          </div>

          {/* Middle: Live Plant Efficiency Trio */}
          <div className="md:col-span-5 flex items-center justify-between bg-black/40 border border-white/15 rounded-xl p-2.5 sm:px-4 backdrop-blur-md shadow-inner divide-x divide-white/10">
            {/* Raw Inflow */}
            <div className="flex-1 px-2.5 first:pl-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Droplets className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="text-3xs font-mono font-semibold uppercase tracking-wider text-white/75">
                  Raw Inflow
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-base sm:text-lg font-bold text-white tracking-tight">
                  {rawWaterVol != null ? fmtNum(rawWaterVol) : '—'}
                </span>
                <span className="text-3xs font-mono text-white/60">m³</span>
              </div>
            </div>

            {/* RO Recovery */}
            <div className="flex-1 px-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Gauge className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-3xs font-mono font-semibold uppercase tracking-wider text-white/75">
                  Recovery
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-base sm:text-lg font-bold text-emerald-400 tracking-tight">
                  {recovery != null ? `${recovery.toFixed(1)}%` : '—'}
                </span>
              </div>
            </div>

            {/* Specific Energy */}
            <div className="flex-1 px-2.5 last:pr-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-3xs font-mono font-semibold uppercase tracking-wider text-white/75">
                  Spec. Energy
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-base sm:text-lg font-bold text-white tracking-tight">
                  {specificPower != null ? specificPower.toFixed(2) : '—'}
                </span>
                <span className="text-3xs font-mono text-white/60">kWh/m³</span>
              </div>
            </div>
          </div>

          {/* Right: Fleet Health Status Lamps */}
          <div className="md:col-span-3 flex md:flex-col justify-start md:justify-center md:items-end gap-2 text-2xs font-mono">
            <div className="flex items-center gap-2 bg-black/40 border border-white/15 rounded-xl px-3.5 py-2.5 backdrop-blur-md shadow-inner">
              <span className="flex items-center gap-1.5">
                <Lamp tone="good" size={6} />
                <span className="font-semibold text-white">{fleetCounts.online}</span>
                <span className="text-slate-300">online</span>
              </span>
              <span className="text-white/20">|</span>
              <span className="flex items-center gap-1.5">
                <Lamp tone="warn" size={6} />
                <span className="font-semibold text-white">{fleetCounts.stale}</span>
                <span className="text-slate-300">stale</span>
              </span>
              {fleetCounts.offline > 0 && (
                <>
                  <span className="text-white/20">|</span>
                  <span className="flex items-center gap-1.5">
                    <Lamp tone="muted" size={6} />
                    <span className="font-semibold text-white">{fleetCounts.offline}</span>
                    <span className="text-slate-300">off</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
