import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { fmtNum, nrwColor } from '@/lib/calculations';
import { StatusPill } from '@/components/StatusPill';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { format, subDays, startOfDay } from 'date-fns';
import {
  Droplet, Activity, Zap, FlaskConical, AlertTriangle, Gauge, Thermometer,
  Waves, Cloud, Receipt, Banknote, LayoutGrid, ListCollapse, ExternalLink,
  ArrowUpRight, ArrowDownRight, Minus, CalendarDays,
} from 'lucide-react';
import { useTrainAutoOffline } from '@/hooks/useTrainAutoOffline';
import { DowntimeEventsModal } from '@/components/DowntimeEventsModal';
import { EnergyMixCard } from '@/components/EnergyMixCard';
import { BlendingVolumeCard } from '@/components/BlendingVolumeCard';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { calc } from '@/lib/calculations';
import {
  StatCard, PerWellSourceCard, ClusterHeader,
} from '@/components/dashboard/StatCard';
import {
  ClusterCharts, TrendModal,
} from '@/components/dashboard/TrendChart';
import { PowerChart } from '@/components/dashboard/PowerChart';
import {
  DashboardViewMode, VIEW_MODE_KEY, readSavedViewMode, pctDelta,
  OVERVIEW_CHART_METRICS, QUALITY_CHART_METRICS, COST_CHART_METRICS,
} from '@/components/dashboard/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// ─── DataSummaryModal ─────────────────────────────────────────────────────────

type SummaryTab = 'production' | 'consumption';

function resolveVolSummary(r: any): number {
  if (r.daily_volume != null && +r.daily_volume > 0) return +r.daily_volume;
  if (r.current_reading != null && r.previous_reading != null)
    return Math.max(0, +r.current_reading - +r.previous_reading);
  return 0;
}

function summaryPctDelta(today: number, yesterday: number): number | null {
  if (!yesterday) return null;
  return +((((today - yesterday) / yesterday) * 100).toFixed(1));
}

function DeltaIcon({ pct }: { pct: number | null }) {
  if (pct == null) return <Minus className="h-3 w-3 text-muted-foreground" />;
  if (pct > 0) return <ArrowUpRight className="h-3 w-3 text-emerald-500" />;
  return <ArrowDownRight className="h-3 w-3 text-rose-500" />;
}

function pctLabel(pct: number | null) {
  if (pct == null) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function dayBounds(ds: string) {
  return {
    start: new Date(ds + 'T00:00:00').toISOString(),
    end:   new Date(ds + 'T23:59:59').toISOString(),
  };
}

interface DataSummaryModalProps {
  open: boolean;
  onClose: () => void;
  plantIds: string[];
  plantCodeById: Map<string, string>;
}

function DataSummaryModal({ open, onClose, plantIds, plantCodeById }: DataSummaryModalProps) {
  const [tab, setTab]         = useState<SummaryTab>('production');
  const [dateStr, setDateStr] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  const prevDateStr = format(subDays(new Date(dateStr + 'T12:00:00'), 1), 'yyyy-MM-dd');
  const { start, end }         = dayBounds(dateStr);
  const { start: pStart, end: pEnd } = dayBounds(prevDateStr);
  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');

  // ── product meters (meta) ──────────────────────────────────────────────────
  const { data: productMeters } = useQuery({
    queryKey: ['summary-product-meters', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters } = await (supabase.from('product_meters' as any) as any)
        .select('id,name,plant_id').in('plant_id', plantIds);
      return (meters ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
  });

  const meterIds = useMemo(() => (productMeters ?? []).map((m: any) => m.id), [productMeters]);

  const { data: prodReadings, isLoading: prodLoading } = useQuery({
    queryKey: ['summary-prod-readings', meterIds, dateStr],
    queryFn: async () => {
      if (!meterIds.length) return [];
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime')
        .in('meter_id', meterIds).gte('reading_datetime', start).lte('reading_datetime', end)
        .order('reading_datetime', { ascending: false });
      return (data ?? []) as any[];
    },
    enabled: open && meterIds.length > 0,
  });

  const { data: prevProdReadings } = useQuery({
    queryKey: ['summary-prod-readings-prev', meterIds, prevDateStr],
    queryFn: async () => {
      if (!meterIds.length) return [];
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,daily_volume,current_reading,previous_reading')
        .in('meter_id', meterIds).gte('reading_datetime', pStart).lte('reading_datetime', pEnd);
      return (data ?? []) as any[];
    },
    enabled: open && meterIds.length > 0,
  });

  // ── locators (meta) ────────────────────────────────────────────────────────
  const { data: locators } = useQuery({
    queryKey: ['summary-locators', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase
        .from('locators').select('id,name,code,plant_id')
        .in('plant_id', plantIds).eq('active', true);
      return (data ?? []) as any[];
    },
    enabled: open && plantIds.length > 0,
  });

  const locatorIds = useMemo(() => (locators ?? []).map((l: any) => l.id), [locators]);

  const { data: consReadings, isLoading: consLoading } = useQuery({
    queryKey: ['summary-cons-readings', locatorIds, dateStr],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime')
        .in('locator_id', locatorIds).gte('reading_datetime', start).lte('reading_datetime', end)
        .order('reading_datetime', { ascending: false });
      return (data ?? []) as any[];
    },
    enabled: open && locatorIds.length > 0,
  });

  const { data: prevConsReadings } = useQuery({
    queryKey: ['summary-cons-readings-prev', locatorIds, prevDateStr],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading')
        .in('locator_id', locatorIds).gte('reading_datetime', pStart).lte('reading_datetime', pEnd);
      return (data ?? []) as any[];
    },
    enabled: open && locatorIds.length > 0,
  });

  // ── derived: production rows ───────────────────────────────────────────────
  const prodRows = useMemo(() => {
    const byMeter   = new Map<string, number>();
    const prevMeter = new Map<string, number>();
    (prodReadings    ?? []).forEach((r: any) => byMeter.set(r.meter_id,   (byMeter.get(r.meter_id)   ?? 0) + resolveVolSummary(r)));
    (prevProdReadings ?? []).forEach((r: any) => prevMeter.set(r.meter_id, (prevMeter.get(r.meter_id) ?? 0) + resolveVolSummary(r)));
    return (productMeters ?? []).map((m: any) => ({
      id: m.id, name: m.name ?? `Meter ${m.id.slice(-4)}`,
      plant: plantCodeById.get(m.plant_id) ?? m.plant_id,
      vol:   byMeter.get(m.id) ?? 0,
      delta: summaryPctDelta(byMeter.get(m.id) ?? 0, prevMeter.get(m.id) ?? 0),
    })).sort((a, b) => a.plant.localeCompare(b.plant) || a.name.localeCompare(b.name));
  }, [productMeters, prodReadings, prevProdReadings, plantCodeById]);

  const prodTotal     = prodRows.reduce((s, r) => s + r.vol, 0);
  const prevProdTotal = useMemo(() => {
    const m = new Map<string, number>();
    (prevProdReadings ?? []).forEach((r: any) => m.set(r.meter_id, (m.get(r.meter_id) ?? 0) + resolveVolSummary(r)));
    return Array.from(m.values()).reduce((s, v) => s + v, 0);
  }, [prevProdReadings]);

  // ── derived: consumption rows ──────────────────────────────────────────────
  const consRows = useMemo(() => {
    const byLoc   = new Map<string, number>();
    const prevLoc = new Map<string, number>();
    (consReadings    ?? []).forEach((r: any) => byLoc.set(r.locator_id,   (byLoc.get(r.locator_id)   ?? 0) + resolveVolSummary(r)));
    (prevConsReadings ?? []).forEach((r: any) => prevLoc.set(r.locator_id, (prevLoc.get(r.locator_id) ?? 0) + resolveVolSummary(r)));
    return (locators ?? []).map((l: any) => ({
      id: l.id, name: l.name ?? l.code ?? `Locator ${l.id.slice(-4)}`,
      code: l.code,
      plant: plantCodeById.get(l.plant_id) ?? l.plant_id,
      vol:        byLoc.get(l.id) ?? 0,
      delta:      summaryPctDelta(byLoc.get(l.id) ?? 0, prevLoc.get(l.id) ?? 0),
      hasReading: byLoc.has(l.id),
    })).sort((a, b) => a.plant.localeCompare(b.plant) || a.name.localeCompare(b.name));
  }, [locators, consReadings, prevConsReadings, plantCodeById]);

  const consTotal = consRows.reduce((s, r) => s + r.vol, 0);
  const nrwPct    = prodTotal > 0 ? +(((prodTotal - consTotal) / prodTotal) * 100).toFixed(1) : null;

  const prodByPlant = useMemo(() => {
    const m = new Map<string, typeof prodRows>();
    prodRows.forEach((r) => { if (!m.has(r.plant)) m.set(r.plant, []); m.get(r.plant)!.push(r); });
    return m;
  }, [prodRows]);

  const consByPlant = useMemo(() => {
    const m = new Map<string, typeof consRows>();
    consRows.forEach((r) => { if (!m.has(r.plant)) m.set(r.plant, []); m.get(r.plant)!.push(r); });
    return m;
  }, [consRows]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-2xl w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid="data-summary-modal"
      >
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Data Summary
              {isToday && (
                <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Today</span>
              )}
            </DialogTitle>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <CalendarDays className="h-3.5 w-3.5" />
              <input
                type="date"
                value={dateStr}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => e.target.value && setDateStr(e.target.value)}
                className="bg-transparent border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </label>
          </div>

          {/* KPI banner */}
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {/* Production KPI */}
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-muted-foreground">Production</span>
              <span className="text-sm font-semibold font-mono-num text-primary">{fmtNum(prodTotal)}</span>
              <span className="text-[10px] text-muted-foreground">m³</span>
              {summaryPctDelta(prodTotal, prevProdTotal) != null && (
                <span className={`flex items-center text-[10px] ${summaryPctDelta(prodTotal, prevProdTotal)! > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  <DeltaIcon pct={summaryPctDelta(prodTotal, prevProdTotal)} />
                  {pctLabel(summaryPctDelta(prodTotal, prevProdTotal))}
                </span>
              )}
            </div>
            <span className="text-muted-foreground text-xs">vs</span>
            {/* Consumption KPI */}
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-muted-foreground">Consumption</span>
              <span className="text-sm font-semibold font-mono-num text-highlight">{fmtNum(consTotal)}</span>
              <span className="text-[10px] text-muted-foreground">m³</span>
            </div>
            {/* NRW */}
            {nrwPct != null && (
              <>
                <span className="text-muted-foreground text-xs">·</span>
                <span className={`text-xs font-semibold ${nrwPct > 20 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  NRW {nrwPct}%
                  {nrwPct > 20 && (
                    <span className="ml-1 text-[10px] font-normal text-rose-500 bg-rose-50 dark:bg-rose-950/30 px-1 py-0.5 rounded">
                      above 20% limit
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b shrink-0 px-5">
          {(['production', 'consumption'] as SummaryTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t === 'production' ? 'Production' : 'Consumption (Locators)'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">

          {/* ── PRODUCTION TAB ── */}
          {tab === 'production' && (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Production = sum of <strong>Product Meter</strong> deltas (treated / distributed water output).
                Each row is one product meter, grouped by plant. % change is vs the prior day.
              </p>

              {prodLoading && <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>}
              {!prodLoading && prodRows.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">No product meter readings for this date.</div>
              )}

              {!prodLoading && Array.from(prodByPlant.entries()).map(([plant, rows]) => {
                const plantTotal = rows.reduce((s, r) => s + r.vol, 0);
                return (
                  <div key={plant}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{plant}</span>
                      <span className="text-[11px] font-mono-num text-muted-foreground">{fmtNum(plantTotal)} m³</span>
                    </div>
                    <div className="rounded-lg border divide-y overflow-hidden">
                      {rows.map((r) => (
                        <div key={r.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors">
                          <div className="w-2 h-2 rounded-full bg-primary/60 shrink-0" />
                          <span className="flex-1 min-w-0 truncate text-xs">{r.name}</span>
                          <span className="font-mono-num text-xs tabular-nums">
                            {r.vol > 0 ? fmtNum(r.vol) : <span className="text-muted-foreground">—</span>}
                          </span>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">m³</span>
                          <span className={`flex items-center gap-0.5 text-[10px] w-14 justify-end ${r.delta == null ? 'text-muted-foreground' : r.delta > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                            <DeltaIcon pct={r.delta} />
                            {pctLabel(r.delta)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {!prodLoading && prodRows.length > 0 && (
                <div className="flex items-center justify-between rounded-lg px-4 py-2.5 bg-muted/40 border mt-1">
                  <div className="flex items-center gap-2">
                    <Droplet className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold">Total Production</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono-num text-primary">{fmtNum(prodTotal)}</span>
                    <span className="text-xs text-muted-foreground">m³</span>
                    {summaryPctDelta(prodTotal, prevProdTotal) != null && (
                      <span className={`flex items-center text-[10px] ${summaryPctDelta(prodTotal, prevProdTotal)! > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        <DeltaIcon pct={summaryPctDelta(prodTotal, prevProdTotal)} />
                        {pctLabel(summaryPctDelta(prodTotal, prevProdTotal))}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── CONSUMPTION TAB ── */}
          {tab === 'consumption' && (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Consumption = sum of <strong>Locator meter</strong> deltas (billed / distributed water consumed by end-points).
                Each row is one active locator grouped by plant. Locators without a reading today show <em>—</em>.
                <span className="ml-1 font-medium text-foreground">
                  {consRows.filter((r) => r.hasReading).length}/{consRows.length} locators read today.
                </span>
              </p>

              {consLoading && <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>}
              {!consLoading && consRows.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">No locator readings for this date.</div>
              )}

              {!consLoading && Array.from(consByPlant.entries()).map(([plant, rows]) => {
                const plantTotal = rows.reduce((s, r) => s + r.vol, 0);
                const readCount  = rows.filter((r) => r.hasReading).length;
                return (
                  <div key={plant}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {plant}
                        <span className="ml-1.5 text-[10px] font-normal normal-case">({readCount}/{rows.length} read)</span>
                      </span>
                      <span className="text-[11px] font-mono-num text-muted-foreground">{fmtNum(plantTotal)} m³</span>
                    </div>
                    <div className="rounded-lg border divide-y overflow-hidden">
                      {rows.map((r) => (
                        <div
                          key={r.id}
                          className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors ${!r.hasReading ? 'opacity-50' : ''}`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${r.hasReading ? 'bg-highlight' : 'bg-muted-foreground/30'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs truncate">{r.name}</div>
                            {r.code && r.code !== r.name && (
                              <div className="text-[10px] text-muted-foreground">{r.code}</div>
                            )}
                          </div>
                          <span className="font-mono-num text-xs tabular-nums">
                            {r.vol > 0 ? fmtNum(r.vol) : <span className="text-muted-foreground">—</span>}
                          </span>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">m³</span>
                          <span className={`flex items-center gap-0.5 text-[10px] w-14 justify-end ${r.delta == null ? 'text-muted-foreground' : r.delta > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                            <DeltaIcon pct={r.delta} />
                            {r.hasReading ? pctLabel(r.delta) : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {!consLoading && consRows.length > 0 && (
                <div className="flex items-center justify-between rounded-lg px-4 py-2.5 bg-muted/40 border mt-1">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-3.5 w-3.5 text-highlight" />
                    <span className="text-xs font-semibold">Total Consumption</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono-num text-highlight">{fmtNum(consTotal)}</span>
                    <span className="text-xs text-muted-foreground">m³</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [modal, setModal] = useState<null | { metric: string; title: string }>(null);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // View mode controls how trend graphs surface on the dashboard.
  // See `components/dashboard/types.ts` for definitions. Lazy-init
  // from localStorage so the user's preference survives reload
  // without a flash of "inline".
  const [viewMode, setViewMode] = useState<DashboardViewMode>(readSavedViewMode);
  // In `sections` mode, this holds the metric key whose chart is
  // currently fold-open. Single-open behaviour — clicking another KPI
  // auto-collapses the previous. `inline` mode shows everything;
  // `popup` mode never sets this (it routes through `modal` instead).
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const persistViewMode = (m: DashboardViewMode) => {
    setViewMode(m);
    setExpandedMetric(null);
    setModal(null);
    try { window.localStorage.setItem(VIEW_MODE_KEY, m); } catch (err) {
      // Safari private mode / quota errors — view-mode just won't persist.
      // eslint-disable-next-line no-console
      console.warn('[Dashboard] could not persist view mode preference:', err);
    }
  };
  // Returns the click handler for chart-bearing KPI cards. Behaviour
  // depends on the current view mode:
  //   • inline   → no click action (chart is already on screen below)
  //   • sections → toggle this metric's collapsible chart (single-open)
  //   • popup    → open the TrendModal (existing behaviour)
  const handleMetricClick = (metric: string, title: string): (() => void) | undefined => {
    if (viewMode === 'inline') return undefined;
    return () => {
      if (viewMode === 'sections') {
        setExpandedMetric((prev) => (prev === metric ? null : metric));
      } else {
        setModal({ metric, title });
      }
    };
  };

  const visiblePlants = useMemo(
    () => (selectedPlantId ? plants?.filter((p) => p.id === selectedPlantId) : plants),
    [plants, selectedPlantId],
  );
  const plantIds = visiblePlants?.map((p) => p.id) ?? [];

  // Bug 4 fix: build today/yesterday boundaries in UTC using the local calendar date,
  // so that readings entered at e.g. 08:00 PST (= 00:00 UTC) are not pushed into yesterday.
  // We construct YYYY-MM-DD from local time and then parse it as a UTC midnight to avoid
  // the double-offset problem that startOfDay(new Date()).toISOString() causes in UTC+8.
  const _localDateStr = format(new Date(), 'yyyy-MM-dd');          // local calendar date
  const today     = new Date(_localDateStr + 'T00:00:00').toISOString();   // local midnight → ISO
  const yesterday = new Date(format(subDays(new Date(), 1), 'yyyy-MM-dd') + 'T00:00:00').toISOString();

  // ----- Today aggregates from raw tables -----
  const { data: todayLocators } = useQuery({
    queryKey: ['dash-loc-today', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('locator_readings').select('daily_volume,current_reading,previous_reading,plant_id')
          .in('plant_id', plantIds).gte('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  // Raw Water source (wells) — used for Raw Water stat card and NRW denominator
  const { data: todayWells } = useQuery({
    queryKey: ['dash-wells-today', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('well_readings').select('daily_volume,current_reading,previous_reading,plant_id')
          .in('plant_id', plantIds).gte('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  // Production = sum of Product Meter deltas (treated/distributed water)
  // Per spec: "Production is sum of Product Meter delta or m3"
  const { data: todayProductMeters } = useQuery({
    queryKey: ['dash-product-meters-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters } = await (supabase.from('product_meters' as any) as any)
        .select('id').in('plant_id', plantIds);
      const meterIds = (meters ?? []).map((m: any) => m.id);
      if (!meterIds.length) return [];
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('daily_volume,current_reading,previous_reading')
        .in('meter_id', meterIds)
        .gte('reading_datetime', today);
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
  });
  const { data: todayPower } = useQuery({
    queryKey: ['dash-power-today', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('power_readings').select('daily_consumption_kwh,plant_id')
          .in('plant_id', plantIds).gte('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  // ----- Yesterday aggregates (for trend deltas on highlighted KPIs) -----
  const { data: yLocators } = useQuery({
    queryKey: ['dash-loc-yest', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('locator_readings').select('daily_volume,current_reading,previous_reading')
          .in('plant_id', plantIds).gte('reading_datetime', yesterday).lt('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  const { data: yWells } = useQuery({
    queryKey: ['dash-wells-yest', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('well_readings').select('daily_volume,current_reading,previous_reading')
          .in('plant_id', plantIds).gte('reading_datetime', yesterday).lt('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  // Yesterday product meters for production trend delta
  const { data: yProductMeters } = useQuery({
    queryKey: ['dash-product-meters-yest', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters } = await (supabase.from('product_meters' as any) as any)
        .select('id').in('plant_id', plantIds);
      const meterIds = (meters ?? []).map((m: any) => m.id);
      if (!meterIds.length) return [];
      const { data } = await (supabase.from('product_meter_readings' as any) as any)
        .select('daily_volume,current_reading,previous_reading')
        .in('meter_id', meterIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today);
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
  });
  const { data: yPower } = useQuery({
    queryKey: ['dash-power-yest', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('power_readings').select('daily_consumption_kwh')
          .in('plant_id', plantIds).gte('reading_datetime', yesterday).lt('reading_datetime', today)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  const { data: latestRO } = useQuery({
    queryKey: ['dash-ro-recent', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('ro_train_readings')
          .select('permeate_tds,feed_tds,dp_psi,recovery_pct,permeate_ph,turbidity_ntu,plant_id,train_number,reading_datetime')
          .in('plant_id', plantIds).gte('reading_datetime', subDays(new Date(), 1).toISOString())
          .order('reading_datetime', { ascending: false })).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  // Today's production cost (chem + power)
  const { data: todayCosts } = useQuery({
    queryKey: ['dash-costs-today', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('production_costs').select('chem_cost,power_cost,total_cost,plant_id')
          .in('plant_id', plantIds).eq('cost_date', format(new Date(), 'yyyy-MM-dd'))).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });
  // Latest daily summary fallback per plant (today first, else latest)
  const { data: dailySummary } = useQuery({
    queryKey: ['dash-summary-recent', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('daily_plant_summary').select('*').in('plant_id', plantIds)
          .order('summary_date', { ascending: false }).limit(plantIds.length * 5)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });

  // Helper: resolve daily volume from stored daily_volume, falling back to current-previous
  // for historical rows that were saved before the daily_volume persistence fix.
  const resolveVol = (r: any): number => {
    if (r.daily_volume != null && +r.daily_volume > 0) return +r.daily_volume;
    if (r.current_reading != null && r.previous_reading != null)
      return Math.max(0, +r.current_reading - +r.previous_reading);
    return 0;
  };
  // Per spec:
  //   Production   = sum of Product Meter deltas (treated/distributed water output)
  //   Raw Water    = sum of Well meter deltas (groundwater pumped — used for NRW denominator)
  //   Consumption  = sum of Locator meter deltas (billed consumption)
  const rawWaterVol = (todayWells         ?? []).reduce((s, r: any) => s + resolveVol(r), 0);
  const production  = (todayProductMeters ?? []).reduce((s, r: any) => s + resolveVol(r), 0);
  const consumption = (todayLocators      ?? []).reduce((s, r: any) => s + resolveVol(r), 0);
  const kwh = (todayPower ?? []).reduce((s, r: any) => s + (r.daily_consumption_kwh ?? 0), 0);
  // NRW uses Production (product meter output) vs Consumption (locator billed)
  const nrw = calc.nrw(production, consumption);
  const pv = calc.pvRatio(kwh, production);

  const yRawWaterVol  = (yWells          ?? []).reduce((s, r: any) => s + resolveVol(r), 0);
  const yProduction   = (yProductMeters  ?? []).reduce((s, r: any) => s + resolveVol(r), 0);
  const yConsumption  = (yLocators       ?? []).reduce((s, r: any) => s + resolveVol(r), 0);
  const yKwh = (yPower ?? []).reduce((s, r: any) => s + (r.daily_consumption_kwh ?? 0), 0);
  const dProduction = pctDelta(production, yProduction);
  const dConsumption = pctDelta(consumption, yConsumption);
  const dRawWater = pctDelta(rawWaterVol, yRawWaterVol);
  const dKwh = pctDelta(kwh, yKwh);

  const nrwBreached = nrw != null && nrw > 20;
  // Bug 5: RO averages are now computed after roByTrain useMemo below (deduped per train).

  // Per-train latest snapshot — group `latestRO` by (plant_id, train_number)
  // and keep the most recent row per train (the query is already ordered
  // reading_datetime DESC, so the first row we encounter per key wins).
  // Used by the "Raw TDS / Raw NTU per train" breakdown lists in Quality.
  // Note: TDS and NTU are recorded at the RO-train level in this schema,
  // not the well level — we surface them here labelled as "Train N" with
  // the plant code so the user knows what they're looking at.
  const roByTrain = useMemo(() => {
    const seen = new Set<string>();
    const rows: any[] = [];
    (latestRO as any[] | undefined ?? []).forEach((r) => {
      const key = `${r.plant_id}__${r.train_number ?? '?'}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(r);
    });
    rows.sort((a, b) => {
      // Sort by plant_id then train_number for stable rendering across re-renders.
      if (a.plant_id !== b.plant_id) return String(a.plant_id).localeCompare(String(b.plant_id));
      return (a.train_number ?? 0) - (b.train_number ?? 0);
    });
    return rows;
  }, [latestRO]);

  // Bug 5 fix: recompute RO averages from deduplicated roByTrain so trains with more
  // readings per 24h window don't inflate/skew the aggregate values.
  const avgPermTds = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.permeate_tds ?? 0), 0) / roByTrain.length).toFixed(0)
    : null;
  const avgFeedTds = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.feed_tds ?? 0), 0) / roByTrain.length).toFixed(0)
    : null;
  const avgRecovery = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.recovery_pct ?? 0), 0) / roByTrain.length).toFixed(1)
    : null;
  const avgTurb = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.turbidity_ntu ?? 0), 0) / roByTrain.length).toFixed(2)
    : null;
  // Lookup helper for plant codes inside per-train rows. Falls back to the
  // raw plant_id when the plant list hasn't loaded yet so we never render
  // a blank label.
  const plantCodeById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p: any) => m.set(p.id, p.code ?? p.name ?? p.id));
    return m;
  }, [plants]);

  // Costs aggregate (today). Fallback to most recent daily_plant_summary row per plant for missing fields.
  const chemCost = (todayCosts ?? []).reduce((s, r: any) => s + (+r.chem_cost || 0), 0);
  const powerCost = (todayCosts ?? []).reduce((s, r: any) => s + (+r.power_cost || 0), 0);
  const productionCost = chemCost + powerCost;

  // Pull latest daily_plant_summary per plant (for blending, downtime, raw water)
  const latestPerPlant = useMemo(() => {
    const m = new Map<string, any>();
    (dailySummary ?? []).forEach((r: any) => { if (!m.has(r.plant_id)) m.set(r.plant_id, r); });
    return Array.from(m.values());
  }, [dailySummary]);
  const blending = latestPerPlant.reduce((s, r: any) => s + (+r.blending_m3 || 0), 0);
  const rawWater = latestPerPlant.reduce((s, r: any) => s + (+r.raw_water_consumption_m3 || 0), 0);

  const { data: chemInv } = useQuery({
    queryKey: ['dash-chem', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('chemical_inventory').select('*').in('plant_id', plantIds)).data ?? []
      : [],
    enabled: plantIds.length > 0,
  });

  const trainGaps = useTrainAutoOffline(plantIds);

  // Legacy RO/chem alerts (still useful, live-computed)
  const localAlerts: { tone: 'danger' | 'warn'; text: string }[] = [];
  trainGaps.forEach((g) => localAlerts.push({ tone: 'warn', text: `Train ${g.train_number} no reading ${g.hours_gap.toFixed(1)}h — auto-flagged Offline` }));
  (latestRO ?? []).forEach((r: any) => {
    if (r.dp_psi >= 40) localAlerts.push({ tone: 'danger', text: `DP alert: ${r.dp_psi} psi` });
    if (r.permeate_tds >= 600) localAlerts.push({ tone: 'danger', text: `TDS alert: ${r.permeate_tds} ppm` });
    if (r.permeate_ph != null && (r.permeate_ph < 6.5 || r.permeate_ph > 8.5)) localAlerts.push({ tone: 'warn', text: `pH out of range: ${r.permeate_ph}` });
  });
  (chemInv ?? []).forEach((c: any) => {
    if (c.current_stock < c.low_stock_threshold) localAlerts.push({ tone: 'warn', text: `Low stock: ${c.chemical_name}` });
  });

  // Unified alerts feed (downtime / blending / recovery) served from backend
  const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
  const { data: feed } = useQuery<{ count: number; alerts: any[] }>({
    queryKey: ['alerts-feed', selectedPlantId],
    queryFn: async () => {
      try {
        const qs = new URLSearchParams({ days: '30' });
        if (selectedPlantId) qs.set('plant_id', selectedPlantId);
        const res = await fetch(`${BASE}/api/alerts/feed?${qs.toString()}`);
        if (!res.ok) return { count: 0, alerts: [] };
        return res.json();
      } catch {
        return { count: 0, alerts: [] };
      }
    },
    refetchInterval: 60_000,
    retry: false,
  });
  const feedAlerts = feed?.alerts ?? [];

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {selectedPlantId ? visiblePlants?.[0]?.name : `All plants (${plants?.length ?? 0})`} · Today
            {' · Production '}
            <span className="font-mono-num text-foreground">{fmtNum(production)}</span>
            <span className="ml-0.5">m³</span>
            {' · '}
            <button
              onClick={() => setSummaryOpen(true)}
              className="underline underline-offset-2 text-primary hover:text-primary/80 transition-colors"
            >
              Data Summary
            </button>
          </p>
        </div>
        {/* View-mode toggle. Three layouts; choice persists to localStorage.
            Tooltip on each option spells out what it does so the icons aren't
            cryptic. The control is intentionally compact — sits in the page
            header, not the cluster headers, so switching modes never moves it. */}
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && persistViewMode(v as DashboardViewMode)}
          className="h-8 shrink-0"
          data-testid="dashboard-view-mode"
        >
          <ToggleGroupItem
            value="inline"
            className="h-7 px-2 text-[11px] data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title="Inline — all trend graphs visible directly on the dashboard, just scroll"
            aria-label="Inline view"
          >
            <LayoutGrid className="h-3 w-3 mr-1" /> Inline
          </ToggleGroupItem>
          <ToggleGroupItem
            value="sections"
            className="h-7 px-2 text-[11px] data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title="Sections — click a KPI card to fold/unfold its trend chart"
            aria-label="Sections view"
          >
            <ListCollapse className="h-3 w-3 mr-1" /> Sections
          </ToggleGroupItem>
          <ToggleGroupItem
            value="popup"
            className="h-7 px-2 text-[11px] data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title="Popup — click a KPI card to open its trend chart in a dialog"
            aria-label="Popup view"
          >
            <ExternalLink className="h-3 w-3 mr-1" /> Popup
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* NRW threshold alert banner */}
      {nrwBreached && (
        <div
          className="flex items-start gap-2 rounded-lg border border-rose-300/70 bg-gradient-to-r from-rose-50 to-rose-100/40 px-3 py-2 dark:from-rose-950/40 dark:to-rose-900/20 dark:border-rose-900/60 cursor-pointer hover:shadow-sm transition-shadow"
          onClick={() => setModal({ metric: 'nrw', title: 'NRW trend' })}
          data-testid="nrw-banner"
          role="button"
        >
          <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-rose-700 dark:text-rose-300">
              NRW Water Loss above threshold — {nrw}%
            </div>
            <div className="text-[11px] text-rose-700/80 dark:text-rose-300/80">
              Limit is 20%. Tap to open the NRW trend and investigate.
            </div>
          </div>
        </div>
      )}

      {/* ─── Cluster 1: Overview ─── */}
      {/* Order matches the spec (2026-07): Production Cost · Locators
          Consumption · NRW · Raw Water · Blending. Raw Water and
          Blending are now two separate tiles (previously combined in a
          single card) per user request. Production volume (m³) is
          surfaced in the page subheader so the underlying NRW math
          stays visible without spending a card on it. */}
      <ClusterHeader icon={Droplet} title="Overview" accent="text-primary" />
      <div className="grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard icon={Banknote} accent="text-accent" label="Production Cost"
          size="lg" calc
          calcTooltip="Production Cost = Power Cost + Chemical Cost (today)"
          value={`₱${fmtNum(productionCost, 0)}`}
          onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
        <StatCard icon={Receipt} accent="text-highlight" label="Locators Consumption" value={fmtNum(consumption)} unit="m³"
          trend={dConsumption}
          onClick={() => setSummaryOpen(true)} />
        <StatCard icon={Activity} label="NRW" value={nrw == null ? '—' : nrw} unit="%" tone={nrwColor(nrw)}
          size="lg" calc threshold="20%"
          calcTooltip="NRW % = (Production − Locator Consumption) ÷ Production × 100"
          onClick={handleMetricClick('nrw', 'NRW Trend')} />
        <StatCard icon={Droplet} accent="text-primary" label="Raw Water"
          value={fmtNum(rawWaterVol)} unit="m³" trend={dRawWater}
          onClick={handleMetricClick('rawwater', 'Raw Water (m³)')} />
        <StatCard icon={Waves} accent="text-violet-600" label="Blending"
          value={fmtNum(blending)} unit="m³" />
      </div>
      <ClusterCharts metrics={OVERVIEW_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="overview" />

      {/* ─── Cluster 2: Quality ─── */}
      {/* Spec order: Feed TDS · Product TDS · Raw TDS (per well source) ·
          Raw NTU (per well source). The Raw TDS / NTU tiles surface the
          aggregate headline plus a small breakdown labelled "per well
          source" — see PerWellSourceCard for the schema caveat (these
          are physically measured at the RO feed manifold which BLENDS
          multiple well sources, so each row represents one source line). */}
      <ClusterHeader icon={FlaskConical} title="Quality" accent="text-accent" subtitle="RO output" />
      <div className="grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard icon={Gauge} label="Feed TDS" value={avgFeedTds ?? '—'} unit="ppm" />
        <StatCard icon={FlaskConical} accent="text-accent" label="Product TDS" value={avgPermTds ?? '—'} unit="ppm"
          onClick={handleMetricClick('tds', 'Permeate TDS Trend')} />
        {/* Raw TDS · per well source — aggregate value above, list below */}
        <PerWellSourceCard
          icon={Gauge}
          label="Raw TDS"
          unit="ppm"
          aggregate={avgFeedTds}
          rows={roByTrain}
          field="feed_tds"
          plantCodeById={plantCodeById}
          testId="raw-tds-per-well-source"
        />
        <PerWellSourceCard
          icon={Cloud}
          label="Raw NTU"
          unit="NTU"
          aggregate={avgTurb}
          rows={roByTrain}
          field="turbidity_ntu"
          plantCodeById={plantCodeById}
          testId="raw-ntu-per-well-source"
          decimals={2}
        />
        <StatCard icon={Thermometer} label="Recovery" value={avgRecovery ?? '—'} unit="%"
          onClick={handleMetricClick('recovery', 'Recovery Trendline')} />
      </div>
      <ClusterCharts metrics={QUALITY_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="quality" />

      {/* ─── Cluster 3: Production Cost (Power + Chemical) ─── */}
      {/* Spec order: Power Cost · Chemical Cost · Power kWh · PV Ratio.
          The header doubles as the section title called out in the spec. */}
      <ClusterHeader icon={Zap} title="Production Cost (Power + Chemical)" accent="text-chart-6" subtitle="Today" />
      <div className="grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard icon={Zap} accent="text-chart-6" label="Power Cost"
          value={`₱${fmtNum(powerCost, 0)}`}
          onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
        <StatCard icon={FlaskConical} accent="text-highlight" label="Chemical Cost"
          value={`₱${fmtNum(chemCost, 0)}`}
          onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
        <StatCard icon={Zap} accent="text-chart-6" label="Power kWh" value={fmtNum(kwh)} unit="kWh"
          trend={dKwh} />
        <StatCard icon={Zap} accent="text-chart-6" label="PV Ratio" value={pv == null ? '—' : pv} unit="kWh/m³"
          calc threshold="1.2"
          calcTooltip="PV Ratio = Power kWh ÷ Production m³ (lower is more efficient)"
          onClick={handleMetricClick('pv', 'PV Ratio Trend')} />
      </div>
      <ClusterCharts metrics={COST_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="cost" />

      <Card className="p-3" data-testid="alerts-card">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-danger" />
          <h2 className="text-sm font-semibold">Active Alerts</h2>
          <span className="text-[10px] text-muted-foreground">
            {feedAlerts.length + localAlerts.length} active
          </span>
          {(feedAlerts.length + localAlerts.length) > 0 && <span className="pulse-dot ml-auto" />}
        </div>

        {/* Unified feed — downtime, blending, recovery */}
        {feedAlerts.length > 0 && (
          <div className="space-y-1.5 mb-2" data-testid="alerts-feed-list">
            {feedAlerts.slice(0, 8).map((a, i) => {
              const tone = a.severity === 'high' ? 'danger'
                : a.severity === 'medium' ? 'warn'
                : a.severity === 'low' ? 'accent'
                : 'info' as const;
              const kindLabel = a.kind === 'downtime' ? 'Downtime'
                : a.kind === 'blending' ? 'Blending'
                : 'Recovery';
              return (
                <button
                  key={`feed-${i}`}
                  className="w-full text-left flex items-start gap-2 text-xs hover:bg-muted/40 rounded px-1 py-1"
                  onClick={() => {
                    if (a.kind === 'downtime') setDowntimeOpen(true);
                  }}
                  data-testid={`alert-row-${a.kind}-${i}`}
                >
                  <StatusPill tone={tone as any}>{kindLabel}</StatusPill>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.title}</div>
                    {a.detail && <div className="text-muted-foreground truncate">{a.detail}</div>}
                  </div>
                  <span className="font-mono-num text-[10px] text-muted-foreground shrink-0 mt-0.5">{a.date}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Live-computed RO / chem / train gap alerts */}
        {localAlerts.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t">
            {localAlerts.slice(0, 5).map((a, i) => (
              <div key={`${a.tone}-${a.text}-${i}`} className="flex items-center gap-2 text-sm">
                <StatusPill tone={a.tone}>{a.tone}</StatusPill>
                <span className="text-xs">{a.text}</span>
              </div>
            ))}
          </div>
        )}

        {feedAlerts.length === 0 && localAlerts.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">All clear — no alerts</p>
        )}
      </Card>

      <Card className="p-3">
        <h2 className="text-sm font-semibold mb-2">Chemical stock</h2>
        <div className="space-y-2.5">
          {(chemInv ?? []).slice(0, 8).map((c: any) => {
            const pct = c.low_stock_threshold ? Math.min(100, (c.current_stock / (c.low_stock_threshold * 4)) * 100) : 0;
            return (
              <div key={c.id}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{c.chemical_name}</span>
                  <span className="font-mono-num">{c.current_stock} {c.unit}</span>
                </div>
                <Progress value={pct} className="h-1.5" />
              </div>
            );
          })}
          {!chemInv?.length && <p className="text-sm text-muted-foreground py-2 text-center">No inventory yet</p>}
        </div>
      </Card>

      <PowerChart plantIds={plantIds} />
      <EnergyMixCard plantIds={plantIds} />
      <BlendingVolumeCard plantIds={plantIds} />

      <TrendModal open={!!modal} onClose={() => setModal(null)} metric={modal?.metric ?? ''} title={modal?.title ?? ''} plantIds={plantIds} />
      <DowntimeEventsModal
        open={downtimeOpen}
        onClose={() => setDowntimeOpen(false)}
        plantId={selectedPlantId || undefined}
        plantName={selectedPlantId ? visiblePlants?.[0]?.name : 'All plants'}
      />
      <DataSummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        plantIds={plantIds}
        plantCodeById={plantCodeById}
      />
    </div>
  );
}
