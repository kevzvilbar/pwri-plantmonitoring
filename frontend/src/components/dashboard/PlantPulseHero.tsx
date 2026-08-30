import { useState, useEffect, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Lamp } from '@/components/ui/Lamp';
import { TrendBadge } from './StatCard';
import { fmtNum } from '@/lib/calculations';
import { C_PRODUCTION } from '@/lib/chartColors';
import { usePlants } from '@/hooks/usePlants';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  History, LayoutGrid, ListCollapse, ExternalLink, ShieldAlert, Building2,
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

  // Query past 7 days production if chartData is not provided
  const { data: fallbackSparkline } = useQuery({
    queryKey: ['plant-pulse-hero-7d-sparkline', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const sinceDate = format(new Date(Date.now() - 7 * 86400000), 'yyyy-MM-dd');
      const { data } = await supabase
        .from('daily_plant_summary')
        .select('date, product_water_m3')
        .in('plant_id', plantIds)
        .gte('date', sinceDate)
        .order('date', { ascending: true });

      const dayMap: Record<string, number> = {};
      (data ?? []).forEach((r) => {
        dayMap[r.date] = (dayMap[r.date] ?? 0) + (Number(r.product_water_m3) || 0);
      });
      return Object.entries(dayMap).map(([date, val]) => ({ date, val }));
    },
    enabled: (!chartData || !chartData.length) && plantIds.length > 0,
    staleTime: 5 * 60_000,
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

  // Last 7 days sparkline slice
  const sparklineData = useMemo(() => {
    if (chartData && chartData.length > 0) {
      return chartData.slice(-7).map((d) => ({
        val: d.production != null && Number.isFinite(d.production) ? d.production : 0,
      }));
    }
    if (fallbackSparkline && fallbackSparkline.length > 0) {
      return fallbackSparkline;
    }
    return [];
  }, [chartData, fallbackSparkline]);

  return (
    <div className="rounded-[1.75rem] bg-white/[0.03] ring-1 ring-white/10 p-1 sm:p-1.5 shadow-[var(--shadow-elev)]">
      <div className="rounded-[calc(1.75rem-0.375rem)] bg-gradient-stat text-foreground p-4 sm:p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] edge-light-teal relative overflow-hidden">
        
        {/* ── Top Bar: Title, Facility Badge, Incident Flag, Downtime & View Toggle ── */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3.5 border-b border-border/40">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
              PWRI Operations Telemetry
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-primary/15 text-primary border border-primary/30 flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {selectedPlantName}
            </span>
            {openIncidentCount > 0 && (
              <button
                type="button"
                onClick={onViewIncidents}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-danger-soft text-danger border border-danger/30 text-2xs font-semibold hover:bg-danger/20 transition-colors"
                title={`${openIncidentCount} open incident${openIncidentCount > 1 ? 's' : ''} — click to view`}
              >
                <ShieldAlert className="h-3 w-3" aria-hidden />
                <span>{openIncidentCount} open incident{openIncidentCount > 1 ? 's' : ''}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenDowntime}
              className="h-8 text-xs gap-1.5 font-medium bg-background/60 border-border/70 text-foreground hover:bg-background"
            >
              <History className="h-3.5 w-3.5 text-info" />
              <span className="hidden sm:inline">Downtime Log</span>
            </Button>

            {/* View Mode Toggle */}
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && onViewModeChange(v as DashboardViewMode)}
              className="h-8 bg-background/60 border border-border/70 rounded-lg p-0.5"
              data-testid="dashboard-view-mode"
            >
              <ToggleGroupItem
                value="inline"
                className="h-7 px-2.5 text-xs gap-1 text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-primary data-[state=on]:shadow-xs rounded-md font-medium"
                title="Inline — all trend graphs visible directly on the dashboard"
                aria-label="Inline view"
              >
                <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden md:inline">Inline</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="sections"
                className="h-7 px-2.5 text-xs gap-1 text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-primary data-[state=on]:shadow-xs rounded-md font-medium"
                title="Sections — click any KPI card to fold/unfold its trend chart inline"
                aria-label="Sections view"
              >
                <ListCollapse className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden md:inline">Sections</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="popup"
                className="h-7 px-2.5 text-xs gap-1 text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-primary data-[state=on]:shadow-xs rounded-md font-medium"
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
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center pt-3.5">
          {/* Left: Headline Metric & Status */}
          <div className="md:col-span-5 space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="readout-num readout-glow text-4xl sm:text-5xl font-bold leading-none">
                {fmtNum(production)}
              </span>
              <span className="text-base font-sans font-normal text-muted-foreground">m³</span>
            </div>
            
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
                Today's Production
              </span>
              {dProduction !== null && <TrendBadge delta={dProduction} />}
            </div>

            <div className="text-2xs text-muted-foreground flex items-center gap-1.5 pt-0.5 font-mono">
              <Lamp tone="live" pulse size={6} />
              <span>Live Telemetry</span>
              <span className="text-border/80">&bull;</span>
              <span>{secondsAgo}s ago</span>
              <span className="text-border/80">&bull;</span>
              <span>{timeStr || '—'}</span>
            </div>
          </div>

          {/* Middle: 7-Day Sparkline */}
          <div className="md:col-span-4 h-12 flex flex-col justify-end">
            {sparklineData.length >= 2 ? (
              <div className="h-10 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparklineData} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                    <defs>
                      <linearGradient id="heroSparklineFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C_PRODUCTION} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={C_PRODUCTION} stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="val"
                      stroke={C_PRODUCTION}
                      strokeWidth={2}
                      fill="url(#heroSparklineFill)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="text-right text-3xs font-mono text-muted-foreground/70 -mt-1">
                  7-day production trend
                </div>
              </div>
            ) : (
              <div className="text-3xs font-mono text-muted-foreground/60 flex items-center h-full">
                Collecting 7-day sparkline telemetry…
              </div>
            )}
          </div>

          {/* Right: Fleet Health Status Lamps */}
          <div className="md:col-span-3 flex md:flex-col justify-start md:justify-center md:items-end gap-2 text-2xs font-mono">
            <div className="flex items-center gap-2 bg-background/60 border border-border/70 rounded-lg px-3 py-2 shadow-xs">
              <span className="flex items-center gap-1.5">
                <Lamp tone="good" size={6} />
                <span className="font-semibold text-foreground">{fleetCounts.online}</span>
                <span className="text-muted-foreground">online</span>
              </span>
              <span className="text-border/60">|</span>
              <span className="flex items-center gap-1.5">
                <Lamp tone="warn" size={6} />
                <span className="font-semibold text-foreground">{fleetCounts.stale}</span>
                <span className="text-muted-foreground">stale</span>
              </span>
              {fleetCounts.offline > 0 && (
                <>
                  <span className="text-border/60">|</span>
                  <span className="flex items-center gap-1.5">
                    <Lamp tone="muted" size={6} />
                    <span className="font-semibold text-foreground">{fleetCounts.offline}</span>
                    <span className="text-muted-foreground">off</span>
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
