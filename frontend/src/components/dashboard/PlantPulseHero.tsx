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
import { Activity, Building2 } from 'lucide-react';

interface PlantPulseHeroProps {
  plantIds: string[];
  production: number | null;
  dProduction: number | null;
  chartData?: any[];
  onSelectPlant?: (plantId: string) => void;
}

export function PlantPulseHero({
  plantIds,
  production,
  dProduction,
  chartData,
  onSelectPlant,
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

  const plantTitle = useMemo(() => {
    if (!plantIds.length || plantIds.length === (plants?.length ?? 0)) {
      return 'Fleet Command — All Facilities';
    }
    if (plantIds.length === 1) {
      const p = plants?.find((item) => item.id === plantIds[0]);
      return p?.name ?? 'Plant Overview';
    }
    return `${plantIds.length} Plants Selected`;
  }, [plantIds, plants]);

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
    <div className="rounded-xl border border-border/80 bg-gradient-stat text-foreground p-4 sm:p-5 shadow-[var(--shadow-elev)] border-t-2 border-t-primary relative overflow-hidden">
      {/* ── Top Bar: Live Status · Facility · Live Clock ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap pb-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/60 border border-border/60 text-3xs font-mono font-semibold tracking-wider uppercase text-highlight">
            <Lamp tone="live" pulse size={6} />
            <span>Live Telemetry</span>
          </div>
          <span className="text-xs font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            {plantTitle}
          </span>
        </div>

        <div className="text-2xs font-mono font-medium text-muted-foreground/90">
          {timeStr || '—'}
        </div>
      </div>

      {/* ── Main Hero Content ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center pt-3.5">
        {/* Left: Headline Metric */}
        <div className="md:col-span-5 space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-bold font-mono tabular-nums leading-none readout-glow">
              {fmtNum(production)}
            </span>
            <span className="text-sm font-sans font-normal text-muted-foreground">m³</span>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground">
              Today's Production
            </span>
            {dProduction !== null && <TrendBadge delta={dProduction} />}
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
          <div className="flex items-center gap-2 bg-background/50 border border-border/60 rounded-lg px-2.5 py-1.5">
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
  );
}

