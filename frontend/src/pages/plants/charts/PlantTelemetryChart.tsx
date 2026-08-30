import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Activity, TrendingUp, Calendar, Droplets } from 'lucide-react';
import { fmtNum, fmtVol } from '@/lib/format';
import { ModernChartLegend } from '@/components/dashboard/TrendChartLegend';
import { C_PRODUCTION, C_CONSUMPTION } from '@/lib/chartColors';
import { cn } from '@/lib/utils';

export type TimeRange = '7d' | '30d' | '90d';

const INSTRUMENT_TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--popover))',
  borderColor: 'hsl(var(--border))',
  borderRadius: '0.75rem',
  color: 'hsl(var(--popover-foreground))',
  fontSize: '12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
};

interface PlantTelemetryChartProps {
  plantId: string;
  designCapacityM3?: number | null;
  plantName: string;
}

export function PlantTelemetryChart({
  plantId,
  designCapacityM3,
  plantName,
}: PlantTelemetryChartProps) {
  const [range, setRange] = useState<TimeRange>('30d');

  const daysBack = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const startDateStr = format(subDays(new Date(), daysBack), 'yyyy-MM-dd');

  // Query product meters and locators for this plant
  const { data: entityIds } = useQuery({
    queryKey: ['plant-chart-entity-ids', plantId],
    queryFn: async () => {
      const [{ data: pMeters }, { data: locators }, { data: trains }] = await Promise.all([
        supabase.from('product_meters').select('id, name').eq('plant_id', plantId),
        supabase.from('locators').select('id, name').eq('plant_id', plantId),
        supabase.from('ro_trains').select('id, train_number').eq('plant_id', plantId),
      ]);
      return {
        productMeterIds: (pMeters ?? []).map((m: any) => m.id),
        locatorIds: (locators ?? []).map((l: any) => l.id),
        trainIds: (trains ?? []).map((t: any) => t.id),
      };
    },
    enabled: !!plantId,
  });

  // Query daily readings
  const { data: chartData, isLoading } = useQuery({
    queryKey: ['plant-telemetry-chart', plantId, range, entityIds],
    queryFn: async () => {
      if (!entityIds) return [];

      const promises: Promise<any>[] = [];

      // 1. Product meter readings (Production)
      if (entityIds.productMeterIds.length > 0) {
        promises.push(
          supabase
            .from('product_meter_readings' as any)
            .select('reading_datetime, daily_volume, current_reading, previous_reading')
            .in('meter_id', entityIds.productMeterIds)
            .gte('reading_datetime', startDateStr)
            .order('reading_datetime', { ascending: true })
        );
      } else if (entityIds.trainIds.length > 0) {
        // Permeate as production fallback
        promises.push(
          supabase
            .from('ro_train_readings')
            .select('reading_datetime, permeate_meter_delta, recovery_pct')
            .in('train_id', entityIds.trainIds)
            .gte('reading_datetime', startDateStr)
            .order('reading_datetime', { ascending: true })
        );
      } else {
        promises.push(Promise.resolve({ data: [] }));
      }

      // 2. Locator readings (Consumption)
      if (entityIds.locatorIds.length > 0) {
        promises.push(
          supabase
            .from('locator_readings')
            .select('reading_datetime, daily_volume, current_reading, previous_reading')
            .in('locator_id', entityIds.locatorIds)
            .gte('reading_datetime', startDateStr)
            .order('reading_datetime', { ascending: true })
        );
      } else {
        promises.push(Promise.resolve({ data: [] }));
      }

      const [prodRes, consRes] = await Promise.all(promises);

      const dateMap = new Map<string, { production: number; consumption: number; count: number }>();

      // Aggregate production
      (prodRes.data ?? []).forEach((r: any) => {
        const d = r.reading_datetime ? r.reading_datetime.slice(0, 10) : null;
        if (!d) return;
        const vol = r.daily_volume ?? (r.permeate_meter_delta ?? (r.current_reading != null && r.previous_reading != null ? Math.max(0, r.current_reading - r.previous_reading) : 0));
        const entry = dateMap.get(d) ?? { production: 0, consumption: 0, count: 0 };
        entry.production += +vol || 0;
        dateMap.set(d, entry);
      });

      // Aggregate consumption
      (consRes.data ?? []).forEach((r: any) => {
        const d = r.reading_datetime ? r.reading_datetime.slice(0, 10) : null;
        if (!d) return;
        const vol = r.daily_volume ?? (r.current_reading != null && r.previous_reading != null ? Math.max(0, r.current_reading - r.previous_reading) : 0);
        const entry = dateMap.get(d) ?? { production: 0, consumption: 0, count: 0 };
        entry.consumption += +vol || 0;
        dateMap.set(d, entry);
      });

      // Generate continuous calendar days for clean trend
      const rows = [];
      for (let i = daysBack - 1; i >= 0; i--) {
        const dt = subDays(new Date(), i);
        const iso = format(dt, 'yyyy-MM-dd');
        const entry = dateMap.get(iso);
        rows.push({
          date: format(dt, 'MMM d'),
          isoDate: iso,
          production: entry ? +entry.production.toFixed(1) : 0,
          consumption: entry ? +entry.consumption.toFixed(1) : 0,
        });
      }

      return rows;
    },
    enabled: !!plantId && !!entityIds,
    staleTime: 60_000,
  });

  const dailyCapacityM3 = designCapacityM3 ? designCapacityM3 * 1000 : null;

  const totalProd = (chartData ?? []).reduce((s, r) => s + r.production, 0);
  const avgDailyProd = chartData?.length ? +(totalProd / chartData.length).toFixed(1) : 0;
  const avgUtilization = dailyCapacityM3 && avgDailyProd > 0 ? Math.round((avgDailyProd / dailyCapacityM3) * 100) : null;

  return (
    <Card className="p-4 rounded-xl border border-border/60 bg-card/80 backdrop-blur-xs space-y-3 shadow-xs">
      {/* ── Header: Title, Aggregates, and Range Selector ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">
              Facility Telemetry Trend
            </h3>
            <p className="text-3xs text-muted-foreground">
              Daily production vs. offtake consumption across {plantName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
          {/* Quick Metrics */}
          {avgDailyProd > 0 && (
            <div className="hidden md:flex items-center gap-3 text-2xs px-2.5 py-1 rounded-lg bg-muted/40 border border-border/40 font-mono">
              <span>Avg: <strong className="text-foreground">{fmtVol(avgDailyProd)}</strong>/d</span>
              {avgUtilization != null && (
                <span>Util: <strong className={avgUtilization > 95 ? 'text-warn' : 'text-accent'}>{avgUtilization}%</strong></span>
              )}
            </div>
          )}

          {/* Range Selector */}
          <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/50">
            {(['7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  'px-2.5 py-1 text-2xs font-semibold rounded-md transition-all',
                  range === r
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Chart Canvas ── */}
      <div className="h-56 w-full pt-1">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Loading facility telemetry history…
          </div>
        ) : (chartData?.length ?? 0) === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            No historical telemetry recorded in this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="plantProdFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C_PRODUCTION} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={C_PRODUCTION} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="plantConsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C_CONSUMPTION} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C_CONSUMPTION} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.5} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
              />
              <Tooltip
                contentStyle={INSTRUMENT_TOOLTIP_STYLE}
                formatter={(val: any, name: string) => [
                  `${fmtVol(+val)}`,
                  name === 'production' ? 'Production' : name === 'consumption' ? 'Consumption' : name,
                ]}
              />
              {dailyCapacityM3 != null && (
                <ReferenceLine
                  y={dailyCapacityM3}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: `Design Cap: ${fmtNum(dailyCapacityM3)} m³/d`,
                    fill: '#f59e0b',
                    fontSize: 10,
                    position: 'top',
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="consumption"
                name="consumption"
                stroke={C_CONSUMPTION}
                strokeWidth={2}
                fill="url(#plantConsFill)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="production"
                name="production"
                stroke={C_PRODUCTION}
                strokeWidth={2.5}
                fill="url(#plantProdFill)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Modern Inline Legend ── */}
      <div className="pt-1 flex items-center justify-between flex-wrap gap-2 text-2xs text-muted-foreground">
        <ModernChartLegend
          items={[
            { color: C_PRODUCTION, label: 'Production (m³)', shape: 'area' },
            { color: C_CONSUMPTION, label: 'Consumption (m³)', shape: 'area' },
            ...(dailyCapacityM3 != null ? [{ color: '#f59e0b', label: 'Design Capacity Limit', shape: 'line' as const }] : []),
          ]}
        />
        <span className="text-3xs font-mono text-muted-foreground/80">
          Telemetry auto-refreshes with SCADA sync
        </span>
      </div>
    </Card>
  );
}

