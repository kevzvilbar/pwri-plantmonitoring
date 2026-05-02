import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calc } from '@/lib/calculations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ComposedChart, Bar,
} from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';
import {
  ChartMetric, DashboardViewMode, RANGE_DAYS, RangeKey, TREND_Y_LABEL,
} from './types';

// Renders the per-cluster trend chart slot beneath a cluster's StatCards.
//   • inline   — every chart in the cluster is rendered directly below
//                the cards (full-width, compact height) so the user can
//                just scroll to see all trends.
//   • sections — at most one chart (matching `expandedMetric`) is
//                rendered below the cards. Single-open behaviour: the
//                user clicks a KPI card to fold its chart open here;
//                clicking another KPI auto-closes the previous.
//   • popup    — nothing is rendered here; charts surface only inside
//                the TrendModal opened from the StatCards above.
export function ClusterCharts({
  metrics, viewMode, expandedMetric, plantIds, clusterId,
}: {
  metrics: ChartMetric[];
  viewMode: DashboardViewMode;
  expandedMetric: string | null;
  plantIds: string[];
  clusterId: string;
}) {
  if (viewMode === 'popup') return null;
  if (viewMode === 'inline') {
    return (
      <div className="space-y-2 mt-2" data-testid={`cluster-inline-charts-${clusterId}`}>
        {metrics.map((m) => (
          <InlineTrendChart key={m.metric} metric={m.metric} title={m.title} plantIds={plantIds} compact />
        ))}
      </div>
    );
  }
  // sections — render the expanded chart only if it belongs to this cluster
  if (viewMode === 'sections' && expandedMetric) {
    const m = metrics.find((x) => x.metric === expandedMetric);
    if (!m) return null;
    return (
      <div className="mt-2" data-testid={`cluster-section-chart-${m.metric}`}>
        <InlineTrendChart metric={m.metric} title={m.title} plantIds={plantIds} />
      </div>
    );
  }
  return null;
}

// Card-wrapped trend chart used both for `inline` (compact height,
// stacked beneath each cluster) and `sections` (regular height,
// single open at a time). Title and range buttons share the same row
// so the chart area is maximised, especially on mobile.
export function InlineTrendChart({
  metric, title, plantIds, compact = false,
}: {
  metric: string;
  title: string;
  plantIds: string[];
  compact?: boolean;
}) {
  return (
    <Card className="p-3" data-testid={`inline-trend-${metric}`}>
      <TrendChart metric={metric} title={title} plantIds={plantIds} compact={compact} />
    </Card>
  );
}

// Modal-wrapped trend chart used in `popup` view mode. Thin Dialog
// shell — the chart logic itself lives entirely in <TrendChart> below.
export function TrendModal({
  open, onClose, metric, title, plantIds,
}: {
  open: boolean;
  onClose: () => void;
  metric: string;
  title: string;
  plantIds: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Pick a date range to inspect the {title.toLowerCase()} time series for the selected plants.
          </DialogDescription>
        </DialogHeader>
        <TrendChart metric={metric} plantIds={plantIds} />
      </DialogContent>
    </Dialog>
  );
}

// Reusable trend chart used both inside the popup TrendModal and as
// an inline/section panel embedded directly on the dashboard. Owns
// its own range state, supabase queries, and chart rendering. The
// `compact` prop swaps in a shorter chart height for the inline view
// where multiple charts stack vertically and we want to keep the
// page from getting absurdly tall. When `title` is provided the
// component renders it on the same row as the range buttons so the
// chart area is maximised on mobile.
export function TrendChart({
  metric, plantIds, compact = false, title,
}: {
  metric: string;
  plantIds: string[];
  compact?: boolean;
  title?: string;
}) {
  const [range, setRange] = useState<RangeKey>('7D');
  const [from, setFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Stable date-bounded ISO strings so react-query can cache properly.
  const { startISO, endISO, startKey, endKey } = useMemo(() => {
    if (range === 'CUSTOM') {
      const s = new Date(`${from}T00:00:00`);
      const e = new Date(`${to}T23:59:59`);
      return {
        startISO: s.toISOString(), endISO: e.toISOString(),
        startKey: from, endKey: to,
      };
    }
    const days = RANGE_DAYS[range];
    const end = new Date();
    const start = startOfDay(subDays(end, days));
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      startKey: format(start, 'yyyy-MM-dd'),
      endKey: format(end, 'yyyy-MM-dd'),
    };
  }, [range, from, to]);

  const needsWellReadings = metric === 'production' || metric === 'nrw' || metric === 'rawwater' || metric === 'pv';
  const needsLocReadings = metric === 'production' || metric === 'nrw';
  const needsRoReadings = metric === 'recovery' || metric === 'tds';
  const needsPowerReadings = metric === 'pv';
  const needsCostReadings = metric === 'productionCost';

  const supaSelect = async <T,>(table: string, cols: string) => {
    // Supabase JS v2 narrows `from(table)` to a literal-string union
    // pulled from the generated types. Our caller passes a string
    // variable resolved at runtime, so we need a cast to bypass the
    // (otherwise correct) compile-time check. The helper is used only
    // with table names known to exist (locator_readings,
    // well_readings, ro_train_readings, power_readings) — all
    // validated by the unit tests below.
    const { data, error } = await supabase.from(table as never).select(cols)
      .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as T[]) ?? [];
  };
  const { data: locReadings, isFetching: fetchingLoc, error: errLoc } = useQuery({
    queryKey: ['trend-loc', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>('locator_readings', 'daily_volume,reading_datetime'),
    enabled: plantIds.length > 0 && needsLocReadings,
  });
  const { data: wellReadings, isFetching: fetchingWell, error: errWell } = useQuery({
    queryKey: ['trend-well', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>('well_readings', 'daily_volume,reading_datetime'),
    enabled: plantIds.length > 0 && needsWellReadings,
  });
  const { data: roReadings, isFetching: fetchingRo, error: errRo } = useQuery({
    queryKey: ['trend-ro', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>('ro_train_readings', 'recovery_pct,permeate_tds,reading_datetime'),
    enabled: plantIds.length > 0 && needsRoReadings,
  });
  const { data: powerReadings, isFetching: fetchingPower, error: errPower } = useQuery({
    queryKey: ['trend-power', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>('power_readings', 'daily_consumption_kwh,reading_datetime'),
    enabled: plantIds.length > 0 && needsPowerReadings,
  });
  // Production-cost rows use a date column (`cost_date`) rather than a
  // datetime, so the generic `supaSelect` helper (which filters on
  // `reading_datetime`) doesn't fit. Inline this single query instead.
  // `production_m3` is pulled so we can compute weighted ₱/m³ across
  // multi-plant selections (a simple average of per-plant `cost_per_m3`
  // would mis-weight a plant that produced 10× the volume).
  const { data: costReadings, isFetching: fetchingCost, error: errCost } = useQuery({
    queryKey: ['trend-cost', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_costs')
        .select('cost_date,power_cost,chem_cost,total_cost,production_m3')
        .in('plant_id', plantIds)
        .gte('cost_date', startKey)
        .lte('cost_date', endKey);
      if (error) throw new Error(`production_costs: ${error.message}`);
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsCostReadings,
  });

  const isFetching = fetchingLoc || fetchingWell || fetchingRo || fetchingPower || fetchingCost;
  const queryError = (errLoc || errWell || errRo || errPower || errCost) as Error | null;

  const chartData = useMemo(() => {
    const byDay = new Map<string, any>();
    const ensure = (d: string, sortKey: number) =>
      byDay.get(d) ?? byDay.set(d, {
        date: d, sortKey, production: 0, consumption: 0,
        rawwater: 0, recovery: 0, recoverySamples: 0,
        tds: 0, tdsSamples: 0, kwh: 0,
        powerCost: 0, chemCost: 0, totalCost: 0,
        costProduction: 0,
      }).get(d);

    (wellReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.production += r.daily_volume ?? 0;
      row.rawwater += r.daily_volume ?? 0;
    });
    (locReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      ensure(key, dt.getTime()).consumption += r.daily_volume ?? 0;
    });
    (roReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      if (r.recovery_pct != null) { row.recovery += +r.recovery_pct; row.recoverySamples += 1; }
      if (r.permeate_tds != null) { row.tds += +r.permeate_tds; row.tdsSamples += 1; }
    });
    (powerReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      ensure(key, dt.getTime()).kwh += +r.daily_consumption_kwh || 0;
    });
    // Roll up daily ₱ totals across the selected plants. `cost_date` is
    // a date string (YYYY-MM-DD) — anchor it at local midnight for a
    // stable sortKey. `total_cost` is a generated column in some rows
    // and null in others, so fall back to the power+chem sum.
    // `costProduction` accumulates `production_m3` from the same row
    // so we can compute a volume-weighted ₱/m³ at the end (don't reuse
    // the well-readings `production` field — RO output ≠ billable
    // production_m3 in some plants).
    (costReadings ?? []).forEach((r: any) => {
      const dt = new Date(`${r.cost_date}T00:00:00`);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      const power = +(r.power_cost ?? 0);
      const chem = +(r.chem_cost ?? 0);
      row.powerCost += power;
      row.chemCost += chem;
      row.totalCost += r.total_cost != null ? +r.total_cost : power + chem;
      row.costProduction += +(r.production_m3 ?? 0);
    });

    return Array.from(byDay.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _s, recoverySamples, tdsSamples, costProduction, ...d }) => ({
        ...d,
        recovery: recoverySamples ? +(d.recovery / recoverySamples).toFixed(1) : null,
        tds: tdsSamples ? Math.round(d.tds / tdsSamples) : null,
        nrw: calc.nrw(d.production, d.consumption),
        // Volume-weighted ₱/m³ — null when no production was recorded so
        // Recharts skips the point cleanly instead of plotting Infinity.
        unitCost: costProduction > 0 ? +(d.totalCost / costProduction).toFixed(2) : null,
      }));
  }, [locReadings, wellReadings, roReadings, powerReadings, costReadings]);

  const chartHeight = compact ? 'h-[200px]' : 'h-[340px]';

  // Format large numbers as 1.2K / 3.4M on the Y-axis so the axis
  // label doesn't eat into the chart area on narrow mobile screens.
  const formatYAxis = (value: number) => {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(value);
  };

  return (
    <>
      {/* Title and range buttons share one row so the chart isn't pushed down */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {title && (
          <span className="text-sm font-semibold mr-1 shrink-0">{title}</span>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {(['7D', '14D', '30D', '60D', '90D'] as RangeKey[]).map((r) => (
            <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              onClick={() => setRange(r)} data-testid={`trend-range-${metric}-${r}`}>{r}</Button>
          ))}
          <Button
            size="sm"
            variant={range === 'CUSTOM' ? 'default' : 'outline'}
            className="h-7 px-2 text-xs"
            onClick={() => setRange('CUSTOM')}
            data-testid={`trend-range-${metric}-CUSTOM`}
          >Custom</Button>
          {range === 'CUSTOM' && (
            <div className="flex items-center gap-1 mt-1 w-full sm:w-auto sm:mt-0">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-7 w-[130px] text-xs"
                data-testid={`trend-from-${metric}`}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-7 w-[130px] text-xs"
                data-testid={`trend-to-${metric}`}
              />
            </div>
          )}
          {isFetching && (
            <span className="text-[10px] text-muted-foreground ml-1">Loading…</span>
          )}
        </div>
      </div>
      <div className={`${chartHeight} w-full relative`} data-testid={`trend-chart-${metric}`}>
        {queryError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-rose-300 bg-rose-50/95 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/80 dark:border-rose-900 dark:text-rose-300 shadow-sm pointer-events-auto max-w-md text-center">
              <div className="font-semibold mb-0.5">Couldn't load trend data</div>
              <div className="text-[11px] opacity-80">{queryError.message}</div>
            </div>
          </div>
        )}
        {!queryError && !isFetching && chartData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-border/60 bg-card/80 backdrop-blur-sm px-3 py-2 text-xs text-muted-foreground text-center pointer-events-auto max-w-md shadow-sm">
              <div className="font-medium text-foreground">No data in selected range</div>
              <div className="text-[11px] mt-0.5">
                Try a wider range, switch plant, or log readings for {metric === 'nrw' ? 'wells & locators' : metric === 'pv' ? 'wells & power' : metric === 'tds' || metric === 'recovery' ? 'RO trains' : metric === 'productionCost' ? 'power + chemicals (production_costs rollup)' : 'wells'}.
              </div>
            </div>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          {metric === 'nrw' ? (
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis yAxisId="vol" tick={{ fontSize: 10 }} stroke="hsl(var(--chart-1))" tickFormatter={formatYAxis} width={36} label={{ value: 'm³', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--warn))" width={30} label={{ value: 'NRW%', angle: 90, position: 'insideRight', fontSize: 9, offset: 8 }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="vol" dataKey="production" fill="hsl(var(--chart-1))" name="Production (m³)" />
              <Bar yAxisId="vol" dataKey="consumption" fill="hsl(var(--chart-2))" name="Consumption (m³)" />
              <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke="hsl(var(--warn))" strokeWidth={2.5} dot={{ r: 3 }} name="NRW %" />
            </ComposedChart>
          ) : metric === 'productionCost' ? (
            // Two-axis composed chart: absolute ₱ amounts on the left,
            // ₱/m³ unit cost on the right. Unit cost lives in a different
            // magnitude bucket (single-digit ₱/m³ vs thousands of ₱) so
            // sharing one axis would either flatten the unit-cost line or
            // crush the totals. Dashed stroke flags it as a derived ratio.
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis yAxisId="amt" tick={{ fontSize: 10 }} stroke="hsl(var(--accent))" tickFormatter={formatYAxis} width={36} label={{ value: '₱', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <YAxis yAxisId="unit" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--warn))" width={30} label={{ value: '₱/m³', angle: 90, position: 'insideRight', fontSize: 9, offset: 8 }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="amt" type="monotone" dataKey="totalCost" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 2 }} name="Total (₱)" />
              <Line yAxisId="amt" type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (₱)" />
              <Line yAxisId="amt" type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2} dot={false} name="Chemical (₱)" />
              <Line yAxisId="unit" type="monotone" dataKey="unitCost" stroke="hsl(var(--warn))" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} name="₱/m³" connectNulls />
            </ComposedChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={36} label={{ value: TREND_Y_LABEL[metric] ?? '', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {metric === 'production' && (<>
                <Line type="monotone" dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Production (m³)" />
                <Line type="monotone" dataKey="consumption" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} name="Consumption (m³)" />
              </>)}
              {metric === 'rawwater' && (
                <Line type="monotone" dataKey="rawwater" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Raw Water (m³)" />
              )}
              {metric === 'recovery' && (
                <Line type="monotone" dataKey="recovery" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={{ r: 2 }} name="Recovery (%)" />
              )}
              {metric === 'tds' && (
                <Line type="monotone" dataKey="tds" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="Permeate TDS (ppm)" />
              )}
              {metric === 'pv' && (<>
                <Line type="monotone" dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Production (m³)" />
                <Line type="monotone" dataKey="kwh" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (kWh)" />
              </>)}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </>
  );
}
