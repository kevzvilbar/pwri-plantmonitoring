import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { format, parseISO, subDays } from 'date-fns';
import { Waves, Layers, BarChart2, X } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { rangeKeyToDays } from '@/components/dashboard/types';
import { DRILL_COLORS, ModernChartLegend } from '@/components/dashboard/TrendChart';

// Per-day series entry. `by_well` is a well_id → volume pivot for that single
// day — needed for the "By well" stacked view and the richer tooltip/drill
// panel. Kept separate from the well-name lookup (see `wellNames` on the
// response) so a day with no events for a well simply omits that key.
type DaySeries = {
  date: string; // yyyy-MM-dd
  volume_m3: number;
  by_well: Record<string, number>;
};

type ApiResponse = {
  days: number;
  total_m3: number;
  today_m3: number;
  series: DaySeries[];
  by_well: { well_id: string; well_name: string; plant_name?: string; volume_m3: number }[];
};

// This app is Supabase-only (no FastAPI backend). Read blending_events
// directly — the same table the old backend route and Operations →
// Blending both ultimately read/write — and compute the rollup client-side.
type BlendingEventRow = {
  event_date: string | null;
  volume_m3: number | string | null;
  well_id: string | null;
  well_name?: string | null;
  plant_name?: string | null;
};

/**
 * Build the daily series (+ per-day per-well pivot) and range totals for a
 * concrete [fromISO, toISO] window (inclusive on both ends). Unlike the old
 * "since = today - (days-1)" version, this always uses the actual resolved
 * window — including when it doesn't end on today (a Custom range in the
 * past) — matching how CostSunburst/ComplianceRadarCard resolve the shared
 * dashboard range into real dates rather than a vague day-count.
 */
function computeFromEvents(events: BlendingEventRow[], fromISO: string, toISO: string): ApiResponse {
  const dayMs = 86_400_000;
  const fromMs = new Date(`${fromISO}T00:00:00Z`).getTime();
  const toMs = new Date(`${toISO}T00:00:00Z`).getTime();
  const todayISO = (() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
  })();

  const dateKeys: string[] = [];
  for (let t = fromMs; t <= toMs; t += dayMs) dateKeys.push(new Date(t).toISOString().slice(0, 10));

  const byDay: Record<string, number> = {};
  const byDayWell: Record<string, Record<string, number>> = {};
  const byWell: Record<string, { well_id: string; well_name: string; plant_name?: string; volume_m3: number }> = {};
  let total = 0;
  let todayTotal = 0;

  for (const ev of events) {
    const day = String(ev.event_date ?? '').slice(0, 10);
    if (!day || day < fromISO || day > toISO) continue;
    const vol = Number(ev.volume_m3) || 0;

    byDay[day] = (byDay[day] ?? 0) + vol;

    const wid = ev.well_id ?? '';
    if (wid) {
      if (!byDayWell[day]) byDayWell[day] = {};
      byDayWell[day][wid] = (byDayWell[day][wid] ?? 0) + vol;

      const cur = byWell[wid] ?? { well_id: wid, well_name: ev.well_name ?? '', plant_name: ev.plant_name ?? '', volume_m3: 0 };
      cur.volume_m3 += vol;
      byWell[wid] = cur;
    }

    total += vol;
    if (day === todayISO) todayTotal += vol;
  }

  const series: DaySeries[] = dateKeys.map((iso) => ({
    date: iso,
    volume_m3: Math.round((byDay[iso] ?? 0) * 100) / 100,
    by_well: Object.fromEntries(
      Object.entries(byDayWell[iso] ?? {}).map(([id, v]) => [id, Math.round(v * 100) / 100]),
    ),
  }));

  const by_well = Object.values(byWell)
    .map((w) => ({ ...w, volume_m3: Math.round(w.volume_m3 * 100) / 100 }))
    .sort((a, b) => b.volume_m3 - a.volume_m3);

  return {
    days: dateKeys.length,
    total_m3: Math.round(total * 100) / 100,
    today_m3: Math.round(todayTotal * 100) / 100,
    series,
    by_well,
  };
}

interface Props {
  plantIds: string[];
}

// Base bar color — kept identical to the previous hardcoded fill so the
// card's brand color doesn't shift, just gets a modern gradient + rounded
// top corners to match the rest of the dashboard's chart language.
const TOTAL_FILL = 'hsl(var(--blend-total))';

// Stacked "by well" view caps at this many individually-colored wells; the
// remainder rolls up into a single "Other" segment so the legend/stack stay
// readable even when a plant has a dozen+ blending wells.
const MAX_STACK_WELLS = 5;

export function BlendingVolumeCard({ plantIds }: Props) {
  const [viewMode, setViewMode] = useState<'total' | 'by-well'>('total');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // ── Follow the dashboard's shared/universal range picker ─────────────────
  // Same three fields every other trend chart on the dashboard reads from —
  // selecting 30D on Plant Health Trend (or any other chart) instantly
  // re-windows this chart too, with no picker of its own to keep in sync.
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);
  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);

  const isCustomRange = chartRange === 'CUSTOM';
  // Presets are inclusive of today (7D = today + 6 prior days) — matches the
  // window this card always used before it followed the shared range.
  const resolvedFrom = isCustomRange ? chartFrom : format(subDays(new Date(), days - 1), 'yyyy-MM-dd');
  const resolvedTo = isCustomRange ? chartTo : format(new Date(), 'yyyy-MM-dd');

  const rangeLabel = isCustomRange
    ? (chartFrom === chartTo
        ? format(parseISO(chartFrom), 'MMM d')
        : `${format(parseISO(chartFrom), 'MMM d')}–${format(parseISO(chartTo), 'MMM d')}`)
    : `last ${days}d`;

  const empty: ApiResponse = { days, total_m3: 0, today_m3: 0, series: [], by_well: [] };

  const { data, isFetching } = useQuery<ApiResponse>({
    queryKey: ['blending-volume', plantIds, resolvedFrom, resolvedTo],
    queryFn: async () => {
      if (!plantIds.length) return empty;

      try {
        const { data: events, error } = await supabase
          .from('blending_events' as any)
          .select('event_date, volume_m3, well_id, well_name, plant_name, plant_id')
          .in('plant_id', plantIds)
          .gte('event_date', resolvedFrom)
          .lte('event_date', resolvedTo);
        if (!error && Array.isArray(events)) {
          return computeFromEvents(events as unknown as BlendingEventRow[], resolvedFrom, resolvedTo);
        }
      } catch {
        // Table may not exist yet, or RLS blocked it — fall through to empty
      }

      return empty;
    },
    retry: false,
  });

  const series = useMemo(() => data?.series ?? [], [data]);
  const total = data?.total_m3 ?? 0;
  const today = data?.today_m3 ?? 0;
  const topWells = (data?.by_well ?? []).slice(0, 3);
  const dailyAvg = series.length ? total / series.length : 0;

  // Wells that get their own color in the stacked view + tooltip; anything
  // past MAX_STACK_WELLS is folded into "Other" (see stackKeys below).
  const stackWells = (data?.by_well ?? []).slice(0, MAX_STACK_WELLS);
  const hasOverflowWells = (data?.by_well ?? []).length > MAX_STACK_WELLS;
  const wellNameById = useMemo(() => {
    const m = new Map<string, string>();
    (data?.by_well ?? []).forEach((w) => m.set(w.well_id, w.well_name || 'Unnamed'));
    return m;
  }, [data]);

  const chartData = useMemo(() => series.map((s) => {
    const row: Record<string, any> = {
      isoDate: s.date,
      date: format(parseISO(s.date), 'MMM d'),
      volume: s.volume_m3,
      _byWell: s.by_well,
    };
    let accounted = 0;
    stackWells.forEach((w) => {
      const v = s.by_well[w.well_id] ?? 0;
      row[`w_${w.well_id}`] = v;
      accounted += v;
    });
    if (hasOverflowWells) row.w_other = Math.max(0, Math.round((s.volume_m3 - accounted) * 100) / 100);
    return row;
  }), [series, stackWells, hasOverflowWells]);

  const selectedRow = selectedDay ? chartData.find((r) => r.isoDate === selectedDay) : null;
  const selectedBreakdown: { name: string; volume: number }[] = selectedRow
    ? Object.entries(selectedRow._byWell as Record<string, number>)
        .map(([id, v]) => ({ name: wellNameById.get(id) ?? 'Unnamed', volume: v }))
        .sort((a, b) => b.volume - a.volume)
    : [];

  const handleBarClick = (row: any) => {
    if (!row?.isoDate) return;
    setSelectedDay((cur) => (cur === row.isoDate ? null : row.isoDate));
  };

  // Stack render order: top-declared segment (last in this array) is the one
  // drawn on top of the bar, so only it gets a rounded top corner — same
  // convention already used by the kwh Solar/Grid stacked bar in TrendChart.
  const stackSegments = [
    ...stackWells.map((w, i) => ({ key: `w_${w.well_id}`, color: DRILL_COLORS[i % DRILL_COLORS.length], label: w.well_name || 'Unnamed' })),
    ...(hasOverflowWells ? [{ key: 'w_other', color: 'hsl(var(--muted-foreground))', label: 'Other wells' }] : []),
  ];

  const BlendingTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = chartData.find((d) => d.date === label);
    if (!row) return null;
    const breakdown = Object.entries(row._byWell as Record<string, number>)
      .filter(([, v]) => v > 0)
      .map(([id, v]) => ({ name: wellNameById.get(id) ?? 'Unnamed', volume: v }))
      .sort((a, b) => b.volume - a.volume);
    const shown = breakdown.slice(0, 3);
    const rest = breakdown.length - shown.length;

    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 10,
        fontSize: 11,
        padding: '9px 12px',
        minWidth: 168,
        maxWidth: 260,
        boxShadow: 'var(--shadow-elev)',
        backdropFilter: 'blur(8px)',
      }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 12, letterSpacing: '-0.01em' }}>{label}</p>
        <p style={{ margin: '2px 0', color: TOTAL_FILL, fontWeight: 600 }}>
          Total: <span style={{ fontWeight: 700 }}>{fmtNum(row.volume, 1)} m³</span>
        </p>
        {shown.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
            {shown.map((w) => (
              <p key={w.name} style={{ margin: '2px 0', color: 'hsl(var(--muted-foreground))', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>{fmtNum(w.volume, 1)}</span>
              </p>
            ))}
            {rest > 0 && (
              <p style={{ margin: '2px 0', color: 'hsl(var(--muted-foreground))', opacity: 0.75 }}>+{rest} more well{rest > 1 ? 's' : ''}</p>
            )}
          </div>
        )}
        <p style={{ margin: '6px 0 0', color: 'hsl(var(--muted-foreground))', opacity: 0.75, fontSize: 10 }}>Click bar for full breakdown</p>
      </div>
    );
  };

  return (
    <Card className="p-3" data-testid="blending-volume-card">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Waves className="h-4 w-4 text-kpi-ro" />
            Blending Volume · {rangeLabel}
          </h2>
          {isFetching && <span className="text-2xs text-muted-foreground">Loading…</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted-foreground hidden sm:inline">
            Product-line water from blending wells (m³)
          </span>
          {/* Total / By well toggle — only worth showing once there's more
              than one contributing well to break down. */}
          {(data?.by_well ?? []).length > 1 && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => { setViewMode('total'); setSelectedDay(null); }}
                data-testid="blending-view-total"
                className={[
                  'h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none flex items-center gap-1',
                  viewMode === 'total' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >
                <BarChart2 className="h-3 w-3" />Total
              </button>
              <button
                onClick={() => { setViewMode('by-well'); setSelectedDay(null); }}
                data-testid="blending-view-by-well"
                className={[
                  'h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none flex items-center gap-1',
                  viewMode === 'by-well' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >
                <Layers className="h-3 w-3" />By well
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <KpiTile label="Today" value={fmtNum(today, 0)} testId="blending-today" />
        <KpiTile label={`Total ${days}d`} value={fmtNum(total, 0)} testId="blending-total" />
        <KpiTile label="Daily avg" value={fmtNum(dailyAvg, 0)} testId="blending-avg" />
      </div>

      <div className="h-36">
        {total === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-2">
            No blending injections recorded {rangeLabel === `last ${days}d` ? `in the ${rangeLabel}` : `for ${rangeLabel}`}
          </div>
        ) : (
          <ResponsiveContainer>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 4, left: -16, bottom: 0 }}
              barCategoryGap="28%"
            >
              <defs>
                <linearGradient id="blendVolumeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={TOTAL_FILL} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={TOTAL_FILL} stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fontWeight: 500 }}
                stroke="hsl(var(--muted-foreground))"
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip content={<BlendingTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }} />
              {viewMode === 'total' ? (
                <Bar
                  dataKey="volume"
                  name="Blending (m³)"
                  fill="url(#blendVolumeFill)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                  cursor="pointer"
                  onClick={handleBarClick}
                >
                  {chartData.map((row) => (
                    <Cell
                      key={row.isoDate}
                      fillOpacity={selectedDay && row.isoDate !== selectedDay ? 0.45 : 1}
                      stroke={row.isoDate === selectedDay ? TOTAL_FILL : 'transparent'}
                      strokeWidth={row.isoDate === selectedDay ? 2 : 0}
                    />
                  ))}
                </Bar>
              ) : (
                stackSegments.map((seg, i) => (
                  <Bar
                    key={seg.key}
                    dataKey={seg.key}
                    name={seg.label}
                    stackId="blend"
                    fill={seg.color}
                    radius={i === stackSegments.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                    maxBarSize={28}
                    cursor="pointer"
                    onClick={handleBarClick}
                  />
                ))
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {viewMode === 'by-well' && stackSegments.length > 0 && total > 0 && (
        <ModernChartLegend items={stackSegments.map((s) => ({ color: s.color, label: s.label, shape: 'bar' as const }))} />
      )}

      {/* ── Drill-down: exact per-well breakdown for a clicked day ─────────── */}
      {selectedRow && selectedBreakdown.length > 0 && (
        <div className="mt-3 pt-2 border-t" data-testid="blending-day-drilldown">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-2xs uppercase tracking-wide text-muted-foreground">
              {selectedRow.date} breakdown
            </span>
            <button
              onClick={() => setSelectedDay(null)}
              className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close breakdown"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1">
            {selectedBreakdown.map((w) => (
              <div key={w.name} className="flex justify-between items-center text-xs">
                <span className="min-w-0 truncate font-medium">{w.name}</span>
                <span className="font-mono-num shrink-0 ml-2">
                  {fmtNum(w.volume, 1)} <span className="text-2xs text-muted-foreground">m³</span>
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center text-xs pt-1 mt-1 border-t">
              <span className="font-semibold">Day total</span>
              <span className="font-mono-num font-semibold shrink-0 ml-2">
                {fmtNum(selectedRow.volume, 1)} <span className="text-2xs text-muted-foreground">m³</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {!selectedRow && topWells.length > 0 && (
        <div className="mt-3 pt-2 border-t">
          <div className="text-2xs uppercase tracking-wide text-muted-foreground mb-1.5">
            Top contributors · {rangeLabel}
          </div>
          <div className="space-y-1">
            {topWells.map((w) => (
              <div
                key={w.well_id}
                className="flex justify-between items-center text-xs"
                data-testid={`blending-well-${w.well_id}`}
              >
                <div className="min-w-0 truncate">
                  <span className="font-medium">{w.well_name || 'Unnamed'}</span>
                  {w.plant_name && (
                    <span className="text-muted-foreground"> · {w.plant_name}</span>
                  )}
                </div>
                <span className="font-mono-num shrink-0 ml-2">
                  {fmtNum(w.volume_m3, 0)} <span className="text-2xs text-muted-foreground">m³</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function KpiTile({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="rounded-md border bg-card p-2" data-testid={testId}>
      <div className="text-2xs uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </div>
      <div className="mt-1 font-mono-num text-base text-foreground">
        {value}
        <span className="text-2xs font-sans text-muted-foreground ml-1">m³</span>
      </div>
    </div>
  );
}
