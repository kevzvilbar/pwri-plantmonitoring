import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataState } from '@/components/DataState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, Download, AlertTriangle, Maximize2, CalendarIcon } from 'lucide-react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Scatter } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format, parseISO, subDays } from 'date-fns';

// ─── TrainRODetailCharts ──────────────────────────────────────────────────────
// RO performance panel: a compact 2×3 glance grid (unchanged from the original
// layout) where each card opens a wider detail dialog on click.
// Source: ro_train_readings — no extra tables needed.
//
// Readings tagged norm_status = 'pending_review' | 'retracted' (the same spike
// guard used by PretreatmentAndROLog.tsx and lib/readingGuards.ts) are dropped
// from every average, peak, and axis domain below, and are surfaced instead as
// a small ◇ marker in the detail view — so one bad meter entry can't silently
// flatten the rest of the chart, but it also isn't hidden.
//
// Permeate Flow, Reject Flow, and Daily Volume all open the same "Flow & Volume"
// dialog — Flow Rate / Volume tabs, a Feed/Permeate/Reject series toggle, an
// adjustable date range, and a Daily-avg / Individual-readings granularity
// switch (readings are logged manually, not on a fixed cadence, so "hourly"
// really means "each reading at its own timestamp").

type RoModalKey = 'flow_volume' | 'feed_pressure_psi' | 'permeate_tds' | 'recovery_pct';
type RoFlowMode = 'flow' | 'volume';
type RoGranularity = 'daily' | 'raw';

const RO_FLAGGED_STATUSES = new Set(['pending_review', 'retracted']);
const RO_FLAG_COLOR = 'hsl(38,92%,50%)';

const RO_GLANCE_METRICS: { key: string; label: string; unit: string; color: string; modalKey: RoModalKey; modalMode?: RoFlowMode }[] = [
  { key: 'permeate_flow',     label: 'Permeate Flow', unit: 'm³/h', color: 'hsl(174,72%,40%)', modalKey: 'flow_volume', modalMode: 'flow'   },
  { key: 'feed_pressure_psi', label: 'Feed Pressure', unit: 'psi',  color: 'hsl(216,72%,46%)', modalKey: 'feed_pressure_psi' },
  { key: 'permeate_tds',      label: 'Permeate TDS',  unit: 'ppm',  color: 'hsl(38,84%,52%)',  modalKey: 'permeate_tds' },
  { key: 'recovery_pct',      label: 'Recovery',      unit: '%',    color: 'hsl(150,60%,40%)', modalKey: 'recovery_pct' },
  { key: 'reject_flow',       label: 'Reject Flow',   unit: 'm³/h', color: 'hsl(0,65%,50%)',   modalKey: 'flow_volume', modalMode: 'flow'   },
  { key: 'permeate_volume',   label: 'Daily Volume',  unit: 'm³',   color: 'hsl(174,72%,40%)', modalKey: 'flow_volume', modalMode: 'volume' },
];

const RO_FLOW_METRICS: { key: string; label: string; color: string }[] = [
  { key: 'feed_flow',     label: 'Feed',     color: 'hsl(216,72%,46%)' },
  { key: 'permeate_flow', label: 'Permeate', color: 'hsl(174,72%,40%)' },
  { key: 'reject_flow',   label: 'Reject',   color: 'hsl(0,65%,50%)'   },
];

const RO_OTHER_METRICS: { key: string; label: string; unit: string; color: string }[] = [
  { key: 'feed_pressure_psi', label: 'Feed Pressure', unit: 'psi', color: 'hsl(216,72%,46%)' },
  { key: 'permeate_tds',      label: 'Permeate TDS',  unit: 'ppm', color: 'hsl(38,84%,52%)'  },
  { key: 'recovery_pct',      label: 'Recovery',      unit: '%',   color: 'hsl(150,60%,40%)' },
];

const RO_MODAL_META: Record<RoModalKey, { title: string; unit: string }> = {
  flow_volume:        { title: 'Flow & Volume',  unit: ''     },
  feed_pressure_psi:  { title: 'Feed Pressure',  unit: 'psi'  },
  permeate_tds:       { title: 'Permeate TDS',   unit: 'ppm'  },
  recovery_pct:       { title: 'Recovery',       unit: '%'    },
};

/** Highest clean (non-flagged) value across one or more series, floored so an
 *  all-null range still yields a sane axis instead of NaN/undefined. */
function cleanMax(rows: any[], keys: string[]): number {
  let max = 0;
  for (const r of rows) for (const k of keys) if (r[k] != null && r[k] > max) max = r[k];
  return max;
}

/** Flagged days rendered as a fixed-height marker just above the clean data —
 *  its height is capped, so it never re-scales the axis the way the excluded
 *  raw value would have. */
function flagMarkerData(rows: any[], markerY: number) {
  return rows.filter(r => r.flagged).map(r => ({ date: r.date, y: markerY }));
}

function RoFlagTooltip({ active, payload, label, unit, labelFormat = 'MMM d' }: any) {
  if (!active || !payload?.length) return null;
  const flaggedHit = payload.find((p: any) => p.dataKey === 'y');
  let shownLabel = label;
  try { shownLabel = format(parseISO(label), labelFormat); } catch { /* leave raw label if unparsable */ }
  if (flaggedHit) {
    return (
      <div className="rounded-md border bg-popover px-2 py-1.5 text-2xs shadow-md">
        <div className="font-medium">{shownLabel}</div>
        <div className="text-warn">Flagged reading — pending review, excluded from average</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-2xs shadow-md">
      <div className="font-medium mb-0.5">{shownLabel}</div>
      {payload.filter((p: any) => p.dataKey !== 'y').map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-1.5" style={{ color: p.color }}>
          <span>{p.name}: {fmtNum(p.value)}{unit ? ` ${unit}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** One compact glance card — same size and style as the original 2×3 grid.
 *  Clickable: opens the wider, detailed chart for this metric in a dialog. */
function RoGlanceTile({ m, rows, flaggedCount, onOpen }: {
  m: typeof RO_GLANCE_METRICS[number];
  rows: any[];
  flaggedCount: number;
  onOpen: () => void;
}) {
  const vals = rows.map(r => r[m.key]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const peak = Math.max(...vals);
  return (
    <button type="button" onClick={onOpen}
      className="group relative text-left rounded-lg border bg-muted/20 p-2.5 space-y-1.5 transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
      {flaggedCount > 0 && (
        <span className="absolute top-2.5 right-2.5 h-1.5 w-1.5 rounded-full"
          style={{ background: RO_FLAG_COLOR }}
          title={`${flaggedCount} flagged reading${flaggedCount === 1 ? '' : 's'} in range — click for detail`} />
      )}
      <div className="flex items-center justify-between gap-1 pr-3">
        <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide truncate">{m.label}</span>
        <span className="flex items-center gap-1 text-2xs text-muted-foreground shrink-0">
          {m.unit}
          <Maximize2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-mono font-semibold" style={{ color: m.color }}>{fmtNum(avg)}</span>
        <span className="text-2xs text-muted-foreground">avg · pk {fmtNum(peak)}</span>
      </div>
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}
            barSize={Math.max(2, Math.min(8, 200 / Math.max(rows.length, 1)))}>
            <Bar dataKey={m.key} fill={m.color} radius={[1, 1, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </button>
  );
}

/** Detail view for a single metric — wider, with a real axis and flagged markers.
 *  Opens in the dialog when a glance tile (other than the two flow tiles) is clicked. */
function RoDetailMetricChart({ m, rows }: { m: typeof RO_OTHER_METRICS[number]; rows: any[] }) {
  const vals = rows.map(r => r[m.key]).filter((v): v is number => v != null);
  if (!vals.length) return <p className="py-10 text-center text-sm text-muted-foreground">No readings in this period.</p>;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const peak = Math.max(...vals);
  const domainMax = Math.max(peak * 1.15, 1);
  const markerY = Math.max(peak * 1.08, domainMax * 0.9);
  const markers = flagMarkerData(rows, markerY);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-mono font-semibold" style={{ color: m.color }}>{fmtNum(avg)}</span>
        <span className="text-sm text-muted-foreground">{m.unit} avg · peak {fmtNum(peak)}</span>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
            barSize={Math.max(3, Math.min(20, 520 / Math.max(rows.length, 1)))}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
              tickFormatter={(d: string) => format(parseISO(d), 'MMM d')} interval="preserveStartEnd" minTickGap={50} />
            <YAxis domain={[0, domainMax]} width={44} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip content={<RoFlagTooltip unit={m.unit} />} />
            <Bar dataKey={m.key} fill={m.color} radius={[2, 2, 0, 0]} />
            {markers.length > 0 && <Scatter data={markers} dataKey="y" fill={RO_FLAG_COLOR} shape="diamond" legendType="none" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {markers.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-warn">
          <AlertTriangle className="h-3 w-3" />
          {markers.length} flagged reading{markers.length === 1 ? '' : 's'} in this period — excluded from the average above.
        </p>
      )}
    </div>
  );
}

/** Builds display rows for the Flow & Volume detail view.
 *  'daily' bucket-averages by calendar date, same rule as the glance grid.
 *  'raw' skips bucketing entirely and plots each reading at its own
 *  timestamp — useful for zooming into a single day, since readings are
 *  logged manually rather than on a fixed cadence. Flagged readings are
 *  excluded from both the same way: null in the series, surfaced via
 *  flagMarkerData() instead. */
function buildRoSeries(raw: any[], granularity: RoGranularity) {
  const cols = ['feed_flow', 'permeate_flow', 'reject_flow'];
  if (granularity === 'raw') {
    return raw.map(r => {
      const isFlagged = RO_FLAGGED_STATUSES.has(r.norm_status);
      const out: any = { date: r.reading_datetime, flagged: isFlagged };
      for (const c of cols) out[c] = !isFlagged && r[c] != null ? +r[c] : null;
      out.permeate_volume = !isFlagged && r.permeate_meter_delta != null && +r.permeate_meter_delta > 0 ? +r.permeate_meter_delta : null;
      return out;
    });
  }
  const byDate = new Map<string, any>();
  for (const r of raw) {
    const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, _count: 0, _flagged: false, perm_vol: 0 });
    const e = byDate.get(date)!;
    if (RO_FLAGGED_STATUSES.has(r.norm_status)) { e._flagged = true; continue; }
    e._count++;
    for (const c of cols) if (r[c] != null) e[c] = (e[c] ?? 0) + +r[c];
    if (r.permeate_meter_delta != null && +r.permeate_meter_delta > 0) e.perm_vol += +r.permeate_meter_delta;
  }
  return Array.from(byDate.values()).map(e => {
    const out: any = { date: e.date, flagged: e._flagged, permeate_volume: e._count > 0 ? +e.perm_vol.toFixed(2) : null };
    for (const c of cols) out[c] = e._count > 0 && e[c] != null ? +(e[c] / e._count).toFixed(2) : null;
    return out;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Flow & Volume detail dialog content — opens when Permeate Flow, Reject
 *  Flow, or Daily Volume is clicked on the glance grid. Has its own date
 *  range independent of the glance grid's 30/90/180/All pills, since the
 *  whole point is being able to zoom into a window those presets don't hit. */
function RoFlowVolumeDetail({ trainId, initialMode }: { trainId: string; initialMode: RoFlowMode }) {
  const [mode, setMode] = useState<RoFlowMode>(initialMode);
  const [granularity, setGranularity] = useState<RoGranularity>('daily');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({ from: subDays(new Date(), 29), to: new Date() });
  const [visible, setVisible] = useState<Set<string>>(new Set(RO_FLOW_METRICS.map(m => m.key)));

  const fromISO = dateRange.from.toISOString();
  const toISO = new Date(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate(), 23, 59, 59).toISOString();

  const { data: raw = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['train-ro-flow-volume', trainId, fromISO, toISO],
    queryFn: async () => {
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select('reading_datetime,feed_flow,permeate_flow,reject_flow,permeate_meter_delta,norm_status')
        .eq('train_id', trainId)
        .gte('reading_datetime', fromISO)
        .lte('reading_datetime', toISO)
        .order('reading_datetime', { ascending: true });
      return (data as any[]) ?? [];
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => buildRoSeries(raw, granularity), [raw, granularity]);
  const flaggedCount = rows.filter(r => r.flagged).length;
  const visibleFlowKeys = RO_FLOW_METRICS.map(m => m.key).filter(k => visible.has(k));
  const domainKeys = mode === 'volume' ? ['permeate_volume'] : visibleFlowKeys;
  const domainMax = Math.max(cleanMax(rows, domainKeys) * 1.15, 1);
  const markers = flagMarkerData(rows, domainMax * 0.94);
  const tickFormat = granularity === 'raw' ? 'MMM d, HH:mm' : 'MMM d';

  const toggleSeries = (key: string) => setVisible(prev => {
    const next = new Set(prev);
    if (next.has(key)) { if (next.size > 1) next.delete(key); } else next.add(key);
    return next;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs value={mode} onValueChange={(v) => setMode(v as RoFlowMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="flow" className="text-xs px-2.5">Flow Rate</TabsTrigger>
            <TabsTrigger value="volume" className="text-xs px-2.5">Volume</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['daily', 'raw'] as const).map(g => (
              <button key={g} onClick={() => setGranularity(g)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${granularity === g ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {g === 'daily' ? 'Daily avg' : 'Individual readings'}
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5">
                <CalendarIcon className="h-3 w-3" />
                {format(dateRange.from, 'MMM d')} – {format(dateRange.to, 'MMM d')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={(r: any) => { if (r?.from && r?.to) setDateRange({ from: r.from, to: r.to }); }}
                disabled={{ after: new Date() }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {mode === 'flow' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {RO_FLOW_METRICS.map(m => {
            const active = visible.has(m.key);
            return (
              <button key={m.key} onClick={() => toggleSeries(m.key)}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors"
                style={{
                  borderColor: active ? m.color : 'var(--border)',
                  color: active ? m.color : 'var(--muted-foreground)',
                  background: active ? 'var(--muted)' : 'transparent',
                }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? m.color : 'var(--muted-foreground)' }} />
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      <DataState loading={isLoading} error={error} isEmpty={rows.length === 0}
        emptyTitle="No readings in this window" onRetry={refetch} className="h-56">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
              barSize={mode === 'volume' ? Math.max(3, Math.min(20, 520 / Math.max(rows.length, 1))) : undefined}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(d: string) => format(parseISO(d), tickFormat)} interval="preserveStartEnd" minTickGap={50} />
              <YAxis domain={[0, domainMax]} width={44} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip content={<RoFlagTooltip unit={mode === 'volume' ? 'm³' : 'm³/h'} labelFormat={tickFormat} />} />
              {mode === 'volume' && <Bar dataKey="permeate_volume" fill="hsl(174,72%,40%)" radius={[2, 2, 0, 0]} />}
              {mode === 'flow' && RO_FLOW_METRICS.filter(m => visible.has(m.key)).map(m => (
                <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color}
                  strokeWidth={2} dot={granularity === 'raw'} connectNulls activeDot={{ r: 4 }} />
              ))}
              {markers.length > 0 && <Scatter data={markers} dataKey="y" fill={RO_FLAG_COLOR} shape="diamond" name="Flagged" legendType="none" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </DataState>

      {flaggedCount > 0 && (
        <p className="flex items-center gap-1 text-xs text-warn">
          <AlertTriangle className="h-3 w-3" />
          {flaggedCount} flagged reading{flaggedCount === 1 ? '' : 's'} in this window — shown as ◇, excluded from the line.
        </p>
      )}
      {granularity === 'raw' && (
        <p className="text-2xs text-muted-foreground">Readings are logged manually, not on a fixed schedule — each point sits at its actual log time.</p>
      )}
    </div>
  );
}

export function TrainRODetailCharts({ trainId, trainLabel }: { trainId: string; trainLabel: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');
  const [openMetric, setOpenMetric] = useState<RoModalKey | null>(null);
  const [openModalMode, setOpenModalMode] = useState<RoFlowMode>('flow');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['train-ro-detail', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select('reading_datetime,permeate_flow,feed_flow,reject_flow,feed_pressure_psi,reject_pressure_psi,permeate_tds,feed_tds,reject_tds,recovery_pct,permeate_meter_delta,temperature_c,norm_status')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];
      const avgCols = ['permeate_flow','feed_flow','reject_flow','feed_pressure_psi','reject_pressure_psi','permeate_tds','feed_tds','reject_tds','recovery_pct','temperature_c'];
      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date)) byDate.set(date, { date, _count: 0, _flagged: false, perm_vol: 0 });
        const e = byDate.get(date)!;
        // Flagged readings never contribute to a day's average/peak/volume —
        // they're excluded from the underlying numbers, not just hidden visually.
        if (RO_FLAGGED_STATUSES.has(r.norm_status)) { e._flagged = true; continue; }
        e._count++;
        for (const col of avgCols) if (r[col] != null) e[col] = (e[col] ?? 0) + +r[col];
        if (r.permeate_meter_delta != null && +r.permeate_meter_delta > 0) e.perm_vol += +r.permeate_meter_delta;
      }
      return Array.from(byDate.values()).map(e => {
        const out: any = {
          date: e.date,
          flagged: e._flagged,
          permeate_volume: e._count > 0 ? +e.perm_vol.toFixed(2) : null,
        };
        for (const col of avgCols) out[col] = e._count > 0 && e[col] != null ? +(e[col] / e._count).toFixed(2) : null;
        return out;
      }).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const flaggedCount = rows.filter(r => r.flagged).length;
  const openedOtherMetric = openMetric && openMetric !== 'flow_volume' ? RO_OTHER_METRICS.find(m => m.key === openMetric) : null;

  const exportCSV = () => {
    if (!rows.length) { toast.error('No data'); return; }
    const cols = ['date','feed_flow','permeate_flow','reject_flow','feed_pressure_psi','permeate_tds','recovery_pct','permeate_volume'];
    const header = [...cols, 'flagged'];
    const lines = rows.map(r => [...cols.map(c => r[c] ?? ''), r.flagged ? 'yes' : 'no'].join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${trainLabel.replace(/\s+/g, '_')}_ro_performance.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">RO Performance</span>
          {flaggedCount > 0 && (
            <span className="flex items-center gap-1 text-2xs text-warn">
              <AlertTriangle className="h-3 w-3" />
              {flaggedCount} flagged — click a chart for detail
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30', '90', '180', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV}>
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No readings in this period"
        onRetry={refetch}
        className="h-36"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {RO_GLANCE_METRICS.map(m => (
            <RoGlanceTile key={m.key} m={m} rows={rows} flaggedCount={flaggedCount}
              onOpen={() => { setOpenMetric(m.modalKey); if (m.modalMode) setOpenModalMode(m.modalMode); }} />
          ))}
        </div>
      </DataState>

      <Dialog open={!!openMetric} onOpenChange={(o) => !o && setOpenMetric(null)}>
        <DialogContent className="max-w-3xl w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{openMetric ? RO_MODAL_META[openMetric].title : ''} · {trainLabel}</span>
              {openMetric && RO_MODAL_META[openMetric].unit && (
                <span className="text-xs font-normal text-muted-foreground">{RO_MODAL_META[openMetric].unit}</span>
              )}
            </DialogTitle>
          </DialogHeader>
          {openMetric === 'flow_volume' && <RoFlowVolumeDetail trainId={trainId} initialMode={openModalMode} />}
          {openedOtherMetric && <RoDetailMetricChart m={openedOtherMetric} rows={rows} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

