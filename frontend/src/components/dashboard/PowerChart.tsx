/**
 * PowerChart.tsx  — Power Consumption & Energy Mix (combined)
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in replacement for the old PowerChart (blank "Power consumption · last 14d")
 * AND the old Energy Mix card. Same export name + same `plantIds` prop so the
 * dashboard file needs zero changes on the call site.
 *
 * What changed vs the old file:
 *  • hasSolar / hasGrid derived automatically from actual data — no extra props
 *  • Proper delta logic: daily_consumption_kwh → Δ meter_reading_kwh × multiplier
 *  • Fetches one pre-window row per plant so the first bar is never 0
 *  • Solar bars stacked below Grid bars (yellow + blue)
 *  • Today stat cards: Solar / Grid / Total with ↑↓ vs yesterday
 *  • Range pills: 14d · 30d · 90d · All
 *  • Source filter pills: Both · ☀ Solar · ⚡ Grid
 *  • CSV export
 *  • "No power readings" empty state with helpful hint
 *
 * DASHBOARD — no call-site changes needed:
 *   <PowerChart plantIds={plantIds} />
 *
 * Delete the separate Energy Mix card wherever it's rendered in the dashboard.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, Sun, Zap, Download, BarChart2 } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { subDays } from 'date-fns';
import { toast } from 'sonner';

// ─── Formatters ──────────────────────────────────────────────────────────────
function fmtKwh(v: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function fmtY(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

type RangeKey  = '14' | '30' | '90' | 'all';
type SourceKey = 'both' | 'solar' | 'grid';

// ─── Component ───────────────────────────────────────────────────────────────
export function PowerChart({ plantIds }: { plantIds: string[] }) {
  const [range,  setRange]  = useState<RangeKey>('14');
  const [source, setSource] = useState<SourceKey>('both');

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: rows = [], isLoading } = useQuery<
    { date: string; solar: number; grid: number }[]
  >({
    queryKey: ['power-chart-v2', plantIds, range],
    queryFn: async () => {
      if (!plantIds.length) return [];

      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = subDays(new Date(), days).toISOString();

      // CT multiplier per plant from latest electric bill
      const multByPlant = new Map<string, number>();
      try {
        const { data: bills } = await (supabase as any)
          .from('electric_bills')
          .select('plant_id,multiplier')
          .in('plant_id', plantIds)
          .order('billing_month', { ascending: false });
        for (const b of (bills ?? []) as any[]) {
          if (!multByPlant.has(b.plant_id) && +b.multiplier > 0)
            multByPlant.set(b.plant_id, +b.multiplier);
        }
      } catch { /* table may not exist — default multiplier = 1 */ }

      // In-window rows
      const { data: inWin } = await (supabase as any)
        .from('power_readings')
        .select(
          'reading_datetime,plant_id,meter_reading_kwh,daily_consumption_kwh,' +
          'daily_solar_kwh,is_meter_replacement,multiplier'
        )
        .in('plant_id', plantIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });

      // One row BEFORE the window per plant — seeds the delta for the first bar
      const preRows: any[] = [];
      await Promise.all(
        plantIds.map(async (pid) => {
          const { data } = await (supabase as any)
            .from('power_readings')
            .select(
              'reading_datetime,plant_id,meter_reading_kwh,daily_consumption_kwh,' +
              'daily_solar_kwh,is_meter_replacement,multiplier'
            )
            .eq('plant_id', pid)
            .lt('reading_datetime', since)
            .order('reading_datetime', { ascending: false })
            .limit(1);
          if (data?.[0]) preRows.push(data[0]);
        })
      );

      // Merge & sort ascending — pre-rows come first
      const allRows = [...preRows, ...(inWin ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime()
      );

      // Delta accumulation (mirrors Plants.tsx PowerConsumptionEnergyMix logic)
      const prevGrid  = new Map<string, number | null>();
      const afterRepl = new Set<string>();
      const byDate    = new Map<string, { solar: number; grid: number }>();
      const ensure    = (d: string) => {
        if (!byDate.has(d)) byDate.set(d, { solar: 0, grid: 0 });
        return byDate.get(d)!;
      };
      const sinceDateStr = since.slice(0, 10);

      for (const r of allRows) {
        const pid  = r.plant_id as string;
        const date = (r.reading_datetime ?? '').slice(0, 10);
        if (!date) continue;

        const isRepl   = !!r.is_meter_replacement;
        const curr     = r.meter_reading_kwh != null ? +r.meter_reading_kwh : null;
        const inWindow = date >= sinceDateStr;

        // Grid
        if (isRepl) {
          prevGrid.set(pid, curr);
          afterRepl.add(pid);
        } else {
          let gridKwh = 0;
          if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0) {
            // Best path: pre-saved multiplied delta
            gridKwh = +r.daily_consumption_kwh;
            afterRepl.delete(pid);
          } else if (!afterRepl.has(pid)) {
            const prev = prevGrid.get(pid) ?? null;
            if (prev != null && curr != null) {
              const m = +(r.multiplier ?? 0) > 0
                ? +r.multiplier
                : (multByPlant.get(pid) ?? 1);
              const Δ = curr - prev;
              if (Δ >= 0) gridKwh = Δ * m;
            }
            afterRepl.delete(pid);
          } else {
            afterRepl.delete(pid);
          }
          prevGrid.set(pid, curr);
          if (inWindow && gridKwh > 0) ensure(date).grid += gridKwh;
        }

        // Solar — daily_solar_kwh is always a direct daily value, no delta needed
        if (!isRepl && inWindow && r.daily_solar_kwh != null) {
          const s = Math.max(0, +r.daily_solar_kwh);
          if (s > 0) ensure(date).solar += s;
        }
      }

      return Array.from(byDate.entries())
        .filter(([d]) => d >= sinceDateStr)
        .map(([date, v]) => ({
          date,
          solar: +v.solar.toFixed(2),
          grid:  +v.grid.toFixed(2),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
    enabled: plantIds.length > 0,
  });

  // hasSolar / hasGrid derived from actual data — no extra props needed
  const hasSolarData = rows.some(r => r.solar > 0);
  const hasGridData  = rows.some(r => r.grid  > 0);

  // Today stats (last row)
  const today     = rows.length ? rows[rows.length - 1] : null;
  const yesterday = rows.length > 1 ? rows[rows.length - 2] : null;

  const todaySolar = today?.solar ?? 0;
  const todayGrid  = today?.grid  ?? 0;
  const todayTotal = +(todaySolar + todayGrid).toFixed(1);
  const solarPct   = todayTotal > 0 ? +((todaySolar / todayTotal) * 100).toFixed(1) : 0;

  const solarDelta = yesterday && yesterday.solar > 0
    ? +(((todaySolar - yesterday.solar) / yesterday.solar) * 100).toFixed(1) : null;
  const gridDelta  = yesterday && yesterday.grid > 0
    ? +(((todayGrid  - yesterday.grid)  / yesterday.grid)  * 100).toFixed(1) : null;

  // Chart data filtered by source toggle
  const chartRows = useMemo(() => rows.map(r => ({
    date:     r.date,
    solarKwh: source !== 'grid'  ? r.solar : 0,
    gridKwh:  source !== 'solar' ? r.grid  : 0,
  })), [rows, source]);

  const exportCSV = () => {
    if (!rows.length) { toast.error('No data to export'); return; }
    const csv = [
      'date,solar_kwh,grid_kwh,total_kwh',
      ...rows.map(r => `${r.date},${r.solar},${r.grid},${+(r.solar + r.grid).toFixed(2)}`),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'power_energy_mix.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const rangeLabel = range === 'all' ? 'all time' : `last ${range}d`;

  return (
    <Card className="p-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-teal-600" />
            <span className="text-sm font-semibold">Power Consumption &amp; Energy Mix</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 pl-6">
            {rangeLabel} · daily totals · Solar vs Grid (kWh)
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Range pills */}
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['14', '30', '90', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={[
                  'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                  range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>

          {/* Source pills — only when both solar & grid data exist */}
          {hasSolarData && hasGridData && (
            <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
              {(['both', 'solar', 'grid'] as const).map(s => (
                <button key={s} onClick={() => setSource(s)}
                  className={[
                    'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                    source === s ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}>
                  {s === 'both' ? 'Both' : s === 'solar' ? '☀ Solar' : '⚡ Grid'}
                </button>
              ))}
            </div>
          )}

          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV}>
            <Download className="h-3 w-3" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Today stat cards — only when real data exists */}
      {today && (todaySolar > 0 || todayGrid > 0) && (
        <div className="grid grid-cols-3 gap-2 mb-3">

          {hasSolarData && (
            <div className="rounded-lg border border-yellow-200/70 bg-yellow-50/40 dark:border-yellow-800/30 dark:bg-yellow-950/10 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Sun className="h-3 w-3 text-yellow-500" />
                <span className="text-[9px] font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-400">Today Solar</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold tabular-nums">{fmtKwh(todaySolar)}</span>
                <span className="text-[10px] text-muted-foreground">kWh</span>
              </div>
              {solarDelta !== null && (
                <p className={`text-[10px] mt-0.5 font-medium ${solarDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                  {solarDelta >= 0 ? '↑' : '↓'} {Math.abs(solarDelta)}% vs yesterday
                </p>
              )}
            </div>
          )}

          {hasGridData && (
            <div className="rounded-lg border border-blue-200/70 bg-blue-50/40 dark:border-blue-800/30 dark:bg-blue-950/10 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap className="h-3 w-3 text-blue-500" />
                <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Today Grid</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold tabular-nums">{fmtKwh(todayGrid)}</span>
                <span className="text-[10px] text-muted-foreground">kWh</span>
              </div>
              {gridDelta !== null && (
                <p className={`text-[10px] mt-0.5 font-medium ${gridDelta <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                  {gridDelta >= 0 ? '↑' : '↓'} {Math.abs(gridDelta)}% vs yesterday
                </p>
              )}
            </div>
          )}

          <div className={`rounded-lg border border-teal-200/70 bg-teal-50/40 dark:border-teal-800/30 dark:bg-teal-950/10 px-3 py-2.5 ${(!hasSolarData || !hasGridData) ? 'col-span-2' : ''}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="h-3 w-3 text-teal-600" />
              <span className="text-[9px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">Today Total</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-semibold tabular-nums">{fmtKwh(todayTotal)}</span>
              <span className="text-[10px] text-muted-foreground">kWh</span>
            </div>
            {hasSolarData && todaySolar > 0 && (
              <p className="text-[10px] mt-0.5 text-muted-foreground">
                Solar: <span className="font-medium text-yellow-600 dark:text-yellow-400">{solarPct}%</span> of mix
              </p>
            )}
          </div>
        </div>
      )}

      {/* Chart */}
      {isLoading ? (
        <div className="flex items-center justify-center h-44 gap-2 text-xs text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          Loading…
        </div>
      ) : chartRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-44 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-25" />
          <p>No power readings in this period</p>
          <p className="text-[10px] opacity-60">
            Log readings in Operations → Power, then run the SQL migration to backfill legacy rows.
          </p>
        </div>
      ) : (
        <>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartRows}
                margin={{ top: 4, right: 4, left: -16, bottom: 20 }}
                barSize={Math.max(3, Math.min(18, 400 / Math.max(chartRows.length, 1)))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                  angle={-30}
                  textAnchor="end"
                  height={36}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={fmtY}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(v: any, name: string) => [
                    v != null && +v > 0 ? `${fmtKwh(+v)} kWh` : '—',
                    name,
                  ]}
                  labelFormatter={(l: string) => `Date: ${l}`}
                />
                {/* Solar — base of stack, no rounded corners */}
                {hasSolarData && source !== 'grid' && (
                  <Bar dataKey="solarKwh" name="☀ Solar (kWh)" fill="hsl(48,96%,53%)"  stackId="kwh" radius={[0, 0, 0, 0]} />
                )}
                {/* Grid — top of stack, rounded upper corners */}
                {hasGridData && source !== 'solar' && (
                  <Bar dataKey="gridKwh"  name="⚡ Grid (kWh)"  fill="hsl(213,94%,68%)" stackId="kwh" radius={[2, 2, 0, 0]} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend swatches */}
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-1">
            {hasSolarData && source !== 'grid' && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-yellow-400" />
                Solar (kWh)
              </div>
            )}
            {hasGridData && source !== 'solar' && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-400" />
                Grid (kWh)
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
