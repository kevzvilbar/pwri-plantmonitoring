import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calc } from '@/lib/calculations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronsDown, ChevronsUp, BarChart2, Filter, X, Check, Search, Sun, Zap, Download, MoreVertical, MessageCircleOff, Rows3 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ComposedChart, Bar, BarChart, ReferenceLine, Area, AreaChart,
} from 'recharts';
import { format, subDays, startOfDay, addDays } from 'date-fns';
import { toast } from 'sonner';
import {
  ChartMetric, DashboardViewMode, RANGE_DAYS, RangeKey, TREND_Y_LABEL,
} from './types';
import { useAppStore } from '@/store/appStore';
import { reasonCategoryLabel, reasonEntityPrefix } from '@/lib/reasonCodes';
import {
  C_PRODUCTION, C_CONSUMPTION, C_NRW, C_RAWWATER, C_RECOVERY, C_TDS, C_GRID_PV,
} from '@/lib/chartColors';
// Phase 1 extraction (pwri-improvement-plan.md) — DRILL_COLORS/ModernChartLegend,
// the pivot/date helpers, and DataSummaryPopup used to be defined inline here.
// Split out so this file holds only the chart itself; see each module's own
// header comment for what moved where and why.
import { DRILL_COLORS, ModernChartLegend } from './TrendChartLegend';
import { buildEntityPivot, fillDateRange, fmtDateKey } from './TrendChartPivotShared';
import { DataSummaryPopup } from './TrendChartDataSummaryPopup';
// Foundation (Weekly-granularity improvement plan) — the shared
// bucketing/aggregation engine. See TrendChartAggregate.ts's header comment
// for why this buckets already-computed daily rows rather than raw readings.
import {
  buildTrendRows, buildEntityPivotRows, isGranularityUsable, rangeDaysBetween, getIsoWeekStart,
  type Granularity, type TrendFieldConfig,
} from './TrendChartAggregate';
// M2/M3 — shared granularity control, stack/group toggle, and drill
// interaction primitives (breadcrumb, drillable bar shape, legend isolate).
import {
  GranularityControl, StackToggle, readStackMode, writeStackMode, type StackMode,
  DrillBreadcrumb, type DrillCrumb, makeDrillableBarShape, toggleIsolateEntity,
  focusToRange, nextFinerGranularity, type DrillFocus,
} from './TrendChartDrill';

// ─── Drill mode ──────────────────────────────────────────────────────────────
// 'drillup' used to be a third state meaning "monthly view" — now that time
// granularity (viewGran) and entity breakdown (viewBreakdown) are fully
// decoupled (see the state block below), a chart is either showing the
// combined total ('default') or a per-entity breakdown ('drilldown') at
// WHATEVER granularity viewGran currently says, so the third state is gone.
type DrillMode = 'default' | 'drilldown';

// ─── Per-metric field aggregation config (Foundation — highest-risk item) ──
// Which chartData fields sum vs (weighted-)average when rolling daily rows
// up to weekly/monthly. Volumes sum; rates average, weighted by that day's
// production m³ (powerCost/chemCost/totalCost — ₱/m³) or sample count
// (recovery/tds — averaged across however many readings came in that day)
// wherever a weight is available, so summing raw ₱/samples and dividing by
// the bucket denominator gives the exact same answer as this weighted mean
// (see TrendChartAggregate.ts's header comment for the algebra). `nrw` is
// deliberately absent here — NRW% must be recomputed from the BUCKET's
// summed production/consumption, not averaged as an independent field (see
// where trendRows re-derives it below), or a week with one very-low-NRW day
// and one very-high-NRW day would average to a number that doesn't match
// that week's actual totals.
const TREND_FIELD_AGG: Record<string, TrendFieldConfig> = {
  production: {
    production: 'sum', consumption: 'sum',
    _meterReplacements: 'union', _permeateSourceNames: 'union',
  },
  nrw: {
    production: 'sum', consumption: 'sum',
    _meterReplacements: 'union', _permeateSourceNames: 'union',
  },
  rawwater: { rawwater: 'sum', _meterReplacements: 'union' },
  productionCost: {
    powerCost: { type: 'weighted-avg', weight: '_prodVolForCost' },
    chemCost: { type: 'weighted-avg', weight: '_prodVolForCost' },
    totalCost: { type: 'weighted-avg', weight: '_prodVolForCost' },
  },
  pv: { production: 'sum', kwh: 'sum', solarKwh: 'sum' },
  kwh: { kwh: 'sum', solarKwh: 'sum' },
  tds: { tds: { type: 'weighted-avg', weight: 'tdsSamples' } },
  recovery: { recovery: { type: 'weighted-avg', weight: 'recoverySamples' } },
};


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
  // All charts share a single range selection via the global store so
  // that picking 14D on one chart instantly syncs every other chart.
  const range = useAppStore((s) => s.chartRange);
  const from = useAppStore((s) => s.chartFrom);
  const to = useAppStore((s) => s.chartTo);
  const setRange = useAppStore((s) => s.setChartRange);
  const setChartCustomDates = useAppStore((s) => s.setChartCustomDates);
  const handleFromChange = (v: string) => setChartCustomDates(v, to);
  const handleToChange = (v: string) => setChartCustomDates(from, v);
  // Toggle for the inline data summary table
  const [showSummary, setShowSummary] = useState(false);

  // ── Supabase Realtime: immediate chart refresh on data insert ─────────────
  // Without this, the chart relied only on a 60-second refetchInterval poll.
  // Any INSERT/UPDATE/DELETE on the tables below triggers instant
  // invalidation of the relevant chart query, causing an immediate refetch.
  //
  // Tables watched:
  //   power_readings       — kWh bars + PV ratio + Production Cost power line
  //   chemical_dosing_logs — Production Cost chem line
  //   production_costs     — Production Cost chem line (legacy manual entry)
  //
  // We also re-invalidate ['trend-bill-multipliers'] and ['trend-power-config']
  // because a stale multiplier causes newly-inserted readings to show the raw
  // delta (e.g. "11") instead of the CT-multiplied value (e.g. "26,400 kWh").
  const queryClient = useQueryClient();
  const plantIdsKey = plantIds.join(',');
  useEffect(() => {
    if (!plantIds.length) return;

    // Use a per-invocation unique suffix so each effect run always gets a
    // brand-new Supabase channel instance. Without this, React StrictMode's
    // double-invoke causes the second run to call .channel(sameName) which
    // returns the already-subscribed channel from the first run, and then
    // .on('postgres_changes', ...) throws "cannot add callbacks after subscribe()".
    const uid = Math.random().toString(36).slice(2, 9);

    const powerCh = supabase
      .channel(`trend-rt-power-${plantIdsKey}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'power_readings' }, () => {
        queryClient.invalidateQueries({ queryKey: ['trend-power'] });
        queryClient.invalidateQueries({ queryKey: ['trend-bill-multipliers'] });
        queryClient.invalidateQueries({ queryKey: ['trend-power-config'] });
      })
      .subscribe();

    const chemCh = supabase
      .channel(`trend-rt-chem-${plantIdsKey}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chemical_dosing_logs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['trend-cost'] });
      })
      .subscribe();

    const costCh = supabase
      .channel(`trend-rt-cost-${plantIdsKey}-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_costs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['trend-cost'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(powerCh);
      supabase.removeChannel(chemCh);
      supabase.removeChannel(costCh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantIdsKey]);

  // ── Unified view state (production / nrw) ────────────────────────────────
  // Two FULLY INDEPENDENT axes:
  //   viewGran      → time granularity  (daily | weekly | monthly)
  //   viewBreakdown → entity grouping   (total | by-locator | by-source)
  //
  // BUG FIX (was: viewGran==='monthly' ? 'drillup' : viewBreakdown!=='total'
  // ? 'drilldown' : 'default'): that derivation let granularity silently
  // override breakdown — switching to Monthly forced the per-entity view
  // open even with "Total" selected, so "Total + Monthly" secretly showed
  // entities anyway. drillMode below now depends ONLY on viewBreakdown;
  // viewGran independently controls bucketing via buildTrendRows /
  // buildEntityPivotRows regardless of which drillMode is active. Weekly
  // slots in as a true third granularity because of that decoupling — it
  // doesn't need a bespoke "weekly total but also monthly entities" case.
  type ViewGran = Granularity; // 'daily' | 'weekly' | 'monthly'
  type ViewBreakdown = 'total' | 'by-locator' | 'by-source';
  const [viewGran, setViewGran] = useState<ViewGran>('daily');
  const [viewBreakdown, setViewBreakdown] = useState<ViewBreakdown>('total');
  const hasConsumptionDrill = metric === 'production' || metric === 'nrw';
  // Metrics whose primary series already flows through the shared chartData
  // pipeline get the Daily/Weekly/Monthly control "for free" (M4): rawwater,
  // productionCost, and pv had NO granularity control before this pass.
  // tds/recovery only inherit it in their own 'default' (non by-train,
  // non by-hour) sub-view — see roDrillMode below, which stays a separate
  // state machine on purpose (merging the three drill systems was ruled out
  // as more risk than this round needs).
  const usesSharedGranularity =
    hasConsumptionDrill || metric === 'rawwater' || metric === 'productionCost'
    || metric === 'pv' || metric === 'kwh' || metric === 'tds' || metric === 'recovery';

  const drillMode: DrillMode = viewBreakdown !== 'total' ? 'drilldown' : 'default';
  type ProdDrillSource = 'locator' | 'source';
  const prodDrillSource: ProdDrillSource = viewBreakdown === 'by-source' ? 'source' : 'locator';

  // ── Raw Water — By-well breakdown (M4, the deferred item now shipped) ──
  // Kept as its OWN state, deliberately NOT folded into ViewBreakdown/
  // hasConsumptionDrill: those are exercised by production/nrw's breakdown
  // logic across ~15 call sites, and reusing them here would mean every one
  // of those call sites needs to learn a third "is this a well?" branch to
  // stay correct. A small parallel pair of state variables is a few more
  // lines but touches zero existing production/nrw logic — much lower risk
  // for what is explicitly the lowest-priority line item in the plan.
  const [rawwaterBreakdown, setRawwaterBreakdown] = useState<'total' | 'by-well'>('total');
  const [selectedWellIds, setSelectedWellIds] = useState<Set<string> | null>(null);
  useEffect(() => { if (metric !== 'rawwater') { setRawwaterBreakdown('total'); setSelectedWellIds(null); } }, [metric]);

  // ── Stack vs grouped (M2) — only meaningful once entities/series render
  // as bars (Weekly/Monthly breakdown, NRW's own Production+Consumption
  // bars, kWh, Production Cost's composition view). Persisted per metric in
  // localStorage, same pattern as VIEW_MODE_KEY in types.ts.
  // kwh was already hardcoded stacked before this toggle existed, so its
  // default preserves that look; everything else (NRW bars, entity
  // breakdowns, Production Cost) was always grouped/lines, so THEIR default
  // preserves that instead — the toggle only changes what's possible, not
  // what a first-time viewer sees.
  const defaultStackModeFor = (m: string): StackMode => (m === 'kwh' ? 'stacked' : 'grouped');
  const [stackMode, setStackModeState] = useState<StackMode>(() => readStackMode(metric, defaultStackModeFor(metric)));
  useEffect(() => { setStackModeState(readStackMode(metric, defaultStackModeFor(metric))); }, [metric]);
  const setStackMode = (m: StackMode) => { setStackModeState(m); writeStackMode(metric, m); };

  // ── M3: local drill-focus — clicking a monthly/weekly bar narrows the
  // chart to that bucket at the next-finer granularity, WITHOUT touching
  // the shared global dashboard range (see TrendChartDrill.tsx's header
  // comment for why). Cleared by the breadcrumb or by re-clicking the
  // active bucket. Wired into Production/NRW and RO's By-train view; Plant
  // Health can reuse the same primitive next.
  const [drillFocus, setDrillFocus] = useState<DrillFocus | null>(null);
  useEffect(() => { if (viewGran === 'daily') setDrillFocus(null); }, [viewGran]);

  // Locator filter for drill modes — null means "all selected" (default)
  // When the user opens drill mode, all locators start selected.
  const [selectedLocatorIds, setSelectedLocatorIds] = useState<Set<string> | null>(null);
  const [locatorSearch, setLocatorSearch] = useState('');
  const [showLocatorFilter, setShowLocatorFilter] = useState(false);

  // ── Production Cost line toggles ─────────────────────────────────────────
  const [showPowerCostLine, setShowPowerCostLine] = useState(true);
  const [showChemCostLine,  setShowChemCostLine]  = useState(true);
  const [showTotalCostLine, setShowTotalCostLine] = useState(true);

  // ── kwh: Energy-mix source filter (Both / Solar / Grid) ─────────────────
  const [kwhSource, setKwhSource] = useState<'both' | 'solar' | 'grid'>('both');
  // Reset source filter whenever the user switches away from (and back to) kwh
  useEffect(() => { if (metric !== 'kwh') setKwhSource('both'); }, [metric]);

  // ── RO drill state (TDS / Recovery) ─────────────────────────────────────
  type RoDrillMode = 'default' | 'by-train' | 'by-hour';
  const [roDrillMode, setRoDrillMode] = useState<RoDrillMode>('default');
  useEffect(() => { setDrillFocus(null); }, [metric, viewBreakdown, roDrillMode, rawwaterBreakdown]);
  const hasRoDrill = metric === 'tds' || metric === 'recovery';
  const [selectedTrainIds, setSelectedTrainIds] = useState<Set<string> | null>(null);
  const [trainSearch, setTrainSearch] = useState('');
  const [showTrainFilter, setShowTrainFilter] = useState(false);

  // ── Plant Health drill state ─────────────────────────────────────────────
  // Four granularities: daily average (default), hourly slots, weekly
  // average (M4), monthly average. Plant Health pivots ro_train_readings
  // directly rather than going through chartData, so it keeps its own
  // slotKeyFn-based bucketing (buildPhHealthRows below) instead of
  // buildTrendRows — weekly reuses the same ISO Monday-start rule via
  // getIsoWeekStart so all bucketing on the dashboard agrees.
  type PhDrillMode = 'daily' | 'hourly' | 'weekly' | 'monthly';
  const [phDrillMode, setPhDrillMode] = useState<PhDrillMode>('daily');
  const hasPlantHealth = metric === 'plantHealth';

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
    const today = new Date();
    // Cap preset ranges to 23:59:59.999 of TODAY (local time) so that readings
    // whose UTC timestamp falls in the next calendar day — a common occurrence in
    // UTC+8 (Philippines) where midnight local = 16:00 UTC the previous day —
    // are excluded from the Supabase query entirely.
    // Custom range bypasses this cap intentionally (handled in the branch above).
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const start = startOfDay(subDays(today, days));
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      startKey: format(start, 'yyyy-MM-dd'),
      endKey: format(today, 'yyyy-MM-dd'),
    };
  }, [range, from, to]);

  // Inclusive day count of the active range — feeds isGranularityUsable so
  // Weekly/Monthly auto-disable on ranges too short to show more than a
  // sliver of a bucket (e.g. Weekly on 7D, Monthly on 30D).
  const rangeDays = useMemo(() => rangeDaysBetween(startKey, endKey), [startKey, endKey]);

  const needsWellReadings = metric === 'nrw' || metric === 'rawwater' || metric === 'pv' || metric === 'productionCost';
  const needsProductMeterReadings = metric === 'production' || metric === 'nrw' || metric === 'pv' || metric === 'productionCost';
  const needsLocReadings = metric === 'production' || metric === 'nrw';
  const needsRoReadings = metric === 'recovery' || metric === 'tds' || metric === 'plantHealth';
  // productionCost also needs power readings (kWh delta × multiplier) and tariffs (₱/kWh).
  // 'kwh' = Power Consumption & Energy Mix chart (Solar vs Grid stacked bars).
  const needsPowerReadings = metric === 'pv' || metric === 'productionCost' || metric === 'kwh';
  // production_costs stores chem_cost (₱ per day) — still used for chemical side.
  // Power cost is now computed live: daily_kwh × rate_per_kwh / production_m3.
  const needsCostReadings = metric === 'productionCost';
  // needsPermeateProduction: we may need permeate_meter_delta from ro_train_readings
  // as the production source for plants where permeate_is_production = true.
  const needsPermeateProduction = metric === 'production' || metric === 'nrw' || metric === 'pv' || metric === 'productionCost';

  // ── Entity name lookups — fetched once per plant selection ─────────────────
  const { data: wellNames } = useQuery({
    queryKey: ['entity-names-wells', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((w: any) => map.set(w.id, w.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsWellReadings,
  });

  const { data: locatorNames } = useQuery({
    queryKey: ['entity-names-locators', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((l: any) => map.set(l.id, l.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  const { data: productMeterNames } = useQuery({
    queryKey: ['entity-names-product-meters', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as never) as any)
        .select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((m: any) => map.set(m.id, m.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
  });

  // Plant names are used for power meter replacement messages and for the permeate-source
  // tooltip note when permeate_is_production = true.
  const { data: plantNames } = useQuery({
    queryKey: ['entity-names-plants', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').in('id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((p: any) => map.set(p.id, p.name));
      return map;
    },
    enabled: plantIds.length > 0 && (needsPowerReadings || needsPermeateProduction),
  });

  const supaSelect = async <T,>(table: string, cols: string) => {
    const { data, error } = await supabase.from(table as never).select(cols)
      .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as T[]) ?? [];
  };

  // ── BUG FIX: locator_readings has no plant_id column ─────────────────────
  // The previous implementation called supaSelect('locator_readings', ...)
  // which filtered by plant_id — a column that does NOT exist on that table.
  // This returned zero rows for every plant except SRP (which coincidentally
  // worked due to data characteristics), causing consumption = 0 for all
  // dates in the selected range (most visibly Jan 1 – Mar 21).
  //
  // Fix: two-step query that mirrors the pattern Dashboard.tsx already uses:
  //   Step 1 — resolve the locator IDs that belong to these plants (via the
  //             locators table, which DOES have plant_id).
  //   Step 2 — query locator_readings filtered by those locator IDs.
  //
  // The locator meta query is shared with the name-lookup query above but
  // we need the IDs before the readings query can run, so we keep it
  // separate and gate the readings query on the result.
  const { data: _locatorIdsForReadings } = useQuery({
    queryKey: ['trend-loc-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data } = await supabase
        .from('locators')
        .select('id')
        .in('plant_id', plantIds)
        .eq('status', 'Active');
      return (data ?? []).map((l: any) => l.id as string);
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  // Locators whose default_input_mode = 'direct' OR is_derived = true — the
  // latter covers residual/mirrored locators like the SRP↔Mambaling HAMAS
  // pair, whose current_reading is a computed residual or a manual override,
  // never a cumulative meter value. Passed into computeEntityDeltas/
  // buildEntityPivot below so the chart line, the Overview table, and the
  // Data Summary popup all agree with the Locator detail page's
  // EntityHistoryChart, instead of trusting locator_readings.daily_volume
  // (only guaranteed correct for fn_sweep_derived_meters()'s own writes,
  // which always zero previous_reading — not guaranteed for a manual
  // override entered through the normal reading form).
  const { data: _directLocatorIds } = useQuery({
    queryKey: ['trend-loc-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Set<string>();
      const { data } = await supabase
        .from('locators').select('id,default_input_mode,is_derived')
        .in('plant_id', plantIds).eq('status', 'Active');
      return new Set(
        (data ?? [])
          .filter((l: any) => l.default_input_mode === 'direct' || l.is_derived === true)
          .map((l: any) => l.id as string),
      );
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  const { data: locReadings, isFetching: fetchingLoc, error: errLoc, refetch: refetchLoc } = useQuery({
    queryKey: ['trend-loc', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const locatorIds = _locatorIdsForReadings ?? [];
      if (!locatorIds.length) return [];
      const { data, error } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) throw new Error(`locator_readings: ${error.message}`);
      return (data ?? []) as any[];
    },
    // Wait for locator IDs to resolve before fetching readings.
    enabled: plantIds.length > 0 && needsLocReadings && (_locatorIdsForReadings !== undefined),
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // Product meter readings — the treated-water output meters installed on
  // the product line. These are the authoritative source for Production volume,
  // distinct from well (raw water) meters and locator (distribution) meters.
  // The table is not in the generated Supabase types so we cast as `never`.
  const { data: productReadings, isFetching: fetchingProduct, error: errProduct, refetch: refetchProduct } = useQuery({
    queryKey: ['trend-product', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      // Try with is_meter_replacement first; fall back gracefully if column
      // doesn't exist in this deployment (field will be undefined → false).
      const { data, error } = await (supabase.from('product_meter_readings' as never) as any)
        // Bug fix: include daily_volume so computeEntityDeltas can use it directly,
        // matching how locator_readings are handled (avoids boundary-read delta = 0).
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id')
        .in('plant_id', plantIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      if (error) {
        if (error.message?.includes('is_meter_replacement')) {
          const { data: d2, error: e2 } = await (supabase.from('product_meter_readings' as never) as any)
            .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,plant_id')
            .in('plant_id', plantIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO);
          if (e2) throw new Error(`product_meter_readings: ${e2.message}`);
          return (d2 as any[]) ?? [];
        }
        throw new Error(`product_meter_readings: ${error.message}`);
      }
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // ── Well readings — fetch with well_id so deltas are scoped per well ────────
  // Operations.tsx saves well readings with well_id + plant_id but never
  // writes daily_volume. Raw Water must therefore be computed as the sum of
  // (current_reading − previous_reading) per well per day, excluding rows
  // flagged is_meter_replacement and the first reading after a replacement.
  // Fetching well_id here (instead of relying on plant_id alone) lets
  // computeEntityDeltas group correctly by individual meter rather than by
  // plant, preventing cross-well subtraction that produced the -4,853,089 bug.
  const { data: wellReadings, isFetching: fetchingWell, error: errWell, refetch: refetchWell } = useQuery({
    queryKey: ['trend-well', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>(
      'well_readings',
      'well_id,current_reading,previous_reading,daily_volume,reading_datetime,is_meter_replacement,plant_id',
    ),
    enabled: plantIds.length > 0 && needsWellReadings,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // ── BUG FIX: ro_train_readings may not have plant_id (same as locator_readings).
  // Two-step query: resolve train IDs for these plants first, then fetch readings
  // filtered by train_id. This mirrors the locator_readings fix above.
  // Also builds a trainId→plantId map used to route permeate_meter_delta back to
  // the correct plant when permeate_is_production is active.
  const { data: _roTrainMeta } = useQuery({
    queryKey: ['trend-ro-train-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { ids: [] as string[], trainPlantMap: new Map<string, string>() };
      const { data } = await (supabase.from('ro_trains' as never) as any)
        .select('id, plant_id')
        .in('plant_id', plantIds);
      const rows = data ?? [];
      const trainPlantMap = new Map<string, string>();
      rows.forEach((t: any) => trainPlantMap.set(t.id, t.plant_id));
      return { ids: rows.map((t: any) => t.id as string), trainPlantMap };
    },
    enabled: plantIds.length > 0,
  });
  const _roTrainIdsForReadings = _roTrainMeta?.ids;
  const _trainPlantMap = _roTrainMeta?.trainPlantMap ?? new Map<string, string>();

  const { data: roReadings, isFetching: fetchingRo, error: errRo, refetch: refetchRo } = useQuery({
    queryKey: ['trend-ro', metric, startKey, endKey, plantIds, _roTrainIdsForReadings],
    queryFn: async () => {
      const trainIds = _roTrainIdsForReadings ?? [];
      if (!trainIds.length) return [];

      // Attempt full select including the new columns added in the permeate-delta
      // migration (permeate_meter_prev, permeate_meter_delta).
      // permeate_production_date is intentionally excluded — date bucketing always
      // uses reading_datetime directly so every reading is attributed to the calendar
      // day it was actually recorded, with no cutoff-time shift.
      // If the DB hasn't been migrated yet those columns don't exist and Supabase
      // returns a schema-cache error — fall back to the legacy select so the chart
      // never breaks on un-migrated deployments.
      const FULL_SELECT   = 'train_id,recovery_pct,permeate_tds,permeate_meter,permeate_meter_prev,permeate_meter_delta,reading_datetime,is_meter_replacement';
      const LEGACY_SELECT = 'train_id,recovery_pct,permeate_tds,permeate_meter,reading_datetime,is_meter_replacement';
      const NEW_COLS = ['permeate_meter_prev', 'permeate_meter_delta'];
      const isNewColError = (msg: string) => NEW_COLS.some(c => msg.includes(c));

      const { data, error } = await (supabase.from('ro_train_readings' as never) as any)
        .select(FULL_SELECT)
        .in('train_id', trainIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) {
        if (isNewColError(error.message)) {
          const { data: d2, error: e2 } = await (supabase.from('ro_train_readings' as never) as any)
            .select(LEGACY_SELECT)
            .in('train_id', trainIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO)
            .order('reading_datetime', { ascending: true });
          if (e2) throw new Error(`ro_train_readings: ${e2.message}`);
          return (d2 ?? []) as any[];
        }
        throw new Error(`ro_train_readings: ${error.message}`);
      }
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0 && (needsRoReadings || needsPermeateProduction) && (_roTrainIdsForReadings !== undefined),
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // RO train name lookup — reuses the IDs already fetched above
  const { data: roTrainNames } = useQuery({
    queryKey: ['entity-names-ro-trains', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('ro_trains' as never) as any)
        .select('id, name')
        .in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((t: any) => map.set(t.id, t.name ?? `Train ${String(t.id).slice(-4)}`));
      return map;
    },
    enabled: plantIds.length > 0 && (needsRoReadings || needsPermeateProduction),
  });

  // ── Plant meter config — fetch permeate_is_production flag per plant ────────
  // The entire PlantMeterConfig is stored as a single JSONB blob in the `config`
  // column (not as individual columns) — mirrors usePlantMeterConfig in Plants.tsx.
  // permeate_is_production lives at config.permeate_is_production inside that blob.
  // Permeate production config per plant — includes cut-off and date range settings.
  // Returns both a Set (for fast membership checks) and a detailed Map for bucketing.
  const { data: permeateConfigData } = useQuery({
    queryKey: ['plant-meter-config-permeate', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id, permeate_is_production, config')
        .in('plant_id', plantIds);
      const permeateCounts = new Set<string>();
      // Plants in EXCLUSIVE permeate mode (ro_production_source === 'permeate')
      // measure the same water on their product meter as on the RO permeate
      // meter — Step 1 below must exclude their product-meter readings to avoid
      // double-counting. Plants in 'both' mode have two independent sources and
      // keep BOTH their product meter reading (Step 1) and their permeate delta
      // (Step 2) — they stay OUT of this set.
      const productExcluded = new Set<string>();
      (data ?? []).forEach((row: any) => {
        // permeate_is_production is a DB-trigger-maintained mirror of
        // config.permeate_is_production (see the plant_meter_config migration) —
        // checking both is harmless redundancy, not two independent signals.
        // ro_production_source is NOT part of this check: it describes intended
        // mode, not whether permeate is active right now. A plant can have
        // ro_production_source: 'both' while the switch is deliberately off (see
        // MeterConfig.tsx's "⚠ permeate switch off" warning) — treating
        // ro_production_source as a fallback here previously overrode that
        // explicit "off" and silently re-activated paused permeate production.
        const permeateOn = row.permeate_is_production === true || row.config?.permeate_is_production === true;
        if (permeateOn) permeateCounts.add(row.plant_id);
        // Requiring permeateOn here too: without it, a plant with
        // ro_production_source: 'permeate' but the switch paused would lose its
        // product meter AND get no permeate credit — zero production shown.
        if (row.config?.ro_production_source === 'permeate' && permeateOn) productExcluded.add(row.plant_id);
      });
      return { permeateCounts, productExcluded };
    },
    enabled: plantIds.length > 0 && needsPermeateProduction,
  });
  const permeateIsProductionPlants = permeateConfigData?.permeateCounts;
  const productExcludedPlants      = permeateConfigData?.productExcluded;


  // Power readings — fetches the full ordered history for each plant so
  // computeEntityDeltas can diff consecutive meter_reading_kwh values correctly.
  // We also grab one row BEFORE startISO (per plant) to seed the delta for
  // the very first in-window reading — without it the first bar is always 0.
  const { data: powerReadings, isFetching: fetchingPower, error: errPower, refetch: refetchPower } = useQuery({
    queryKey: ['trend-power', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      // Fetch in-window rows (standard path)
      const inWindow = await supaSelect<any>(
        'power_readings',
        'daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,multiplier,reading_datetime,is_meter_replacement,plant_id',
      );
      // For each plant, fetch the single most-recent row BEFORE the window to
      // establish a delta baseline for the first in-window reading.
      const preRows: any[] = [];
      await Promise.all(
        plantIds.map(async (pid) => {
          const { data } = await (supabase.from('power_readings' as never) as any)
            .select('daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,multiplier,reading_datetime,is_meter_replacement,plant_id')
            .eq('plant_id', pid)
            .lt('reading_datetime', startISO)
            .order('reading_datetime', { ascending: false })
            .limit(1);
          if (data?.[0]) preRows.push(data[0]);
        }),
      );
      // Merge pre-window rows at the front, then sort ascending so
      // computeEntityDeltas sees them in chronological order.
      return [...preRows, ...inWindow].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
    },
    enabled: plantIds.length > 0 && needsPowerReadings,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // Chemical cost comes from TWO sources which are merged per day:
  //   1. production_costs.chem_cost  — legacy manual entry (₱/day)
  //   2. chemical_dosing_logs — operator dosing records
  //      Uses calculated_cost when > 0, otherwise falls back to
  //      qty × unit_price (same logic as ROTrains dosing history display).
  //      Old records saved before prices were configured have calculated_cost = 0.
  //   Chem Cost (₱/m³) = total_chem_₱_per_day / production_m3
  const { data: costReadings, isFetching: fetchingCost, error: errCost, refetch: refetchCost } = useQuery({
    queryKey: ['trend-cost', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      // Fetch all three sources in parallel
      const [prodCostRes, dosingRes, pricesRes] = await Promise.all([
        supabase.from('production_costs')
          .select('cost_date,chem_cost,plant_id')
          .in('plant_id', plantIds)
          .gte('cost_date', startKey)
          .lte('cost_date', endKey),
        supabase.from('chemical_dosing_logs')
          .select('log_datetime,calculated_cost,plant_id,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg')
          .in('plant_id', plantIds)
          .gte('log_datetime', `${startKey}T00:00:00`)
          .lte('log_datetime', `${endKey}T23:59:59`),
        supabase.from('chemical_prices')
          .select('chemical_name,unit_price')
          .lte('effective_date', today)
          .order('effective_date', { ascending: false }),
      ]);
      if (prodCostRes.error) throw new Error(`production_costs: ${prodCostRes.error.message}`);
      if (dosingRes.error)   throw new Error(`chemical_dosing_logs: ${dosingRes.error.message}`);

      // Build price lookup map (first price per chemical name = most recent)
      const priceMap: Record<string, number> = {};
      for (const p of (pricesRes.data ?? []) as any[]) {
        // Strip "(unit)" suffix to get base name, same as ROTrains
        const base = (p.chemical_name as string).replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(p.chemical_name in priceMap)) priceMap[p.chemical_name] = +p.unit_price;
        if (!(base in priceMap))            priceMap[base]            = +p.unit_price;
      }

      // chemical_name → dosing quantity field (matches DOSING_KEYS in ROTrains)
      const DOSING_KEYS = [
        { key: 'chlorine_kg',    name: 'Chlorine'    },
        { key: 'smbs_kg',        name: 'SMBS'        },
        { key: 'anti_scalant_l', name: 'Anti Scalant'},
        { key: 'soda_ash_kg',    name: 'Soda Ash'    },
      ];

      // Build map: `${plant_id}|${yyyy-MM-dd}` → accumulated ₱
      const costMap = new Map<string, number>();

      // 1. Seed from production_costs (manual entries)
      for (const r of (prodCostRes.data ?? []) as any[]) {
        const k = `${r.plant_id}|${r.cost_date}`;
        costMap.set(k, (costMap.get(k) ?? 0) + +(r.chem_cost ?? 0));
      }

      // 2. Merge dosing logs — mirror ROTrains fallback: use calculated_cost
      //    when > 0, else compute live from qty × price
      for (const r of (dosingRes.data ?? []) as any[]) {
        const storedCost = +r.calculated_cost || 0;
        const liveCost   = DOSING_KEYS.reduce(
          (s, c) => s + (+r[c.key] || 0) * (priceMap[c.name] ?? 0), 0,
        );
        const cost = storedCost > 0 ? storedCost : liveCost;
        if (cost <= 0) continue;
        const dateKey = format(new Date(r.log_datetime), 'yyyy-MM-dd');
        const k = `${r.plant_id}|${dateKey}`;
        costMap.set(k, (costMap.get(k) ?? 0) + cost);
      }

      // Return flat array in the shape the accumulator below expects
      return Array.from(costMap.entries()).map(([key, chem_cost]) => {
        const [plant_id, cost_date] = key.split('|');
        return { plant_id, cost_date, chem_cost };
      });
    },
    enabled: plantIds.length > 0 && needsCostReadings,
    staleTime: 0,
    refetchInterval: 60_000,
  });

  // Power tariffs: rate_per_kwh (₱/kWh) effective on or before each day.
  // Source of truth: Costs → Power tab auto-derives this from each monthly bill.
  // For a given day, we use the latest tariff whose effective_date ≤ that day.
  // We fetch all tariffs in a wide window so we can look up per-day rates in JS.
  const { data: powerTariffs } = useQuery({
    queryKey: ['trend-power-tariffs', plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('power_tariffs')
        .select('plant_id,effective_date,rate_per_kwh,multiplier')
        .in('plant_id', plantIds)
        .order('effective_date', { ascending: true });
      if (error) throw new Error(`power_tariffs: ${error.message}`);
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsCostReadings,
  });

  // CT multiplier from electric_bills — mirrors PowerChart's authoritative multiplier source.
  // TrendChart's power-delta computation falls back to power_readings.multiplier, then to 1.
  // Adding the bill multiplier as an intermediate fallback matches PowerChart behaviour exactly,
  // ensuring the kwh bars are correct even when individual reading rows lack a multiplier value.
  // Only fetched for the `kwh` metric so other metrics don't pay the extra Supabase round-trip.
  const { data: billMultiplierMap } = useQuery({
    queryKey: ['trend-bill-multipliers', plantIds],
    queryFn: async () => {
      const map = new Map<string, number>();
      try {
        const { data } = await (supabase.from('electric_bills' as never) as any)
          .select('plant_id,multiplier')
          .in('plant_id', plantIds)
          .order('billing_month', { ascending: false });
        for (const b of (data ?? []) as any[]) {
          // Keep only the FIRST (most-recent) entry per plant — query is DESC by billing_month.
          if (!map.has(b.plant_id) && +(b.multiplier ?? 0) > 0)
            map.set(b.plant_id, +b.multiplier);
        }
      } catch { /* electric_bills table may not exist — silently default to row.multiplier */ }
      return map;
    },
    enabled: plantIds.length > 0 && metric === 'kwh',
    // staleTime 0: a stale multiplier causes newly-inserted readings to show
    // the raw meter delta instead of the CT-multiplied kWh value. Always
    // revalidate so the chart is correct immediately after any insert.
    staleTime: 0,
  });

  // Per-plant, per-meter CT multiplier arrays from plant_power_config.
  // Used by the power delta computation below (mirrors Plants.tsx priority order).
  // Falls back to billMultiplierMap / 1 when the table is absent.
  const { data: powerConfigMap } = useQuery({
    queryKey: ['trend-power-config', plantIds],
    queryFn: async () => {
      const map = new Map<string, number[]>();
      try {
        const { data } = await (supabase.from('plant_power_config' as never) as any)
          .select('plant_id,grid_meter_multipliers')
          .in('plant_id', plantIds);
        for (const cfg of (data ?? []) as any[]) {
          const mArr = cfg.grid_meter_multipliers;
          if (Array.isArray(mArr) && mArr.length > 0)
            map.set(cfg.plant_id, mArr.map((v: any) => +v > 0 ? +v : 1));
        }
      } catch { /* plant_power_config table may not exist — keep defaults */ }
      return map;
    },
    enabled: plantIds.length > 0 && metric === 'kwh',
    staleTime: 0,
  });

  const isFetching = fetchingLoc || fetchingWell || fetchingRo || fetchingPower || fetchingCost || fetchingProduct;
  const queryError = (errLoc || errWell || errRo || errPower || errCost || errProduct) as Error | null;
  // Only re-fires the query(ies) that actually failed — a locator fetch
  // succeeding shouldn't get re-run just because the RO one timed out.
  // "TypeError: Failed to fetch" (the error shape shown in the toast — see
  // App.tsx's queryCache.onError) is a browser-level failure to complete the
  // request at all (network drop, an ad-blocker/privacy extension blocking
  // the Supabase domain, a brief Supabase outage) — not a database or RLS
  // error, which would come back as a normal Postgrest error body instead.
  // React Query already retries once and re-fetches on reconnect
  // automatically, but until now there was no way to just try again by hand
  // without reloading the whole page.
  const retryFailedQueries = () => {
    if (errLoc) refetchLoc();
    if (errWell) refetchWell();
    if (errRo) refetchRo();
    if (errPower) refetchPower();
    if (errCost) refetchCost();
    if (errProduct) refetchProduct();
  };

  const chartData = useMemo(() => {
    // ── Tariff lookup: for each plant, sorted array of {effectiveDate, ratePerKwh} ─
    // Used to find the ₱/kWh rate active on a given day:
    //   latest tariff whose effective_date ≤ day's date.
    // If no tariff exists yet for a plant, cost will be null (not 0).
    const tariffsByPlant = new Map<string, { effectiveDate: string; ratePerKwh: number }[]>();
    (powerTariffs ?? []).forEach((t: any) => {
      if (!t.plant_id || t.rate_per_kwh == null) return;
      if (!tariffsByPlant.has(t.plant_id)) tariffsByPlant.set(t.plant_id, []);
      tariffsByPlant.get(t.plant_id)!.push({
        effectiveDate: t.effective_date,
        ratePerKwh: +t.rate_per_kwh,
      });
    });
    // Sort each plant's tariffs ascending by date (already ordered from DB, but ensure)
    tariffsByPlant.forEach((arr) => arr.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)));

    /** Look up the ₱/kWh rate for a given plant on a given yyyy-MM-dd date. */
    function getRateForDay(plantId: string, dateKey: string): number | null {
      const tariffs = tariffsByPlant.get(plantId);
      if (!tariffs || tariffs.length === 0) return null;
      // Find latest effective tariff ≤ dateKey
      let rate: number | null = null;
      for (const t of tariffs) {
        if (t.effectiveDate <= dateKey) rate = t.ratePerKwh;
        else break;
      }
      return rate;
    }

    const byDay = new Map<string, any>();
    const ensure = (d: string, sortKey: number) =>
      byDay.get(d) ?? byDay.set(d, {
        date: d, sortKey, isoDate: new Date(sortKey).toISOString(),
        production: 0, consumption: 0, rawwater: 0,
        recovery: 0, recoverySamples: 0,
        tds: 0, tdsSamples: 0, kwh: 0, solarKwh: 0,
        // Cost accumulators (raw ₱ amounts, divided by production at the end)
        _powerCostPeso: 0,      // ₱ from power: (grid_kwh × multiplier + solar_kwh) × rate_per_kwh
        _solarKwhForCost: 0,   // solar kWh added to power cost basis
        _chemCostPeso: 0,       // ₱ from chemical: chem_cost column in production_costs
        _hasTariff: false,      // true when at least one power reading had a valid tariff
        powerCost: null as number | null,   // ₱/m³  (computed in final map)
        chemCost: null as number | null,    // ₱/m³
        totalCost: null as number | null,   // ₱/m³  = powerCost + chemCost
        // _meterReplacements: list of human-readable entity names replaced on this day.
        _meterReplacements: [] as string[],
        // _permeateSourcePlants: set of plant IDs whose production came from the permeate
        // meter on this day. Populated only for plants with permeate_is_production = true.
        _permeateSourcePlants: null as Set<string> | null,
      }).get(d);

    // ── Unified meter-replacement-aware delta helper ────────────────────────
    // Used for ALL meter types: wells, locators, product meters, power.
    //
    // entityKeyField: the column that uniquely identifies an individual meter.
    //   • well_readings          → 'well_id'
    //   • locator_readings       → 'locator_id'
    //   • product_meter_readings → 'meter_id'
    //   • power_readings         → 'plant_id'  (one power meter per plant)
    //
    // Keying by the individual meter ID (not plant_id) prevents readings from
    // different meters at the same plant bleeding into each other's diff —
    // the root cause of the -4,853,089 / +885,406 spikes seen in Raw Water.
    //
    // dailyVolumeField: if the table stores a pre-computed daily volume column
    // (e.g. locator_readings.daily_volume), use it directly when present.
    // Wells and product meters don't have this column so pass null.
    //
    // Meter-replacement handling (matches Operations.tsx display logic):
    //   • REPL row (is_meter_replacement = true):
    //       delta = 0, new baseline = current_reading, flag entity as "afterRepl"
    //   • First non-REPL row after a REPL:
    //       delta = 0 (new meter has no valid predecessor yet), clear flag
    //   • All subsequent rows:
    //       delta = current_reading − last seen current_reading for that entity
    //
    // rawDelta is null when there is no predecessor (first reading in window,
    // or first after replacement) so the tooltip doesn't false-flag those as
    // negative readings.
    function computeEntityDeltas(
      readings: any[],
      entityKeyField: string,
      dailyVolumeField: string | null,
      options?: {
        skipAfterRepl?: boolean;
        // IDs (e.g. locator_id) whose default_input_mode = 'direct' —
        // current_reading already IS the period's volume for these. Mirrors
        // EntityHistoryChart.tsx's isDirectMode branch.
        directModeIds?: Set<string>;
      },
    ): { r: any; delta: number; rawDelta: number | null; isMeterReplacement: boolean }[] {
      // skipAfterRepl=true: the replacement row already sets lastReading to the
      // new meter's starting value, so the very next reading can diff against it
      // normally (e.g. RO permeate: repl=227,368 → next=228,106 → delta=737.7).
      // skipAfterRepl=false (default): the row immediately after a replacement is
      // zeroed as a safety net for meter types where the replacement reading may
      // not be a reliable baseline (locators, wells, product meters).
      const skipAfterRepl = options?.skipAfterRepl ?? false;
      const directModeIds = options?.directModeIds;

      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );

      const lastReading = new Map<string, number>(); // entityKey → last current_reading
      const afterRepl   = new Set<string>();          // entities whose next row is zeroed

      return sorted.map((r) => {
        const entityKey = r[entityKeyField] ?? r.plant_id ?? '__';
        const isMR      = !!r.is_meter_replacement;

        if (isMR) {
          lastReading.set(entityKey, +r.current_reading);
          if (!skipAfterRepl) afterRepl.add(entityKey);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
        }

        if (afterRepl.has(entityKey)) {
          lastReading.set(entityKey, +r.current_reading);
          afterRepl.delete(entityKey);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: false };
        }

        if (directModeIds?.has(entityKey)) {
          // Direct mode: current_reading already IS the period's volume — no
          // diff, no dependence on daily_volume/previous_reading.
          const delta = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
          lastReading.set(entityKey, +r.current_reading);
          return { r, delta, rawDelta: null, isMeterReplacement: false };
        }

        if (dailyVolumeField && r[dailyVolumeField] != null && !lastReading.has(entityKey)) {
          // Only trust the stored daily_volume for the FIRST row of this
          // entity within the fetched window, where there's no locally
          // walked predecessor to diff against — that stored value may
          // legitimately span >1 day if readings were skipped before the
          // window. Once a predecessor HAS been walked (below), always diff
          // live against it instead: daily_volume/previous_reading are
          // written once at insert time and never cascaded when an earlier
          // reading is later edited/deleted/replaced, so a downstream row can
          // keep pointing at a stale predecessor indefinitely. That's what
          // made Coke/Parkmall's Aug 7–10 daily_volume grow into a
          // cumulative-looking total instead of a single day's delta — see
          // the identical fix in DataSummaryModal.tsx's
          // computePivotFromReadingsNoCache.
          // Clamp to 0: a negative daily_volume means the stored value is corrupt
          // (e.g. a partial or rolled-back write). Pass-through was the root cause
          // of the −898K consumption spike on May 29 that also tanked the NRW chart.
          const storedVol = Math.max(0, +r[dailyVolumeField]);
          const delta     = storedVol;
          lastReading.set(entityKey, +r.current_reading);
          return { r, delta, rawDelta: null, isMeterReplacement: false };
        }

        if (!lastReading.has(entityKey)) {
          lastReading.set(entityKey, +r.current_reading);
          // If the DB stored previous_reading, compute the delta instead of returning 0.
          // Without this, the first reading in the fetch window (no prior in-memory row)
          // always shows 0, causing a false dip at the start of every range.
          if (r.previous_reading != null) {
            const rawDelta = +r.current_reading - +r.previous_reading;
            // Clamp: a backwards reading vs stored previous_reading (bad entry /
            // un-flagged reset) must not produce a negative delta. Matches
            // buildEntityPivot line 101: Math.max(0, current - prev).
            const delta    = Math.max(0, rawDelta);
            return { r, delta, rawDelta, isMeterReplacement: false };
          }
          // No previous_reading in DB → we genuinely don't know the delta for this
          // first row. Return null delta so the chart gaps rather than plots 0.
          return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
          // Note: isMeterReplacement=true here causes the caller to skip this point,
          // preventing a false zero at the start of a date window.
        }

        const rawDelta = +r.current_reading - lastReading.get(entityKey)!;
        // Clamp to 0: a meter reading that goes backwards is a bad entry or an
        // un-flagged meter reset. Propagating a negative tanks the chart
        // (e.g. Raw Water −1.1M spike on May 4–5). Matches buildEntityPivot.
        const delta    = Math.max(0, rawDelta);
        lastReading.set(entityKey, +r.current_reading);
        return { r, delta, rawDelta, isMeterReplacement: false };
      });
    }

    // ── Raw Water = sum of per-well deltas ─────────────────────────────────
    // Uses computeEntityDeltas for sequential in-memory delta tracking
    // (daily_volume priority → lastSeen sequential → DB previous_reading).
    // buildEntityPivot now uses the same strategy, so the chart line,
    // Overview table, and Per Well "Total Raw" are always consistent.
    computeEntityDeltas(wellReadings ?? [], 'well_id', null).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.rawwater += delta;
      if (isMeterReplacement) {
        const entityName = wellNames?.get(r.well_id) ?? r.well_id ?? 'Well';
        const label = `${entityName} Raw Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    // ── Production source routing ─────────────────────────────────────────────
    // Plants where permeate_is_production = true use the RO permeate meter delta
    // as their production volume instead of a dedicated product meter.
    // Multi-plant selections mix sources: Plant A → permeate delta, Plant B → product meter.
    // Both contributions accumulate into the same `production` field so the line
    // stays a single unified series.

    // Step 1: accumulate product meter readings for plants that use a product
    // meter — i.e. everyone EXCEPT plants in exclusive 'permeate' mode (whose
    // product meter reads the same water the RO permeate meter already counts
    // in Step 2). Plants in 'both' mode fall through here on purpose — their
    // product meter is a genuinely separate source and must be summed in.
    computeEntityDeltas(
      (productReadings ?? []).filter((r: any) => !(productExcludedPlants?.has(r.plant_id))),
      'meter_id',
      'daily_volume',
    ).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.production += delta;
      if (isMeterReplacement) {
        const entityName = productMeterNames?.get(r.meter_id) ?? r.meter_id ?? 'Product Meter';
        const label = `${entityName} Product Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    // Step 2: accumulate permeate meter deltas for plants where permeate_is_production = true.
    //
    // Uses permeate_meter_delta (pre-saved curr−prev) and reading_datetime for
    // date bucketing. The permeate_production_date / 00:20 cutoff rule has been
    // removed — a reading recorded on May 1 at any time counts as May 1 production,
    // consistent with the DataSummaryModal's Production and Prod vs Consum tabs.
    // Falls back to computeEntityDeltas when columns not yet populated (NULL).
    if (permeateIsProductionPlants && permeateIsProductionPlants.size > 0) {
      const hasSavedDelta = (roReadings ?? []).some(
        (r: any) => r.permeate_meter_delta != null && +r.permeate_meter_delta > 0,
      );

      if (hasSavedDelta) {
        // ── PRIMARY PATH ─────────────────────────────────────────────────────
        (roReadings ?? []).forEach((r: any) => {
          const plantId = _trainPlantMap.get(r.train_id);
          if (!plantId || !permeateIsProductionPlants.has(plantId)) return;

          // Skip replacement rows first — their saved delta is the old-meter→new-meter
          // jump (e.g. 72,691 → 227,368) which is not real production. The same-day
          // non-replacement row(s) already carry the valid pre-swap production delta
          // and will be summed in separately below.
          if (r.is_meter_replacement) return;

          const delta = r.permeate_meter_delta != null ? Math.max(0, +r.permeate_meter_delta)
            : r.permeate_meter != null && r.permeate_meter_prev != null
              ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
              : null;
          // Use === null so a legitimate delta of 0 is still plotted (don't skip it).
          if (delta === null) return;

          // Date bucketing: attribute each reading to the local calendar day it
          // was recorded. The old cut-off / production-period logic has been
          // removed system-wide — consistent with DataSummaryModal.
          const prodDateStr = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
          const prodDt = new Date(prodDateStr + 'T12:00:00'); // noon for stable sorting
          const key = format(prodDt, 'MMM d');
          const row = ensure(key, prodDt.getTime());
          row.production += delta;
          if (!row._permeateSourcePlants) row._permeateSourcePlants = new Set<string>();
          row._permeateSourcePlants.add(plantId);
        });
      } else {
        // ── FALLBACK PATH (permeate_meter_delta columns still NULL) ──────────
        // Use computeEntityDeltas on the raw cumulative permeate_meter odometer.
        //
        // CRITICAL: do NOT pre-filter out is_meter_replacement rows before
        // passing to computeEntityDeltas. If removed, lastReading for that train
        // stays at the old meter value. The next real reading on the new meter
        // (e.g. 227,368) then diffs against the old value (72,691) producing a
        // massive false spike (~154K m3).
        //
        // Instead, include replacement rows with current_reading = permeate_meter
        // (the new meter start value). computeEntityDeltas sees isMR=true and
        // resets lastReading to the new baseline. skipAfterRepl=true means the
        // immediately following reading diffs against that new baseline normally
        // (e.g. Mar 5: 228,106 − 227,368 = 737.7) instead of being zeroed.
        const permeateRoReadings = (roReadings ?? [])
          .filter((r: any) => {
            const plantId = _trainPlantMap.get(r.train_id);
            return plantId && permeateIsProductionPlants.has(plantId)
              && r.permeate_meter != null;
            // NOTE: is_meter_replacement rows are intentionally kept here
          })
          .map((r: any) => ({ ...r, current_reading: +r.permeate_meter }));

        computeEntityDeltas(permeateRoReadings, 'train_id', null, { skipAfterRepl: true }).forEach(({ r, delta, isMeterReplacement }) => {
          // replacement row and first post-replacement row both return delta=0
          if (delta === 0) return;
          if (isMeterReplacement) return;
          const plantId = _trainPlantMap.get(r.train_id)!;
          const dt = new Date(r.reading_datetime);
          const key = format(dt, 'MMM d');
          const row = ensure(key, dt.getTime());
          row.production += delta;
          if (!row._permeateSourcePlants) row._permeateSourcePlants = new Set<string>();
          row._permeateSourcePlants.add(plantId);
        });
      }
    }

    // Consumption = sum of locator (distribution/endpoint) meter deltas.
    // NOTE: locReadings are now fetched via locator_id (not plant_id) so all
    // plants return data correctly — see the two-step query above.
    computeEntityDeltas(locReadings ?? [], 'locator_id', 'daily_volume', { directModeIds: _directLocatorIds }).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.consumption += delta;
      if (isMeterReplacement) {
        const entityName = locatorNames?.get(r.locator_id) ?? r.locator_id ?? 'Locator';
        const label = `${entityName} Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    (roReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      if (r.recovery_pct != null) { row.recovery += +r.recovery_pct; row.recoverySamples += 1; }
      if (r.permeate_tds != null) { row.tds += +r.permeate_tds; row.tdsSamples += 1; }
    });

    // Power kWh — priority order mirrors the fixed Plants.tsx PowerConsumptionEnergyMix:
    //   1. Raw JSONB multi-meter delta × per-meter CT multiplier  ← live, never stale
    //   2. Raw single-meter delta × multiplierArr[0]              ← live, single-meter fallback
    //   3. daily_consumption_kwh                                  ← stored at write time; may be stale
    //   4. daily_grid_kwh                                         ← same fallback
    //
    // Rationale: daily_consumption_kwh is computed once when the reading is saved.
    // If the previous-reading baseline was wrong at that moment (meter change, backfill,
    // import ordering), the stored value is permanently wrong — causing chart spikes
    // that disagree with the "Last 7 readings" panel, which always recomputes live.
    // Computing from raw readings first keeps the chart consistent with that panel.
    {
      const sorted = [...(powerReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      // Per-plant tracking state (mirrors Plants.tsx prevGridMeter/prevGridReadings)
      const prevGridMeter    = new Map<string, number | null>();
      const prevGridReadings = new Map<string, Record<string, number> | null>();
      const afterGridRepl    = new Set<string>();

      for (const r of sorted) {
        const pid  = r.plant_id ?? '__';
        const isMR = !!r.is_meter_replacement;
        const gridCurrent = r.meter_reading_kwh != null ? +r.meter_reading_kwh : null;
        const rGmr = r.grid_meter_readings as Record<string, number> | null | undefined;

        if (isMR) {
          // Replacement row: zero this day, reset baseline for next delta
          prevGridMeter.set(pid, gridCurrent);
          prevGridReadings.set(pid, rGmr ?? null);
          afterGridRepl.add(pid);
          // Still record the meter replacement label so the tooltip shows it
          const dt = new Date(r.reading_datetime);
          if (dt >= new Date(startISO)) {
            const key = format(dt, 'MMM d');
            const row = ensure(key, dt.getTime());
            const entityName = plantNames?.get(pid) ?? pid ?? 'Plant';
            const label = `${entityName} Power Meter`;
            if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
          }
          continue;
        }

        let gridKwh = 0;
        // Per-meter multiplier array: plant_power_config wins, then billMultiplierMap scalar, then 1
        const multArr: number[] = powerConfigMap?.get(pid) ?? [
          +(r.multiplier ?? 0) > 0 ? +r.multiplier : (billMultiplierMap?.get(pid) ?? 1),
        ];

        if (!afterGridRepl.has(pid)) {
          const pGmr   = prevGridReadings.get(pid) ?? null;
          const pMeter = prevGridMeter.get(pid) ?? null;

          if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
            // Priority 1: multi-meter JSONB delta × per-meter CT multiplier
            let total = 0;
            for (const k of Object.keys(rGmr)) {
              const mi    = parseInt(k, 10);
              const mMult = multArr[mi] ?? multArr[0] ?? 1;
              if (pGmr[k] != null) total += (rGmr[k] - pGmr[k]) * mMult;
            }
            gridKwh = total;
          } else if (pMeter != null && gridCurrent != null) {
            // Priority 2: single-meter legacy — (curr − prev) × multArr[0]
            const rawDelta = gridCurrent - pMeter;
            gridKwh = rawDelta * (multArr[0] ?? 1);
          }

          // Priority 3 & 4: stored daily totals — only when no raw readings available.
          //
          // IMPORTANT multiplier note:
          //   • daily_grid_kwh   — stored post-multiplication (already × CT ratio).
          //                        Use as-is.
          //   • daily_consumption_kwh — stored as the raw meter delta (NOT multiplied)
          //                        when the reading was first saved (e.g. Δ = 11 while
          //                        the actual kWh = 11 × 2400 = 26,400). Applying
          //                        multArr[0] here matches what the Operations history
          //                        table shows and what the physical meter produces.
          //
          // Order: prefer daily_grid_kwh (already correct) → daily_consumption_kwh × mult.
          if (gridKwh === 0) {
            if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0)
              gridKwh = +r.daily_grid_kwh;
            else if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0)
              gridKwh = +r.daily_consumption_kwh * (multArr[0] ?? 1);
          }
        }
        afterGridRepl.delete(pid);
        prevGridMeter.set(pid, gridCurrent);
        prevGridReadings.set(pid, rGmr ?? null);

        // Only plot rows within the requested window
        const dt = new Date(r.reading_datetime);
        if (dt < new Date(startISO)) continue;

        const key = format(dt, 'MMM d');
        if (gridKwh > 0) {
          const row = ensure(key, dt.getTime());
          row.kwh += gridKwh;
        }

        // productionCost: accumulate ₱ power cost for this day
        if (metric === 'productionCost' && gridKwh > 0) {
          const dateKey = format(dt, 'yyyy-MM-dd');
          const rate = getRateForDay(pid, dateKey);
          if (rate != null) {
            const row = ensure(key, dt.getTime());
            const solarForCost = (r.daily_solar_kwh != null)
              ? Math.max(0, +r.daily_solar_kwh) : 0;
            row._solarKwhForCost += solarForCost;
            row._powerCostPeso   += gridKwh * rate;
            row._hasTariff        = true;
          }
        }
      }
    }

    // Accumulate daily_solar_kwh per day for the (Grid+Solar) PV ratio line.
    // Skips null/zero rows so the ratio stays null on days with no solar data.
    (powerReadings ?? []).forEach((r: any) => {
      if (r.daily_solar_kwh == null || r.is_meter_replacement) return;
      const solarVal = +r.daily_solar_kwh;
      if (solarVal <= 0) return;
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.solarKwh += solarVal;
    });

    // Chemical cost: chem_cost (₱/day) from production_costs table.
    // Operators log this manually in Costs → Rollup (or via CSV import).
    // Chem Cost (₱/m³) = chem_cost / production_m3  (computed in final map below)
    (costReadings ?? []).forEach((r: any) => {
      const dt = new Date(`${r.cost_date}T00:00:00`);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      const chem = +(r.chem_cost ?? 0);
      row._chemCostPeso += chem;
    });

    const sparseRows = Array.from(byDay.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _s, recoverySamples, tdsSamples, _powerCostPeso, _solarKwhForCost, _chemCostPeso, _hasTariff, _permeateSourcePlants, ...d }) => {
        // ── Production Cost formula ────────────────────────────────────────────
        // All three metrics expressed as ₱/m³ (unit cost):
        //   Power Cost  = (grid_kwh × multiplier + solar_kwh) × rate_per_kwh / production_m3
        //   Chem Cost   = chem_cost_₱                                         / production_m3
        //   Prod Cost   = Power Cost + Chem Cost
        //
        // _powerCostPeso already holds grid_kwh × rate_per_kwh.
        // _solarKwhForCost holds the day's solar kWh; we need its rate too.
        // Since solar shares the same tariff rate as grid on a given day, we
        // reuse the already-accumulated ratio: add solar × (rate implied by grid cost / grid kwh).
        // Simpler: store the rate alongside _powerCostPeso so we can apply it to solar.
        // For now, rate was applied per reading — solar cost = _solarKwhForCost already
        // has its rate baked in via _powerCostPeso accumulation below.
        //
        // NOTE: The solar contribution is added to _powerCostPeso at accumulation time.
        // _solarKwhForCost is tracked for informational purposes.
        // Total power cost ₱ = _powerCostPeso (grid cost) + solar cost (₱)
        // Solar cost ₱ is computed below using the average rate derived from grid readings.
        // ── Production volume denominator ─────────────────────────────────────
        // Priority: product meter readings → permeate meter → well readings (raw water).
        // Plants that have no product meter (e.g. direct abstraction wells) report
        // their output volume via well_readings, which accumulates into `d.rawwater`.
        // Using rawwater as fallback lets Power Cost (₱/m³) work for those plants
        // without requiring a separate product meter setup.
        const prodVol = d.production > 0 ? d.production
          : d.rawwater   > 0 ? d.rawwater
          : null;
        // Derive average rate from accumulated grid cost ÷ grid kWh (d.kwh).
        // Then apply that same rate to solar kWh.
        const gridKwh = d.kwh > 0 ? d.kwh : 0;
        const avgRate = (_hasTariff && gridKwh > 0) ? _powerCostPeso / gridKwh : null;
        const solarCostPeso = (avgRate != null && _solarKwhForCost > 0)
          ? _solarKwhForCost * avgRate : 0;
        const totalPowerCostPeso = _powerCostPeso + solarCostPeso;
        const powerCostPerM3 = (_hasTariff && prodVol != null)
          ? +(totalPowerCostPeso / prodVol).toFixed(4) : null;
        const chemCostPerM3  = (prodVol != null && _chemCostPeso > 0)
          ? +(_chemCostPeso  / prodVol).toFixed(4) : null;
        const totalCostPerM3 = (powerCostPerM3 != null || chemCostPerM3 != null)
          ? +((powerCostPerM3 ?? 0) + (chemCostPerM3 ?? 0)).toFixed(4) : null;
        return {
          ...d,
          recovery: recoverySamples ? +(d.recovery / recoverySamples).toFixed(1) : null,
          tds: tdsSamples ? Math.round(d.tds / tdsSamples) : null,
          nrw: calc.nrw(d.production, d.consumption),
          // ₱/m³ unit costs — null when data is missing
          powerCost: powerCostPerM3,
          chemCost:  chemCostPerM3,
          totalCost: totalCostPerM3,
          // _meterReplacements is already in ...d — preserved for the tooltip
          _permeateSourceNames: _permeateSourcePlants
            ? Array.from<string>(_permeateSourcePlants)
                .map((id) => plantNames?.get(id) ?? id)
                .sort()
            : [] as string[],
          // ── Weekly/Monthly rollup support (Foundation) ──────────────────
          // These three are read-only inputs to buildTrendRows' weighted-avg
          // aggregation (see TREND_FIELD_AGG above) — every existing daily
          // consumer of chartData simply ignores them. Without preserving
          // recoverySamples/tdsSamples/prodVol here, a weekly TDS or Cost
          // figure could only be a plain (wrong) average of daily averages
          // instead of the correctly volume/sample-weighted one.
          recoverySamples, tdsSamples, _prodVolForCost: prodVol,
        };
      });

    // ── Gap-fill: insert null-value stub rows for every calendar day that has
    // no readings (e.g. April when data spans Mar→May with a full month gap).
    // Without this, the chart line jumps across the gap and the Overview table
    // omits entire months.  We only fill when the window is ≤ 366 days to
    // avoid generating thousands of stubs for very long ranges.

    // ── Timezone safety: drop any row whose local date exceeds endKey.
    // When the user is in UTC+8 (Philippines), a reading stored at e.g.
    // 2026-05-17T16:00:00Z renders as May 18 00:00 local time, so it can
    // slip through the Supabase filter (which also uses endKey) and appear
    // as a future date in the chart. Capping here is the final safeguard.
    const boundedSparseRows = sparseRows.filter(
      (r) => format(new Date(r.isoDate), 'yyyy-MM-dd') <= endKey,
    );

    if (boundedSparseRows.length < 2) return boundedSparseRows;
    const firstDk = format(new Date(boundedSparseRows[0].isoDate), 'yyyy-MM-dd');
    const lastDk  = format(new Date(boundedSparseRows[boundedSparseRows.length - 1].isoDate), 'yyyy-MM-dd');
    const spanDays = (new Date(lastDk).getTime() - new Date(firstDk).getTime()) / 86_400_000;
    if (spanDays > 366) return boundedSparseRows;
    const sparseByDate = new Map(boundedSparseRows.map((r) => [format(new Date(r.isoDate), 'yyyy-MM-dd'), r]));
    const allCalDays = fillDateRange(firstDk, lastDk);
    return allCalDays.map((dk) => {
      if (sparseByDate.has(dk)) return sparseByDate.get(dk)!;
      const dt = new Date(dk + 'T00:00:00');
      return {
        date: format(dt, 'MMM d'),
        isoDate: dt.toISOString(),
        production: null, consumption: null, rawwater: null,
        recovery: null, tds: null, kwh: null, solarKwh: null,
        nrw: null, powerCost: null, chemCost: null, totalCost: null,
        _meterReplacements: [], _permeateSourceNames: [],
      };
    });
  }, [locReadings, wellReadings, productReadings, roReadings, powerReadings, costReadings, powerTariffs,
      billMultiplierMap, powerConfigMap, metric, wellNames, locatorNames, productMeterNames, plantNames,
      permeateIsProductionPlants, _trainPlantMap, endKey, _directLocatorIds]);

  // ── trendRows: chartData bucketed to the active granularity (M1 + M4) ────
  // chartData itself stays DAILY, unchanged, always — it's still what feeds
  // DataSummaryPopup's day-by-day pivot table. trendRows is the derived,
  // display-only weekly/monthly rollup used by the chart itself (and by the
  // kwh bars / PV tooltip / cost tooltip below it) whenever viewGran !=
  // 'daily'. nrw is re-derived from the BUCKET's summed production/
  // consumption rather than passed through TREND_FIELD_AGG, since NRW% is
  // not independently averageable (see TREND_FIELD_AGG's comment above).
  const trendRows = useMemo(() => {
    if (!usesSharedGranularity) return chartData;
    const fields = TREND_FIELD_AGG[metric];
    if (!fields) return chartData;
    const bucketed = buildTrendRows(chartData as any, {
      granularity: viewGran, fields, rangeStartKey: startKey, rangeEndKey: endKey,
    });
    if (metric === 'production' || metric === 'nrw') {
      return bucketed.map((r) => ({ ...r, nrw: calc.nrw((r.production as number) ?? 0, (r.consumption as number) ?? 0) }));
    }
    return bucketed;
  }, [chartData, usesSharedGranularity, viewGran, metric, startKey, endKey]);

  // Pre-filtered chart rows for the kwh stacked bar — mirrors PowerChart's
  // chartRows useMemo: maps source filter into solarKwh/gridKwh so bars with
  // value 0 are never emitted (avoids phantom bar space in recharts).
  // NOTE: must be declared AFTER trendRows (depends on it) to avoid a
  //       temporal dead zone ("Cannot access 'X' before initialization").
  const kwhChartRows = useMemo(() => {
    if (metric !== 'kwh') return [];
    return trendRows.map((d: any) => ({
      date:     d.date,
      solarKwh: kwhSource !== 'grid'  ? (d.solarKwh ?? 0) : 0,
      gridKwh:  kwhSource !== 'solar' ? (d.kwh      ?? 0) : 0,
      _partial: d._partial,
    }));
  }, [trendRows, kwhSource, metric]);

  // ── Drill-mode locator data ───────────────────────────────────────────────
  // drillEntities: full sorted list of {id, label, color} for all active locators.
  const drillEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (!hasConsumptionDrill) return [];
    const ids = Array.from(new Set((locReadings ?? []).map((r: any) => r.locator_id).filter(Boolean)));
    return ids
      .map((id, i) => ({
        id,
        label: locatorNames?.get(id) ?? `Locator ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [hasConsumptionDrill, locReadings, locatorNames]);

  // sourceDrillEntities: per production-source breakdown for production chart.
  // Uses RO Train permeate IDs when the plant has permeate_is_production=true,
  // otherwise uses dedicated product meter IDs — mirroring the main chart's
  // production accumulation logic exactly.
  const usePermeateForSource = (metric === 'production')
    && (productReadings ?? []).length === 0
    && (roReadings ?? []).length > 0;

  const sourceDrillEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (metric !== 'production') return [];
    if (usePermeateForSource) {
      // RO train permeate source
      const ids = Array.from(new Set((roReadings ?? []).map((r: any) => r.train_id).filter(Boolean)));
      return ids
        .map((id, i) => ({
          id,
          label: roTrainNames?.get(id) ?? `RO Train ${String(id).slice(-4)}`,
          color: DRILL_COLORS[i % DRILL_COLORS.length],
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    // Product meter source
    const ids = Array.from(new Set((productReadings ?? []).map((r: any) => r.meter_id).filter(Boolean)));
    return ids
      .map((id, i) => ({
        id,
        label: productMeterNames?.get(id) ?? `Meter ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, usePermeateForSource, productReadings, roReadings, productMeterNames, roTrainNames]);

  // activeEntities: locator or production source depending on prodDrillSource
  const activeEntities = metric === 'production' && prodDrillSource === 'source'
    ? sourceDrillEntities : drillEntities;

  // visibleEntities: subset of activeEntities that pass the current locator selection.
  // null selectedLocatorIds = all visible.
  const visibleEntities = useMemo(
    () => selectedLocatorIds === null
      ? activeEntities
      : activeEntities.filter((e) => selectedLocatorIds.has(e.id)),
    [activeEntities, selectedLocatorIds],
  );

  // filteredLocatorList: activeEntities filtered by search string (for the picker UI)
  const filteredLocatorList = useMemo(
    () => locatorSearch.trim() === ''
      ? activeEntities
      : activeEntities.filter((e) =>
          e.label.toLowerCase().includes(locatorSearch.trim().toLowerCase()),
        ),
    [activeEntities, locatorSearch],
  );

  // ── Raw Water — well entities + per-well pivot rows ─────────────────────
  // Same computeEntityDeltas/buildEntityPivot strategy chartData already
  // uses for the well-summed Total series (see the "Raw Water = sum of
  // per-well deltas" comment above) — this is the SAME data, just kept
  // per-well instead of summed, then run through the same
  // buildEntityPivotRows the Production/NRW breakdown uses for its
  // daily/weekly/monthly bucketing. No new fetch, no new delta logic.
  const wellEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (metric !== 'rawwater') return [];
    const ids = Array.from(new Set((wellReadings ?? []).map((r: any) => r.well_id).filter(Boolean)));
    return ids
      .map((id, i) => ({
        id,
        label: wellNames?.get(id) ?? `Well ${String(id).slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, wellReadings, wellNames]);

  const visibleWellEntities = useMemo(
    () => selectedWellIds === null ? wellEntities : wellEntities.filter((e) => selectedWellIds.has(e.id)),
    [wellEntities, selectedWellIds],
  );

  const wellEntityRows = useMemo(() => {
    if (metric !== 'rawwater' || rawwaterBreakdown !== 'by-well') return [];
    const sorted = [...(wellReadings ?? [])].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
    const { pivot, dateKeys } = buildEntityPivot(sorted, 'well_id');
    return buildEntityPivotRows(pivot, dateKeys, visibleWellEntities, viewGran, startKey, endKey);
  }, [metric, rawwaterBreakdown, wellReadings, visibleWellEntities, viewGran, startKey, endKey]);

  const handleWellLegendIsolate = (e: any) => {
    const id = e?.dataKey as string | undefined;
    if (!id) return;
    setSelectedWellIds((prev) => toggleIsolateEntity(prev, id, wellEntities.map((x) => x.id)));
  };

  // Helpers for the locator selector
  const allSelected = selectedLocatorIds === null || selectedLocatorIds.size === activeEntities.length;
  const noneSelected = selectedLocatorIds !== null && selectedLocatorIds.size === 0;

  function toggleLocator(id: string) {
    setSelectedLocatorIds((prev) => {
      const current = prev ?? new Set(activeEntities.map((e) => e.id));
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next.size === activeEntities.length ? null : next;
    });
  }

  function selectAllLocators() { setSelectedLocatorIds(null); }
  function clearAllLocators() { setSelectedLocatorIds(new Set()); }

  // entityRows: unified per-entity breakdown (Foundation) — replaces the
  // old drilldownData (daily-only, rendered as Lines) + drillupData
  // (monthly-only, rendered as Bars) pair. That split was exactly the
  // inconsistency the plan called out: "the by-locator/by-source breakdown
  // renders as lines at daily granularity but grouped bars at monthly."
  // One buildEntityPivotRows call now serves daily/weekly/monthly; the
  // chart-type choice (Line vs Bar) is made once at render time from
  // viewGran, not baked into which memo happened to run. The per-source
  // pivot-building logic (permeate delta rule, direct-mode locators,
  // product-meter IDs) is untouched — only the "how do these dateKeys
  // become chart rows" tail end was duplicated, and that's what moved into
  // the shared buildEntityPivotRows helper.
  const entityRows = useMemo(() => {
    if (!hasConsumptionDrill || drillMode !== 'drilldown') return [];
    const isSource = metric === 'production' && prodDrillSource === 'source';

    let pivot: Map<string, Map<string, number>>;
    let dateKeys: string[];

    if (isSource && usePermeateForSource) {
      // RO permeate pivot has its own delta rule (permeate_meter_delta, or
      // a manual current/prev diff) — doesn't fit buildEntityPivot as-is.
      const roSorted = [...(roReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const p = new Map<string, Map<string, number>>();
      roSorted.forEach((r: any) => {
        if (r.is_meter_replacement) return;
        const delta = r.permeate_meter_delta != null
          ? Math.max(0, +r.permeate_meter_delta)
          : r.permeate_meter != null && r.permeate_meter_prev != null
            ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
            : null;
        if (delta === null || delta === 0) return;
        const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
        const tid = r.train_id ?? '__';
        if (!p.has(dk)) p.set(dk, new Map());
        p.get(dk)!.set(tid, (p.get(dk)!.get(tid) ?? 0) + delta);
      });
      pivot = p;
      dateKeys = Array.from(p.keys()).sort();
    } else if (isSource) {
      const sorted = [...(productReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const built = buildEntityPivot(sorted, 'meter_id');
      pivot = built.pivot; dateKeys = built.dateKeys;
    } else {
      const sorted = [...(locReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const built = buildEntityPivot(sorted, 'locator_id', _directLocatorIds);
      pivot = built.pivot; dateKeys = built.dateKeys;
    }

    return buildEntityPivotRows(pivot, dateKeys, visibleEntities, viewGran, startKey, endKey);
  }, [hasConsumptionDrill, drillMode, prodDrillSource, metric, locReadings, productReadings, roReadings,
      usePermeateForSource, visibleEntities, _directLocatorIds, viewGran, startKey, endKey]);

  // ── RO drill helpers ─────────────────────────────────────────────────────
  // Full list of trains found in the fetched roReadings
  const roTrainEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (!hasRoDrill) return [];
    const ids = Array.from(new Set((roReadings ?? []).map((r: any) => r.train_id).filter(Boolean)));
    return ids
      .map((id, i) => ({
        id,
        label: roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [hasRoDrill, roReadings, roTrainNames]);

  const visibleTrainEntities = useMemo(
    () => selectedTrainIds === null
      ? roTrainEntities
      : roTrainEntities.filter((e) => selectedTrainIds.has(e.id)),
    [roTrainEntities, selectedTrainIds],
  );

  const filteredTrainList = useMemo(
    () => trainSearch.trim() === ''
      ? roTrainEntities
      : roTrainEntities.filter((e) =>
          e.label.toLowerCase().includes(trainSearch.trim().toLowerCase()),
        ),
    [roTrainEntities, trainSearch],
  );

  const allTrainsSelected = selectedTrainIds === null || selectedTrainIds.size === roTrainEntities.length;
  const noTrainsSelected  = selectedTrainIds !== null && selectedTrainIds.size === 0;

  function toggleTrain(id: string) {
    setSelectedTrainIds((prev) => {
      const current = prev ?? new Set(roTrainEntities.map((e) => e.id));
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next.size === roTrainEntities.length ? null : next;
    });
  }
  function selectAllTrains() { setSelectedTrainIds(null); }
  function clearAllTrains()  { setSelectedTrainIds(new Set()); }

  const valueKey = metric === 'tds' ? 'permeate_tds' : 'recovery_pct';
  const roUnit   = metric === 'tds' ? 'ppm' : '%';

  /** Build per-train daily-average drill data */
  // RO by-train breakdown — now Daily/Weekly/Monthly (M4's deferred item).
  // Each entity's daily figure is already a per-train AVERAGE (sum/count of
  // that train's readings that day), not a volume — summing daily averages
  // into a week would be meaningless. buildEntityPivotRows' 'weighted-avg'
  // mode instead takes Σ(value×sampleCount)/Σ(sampleCount), using a
  // companion weightPivot of each day's per-train sample count, so a week
  // with one noisy low-sample day doesn't skew the average as much as a
  // day with plenty of readings. _total comes back as a genuine fleet-wide
  // weighted average across all visible trains, for free.
  const roTrainDrillData = useMemo(() => {
    if (!hasRoDrill || roDrillMode !== 'by-train') return [];
    const readings = (roReadings ?? []).filter((r: any) => {
      if (!r.train_id) return false;
      return selectedTrainIds === null || selectedTrainIds.has(r.train_id);
    });
    // dateKey → trainId → { sum, count }
    const acc = new Map<string, Map<string, { sum: number; count: number }>>();
    readings.forEach((r: any) => {
      const val = r[valueKey];
      if (val == null) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!acc.has(dk)) acc.set(dk, new Map());
      const trainAcc = acc.get(dk)!;
      const tid = r.train_id;
      const prev = trainAcc.get(tid) ?? { sum: 0, count: 0 };
      trainAcc.set(tid, { sum: prev.sum + +val, count: prev.count + 1 });
    });
    const dateKeys = Array.from(acc.keys()).sort();
    if (dateKeys.length === 0) return [];

    // Daily average per train (unchanged math) — weightPivot carries each
    // day's sample count so weekly/monthly can weight correctly.
    const avgPivot = new Map<string, Map<string, number>>();
    const weightPivot = new Map<string, Map<string, number>>();
    acc.forEach((trainAcc, dk) => {
      const avgRow = new Map<string, number>();
      const wRow = new Map<string, number>();
      trainAcc.forEach(({ sum, count }, tid) => {
        avgRow.set(tid, +(sum / count).toFixed(metric === 'tds' ? 0 : 1));
        wRow.set(tid, count);
      });
      avgPivot.set(dk, avgRow);
      weightPivot.set(dk, wRow);
    });

    return buildEntityPivotRows(
      avgPivot, dateKeys, visibleTrainEntities, viewGran, startKey, endKey,
      { mode: 'weighted-avg', weightPivot },
    );
  }, [hasRoDrill, roDrillMode, roReadings, visibleTrainEntities, selectedTrainIds, valueKey, metric,
      viewGran, startKey, endKey]);

  /** Build hourly drill data — one row per actual datetime slot, in chronological
   *  order. Each slot label is "MMM d, ha" (e.g. "May 3, 1pm"). The value is the
   *  average across all visible trains that have a reading in that exact hour.
   *  Filtering by train selector controls which trains contribute to the average. */
  const roHourDrillData = useMemo(() => {
    if (!hasRoDrill || roDrillMode !== 'by-hour') return [];

    const readings = (roReadings ?? []).filter((r: any) => {
      if (selectedTrainIds !== null && r.train_id && !selectedTrainIds.has(r.train_id)) return false;
      return r[valueKey] != null;
    });

    // slotKey: "yyyy-MM-dd HH" — one bucket per calendar hour
    // ts is computed without mutating dt (dt.setMinutes mutates and returns ms)
    const acc = new Map<string, { sum: number; count: number; ts: number }>();
    readings.forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const slotKey = format(dt, 'yyyy-MM-dd HH');
      // Build a clean on-the-hour timestamp without mutating dt
      const slotTs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), 0, 0, 0).getTime();
      const prev = acc.get(slotKey) ?? { sum: 0, count: 0, ts: slotTs };
      acc.set(slotKey, { sum: prev.sum + +r[valueKey], count: prev.count + 1, ts: prev.ts });
    });

    const dec = metric === 'tds' ? 0 : 1;

    return Array.from(acc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([, { sum, count, ts }]) => {
        const dt = new Date(ts);
        return {
          // X-axis label: "May 3, 1pm"
          label: format(dt, 'MMM d, haaa').replace('am', 'am').replace('pm', 'pm'),
          value: +(sum / count).toFixed(dec),
        };
      });
  }, [hasRoDrill, roDrillMode, roReadings, selectedTrainIds, valueKey, metric]);

  // ── Plant Health data ────────────────────────────────────────────────────
  // Derived from ro_train_readings: for each time slot, count how many
  // distinct trains had ≥1 reading, divide by total trains for the plant(s).
  // totalTrains = _roTrainIdsForReadings.length (same scope as the readings query).

  const phTotalTrains = (_roTrainIdsForReadings ?? []).length;

  /** Build one health row per time slot from ro_train_readings.
   *  slotKeyFn: Date → grouping bucket key
   *  labelFn:   Date → X-axis display label */
  function buildPhHealthRows(
    readings: any[],
    slotKeyFn: (d: Date) => string,
    labelFn:   (d: Date) => string,
  ) {
    if (!phTotalTrains) return [] as {
      date: string; healthPct: number | null;
      onlineCount: number | null; offlineCount: number | null;
      totalTrains: number; offlineTrains: string[];
    }[];
    const acc = new Map<string, { trains: Set<string>; ts: number }>();
    readings.forEach((r: any) => {
      if (!r.train_id) return;
      const dt  = new Date(r.reading_datetime);
      const key = slotKeyFn(dt);
      if (!acc.has(key)) acc.set(key, { trains: new Set(), ts: dt.getTime() });
      acc.get(key)!.trains.add(r.train_id);
    });
    const allTrainIds  = new Set<string>(_roTrainIdsForReadings ?? []);
    const trainLabel   = (id: string) =>
      roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`;

    return Array.from(acc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([key, { trains, ts }]) => {
        const onlineCount  = trains.size;
        const totalTrains  = phTotalTrains;
        const offlineCount = Math.max(0, totalTrains - onlineCount);
        const healthPct    = totalTrains > 0
          ? Math.round((onlineCount / totalTrains) * 100) : null;
        const offlineTrains = Array.from<string>(allTrainIds)
          .filter(id => !trains.has(id))
          .map(trainLabel);
        const dt = new Date(ts);
        return {
          date: labelFn(dt),
          healthPct,
          onlineCount,
          offlineCount,
          totalTrains,
          offlineTrains,
          _slotKey: key,
        };
      });
  }

  const phDailyData = useMemo(() => {
    if (!hasPlantHealth) return [];
    return buildPhHealthRows(
      roReadings ?? [],
      (d) => format(d, 'yyyy-MM-dd'),
      (d) => format(d, 'MMM d'),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPlantHealth, roReadings, _roTrainIdsForReadings, roTrainNames, phTotalTrains]);

  const phHourlyData = useMemo(() => {
    if (!hasPlantHealth) return [];
    return buildPhHealthRows(
      roReadings ?? [],
      (d) => format(d, 'yyyy-MM-dd HH'),
      (d) => format(d, 'MMM d, haaa'),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPlantHealth, roReadings, _roTrainIdsForReadings, roTrainNames, phTotalTrains]);

  const phMonthlyData = useMemo(() => {
    if (!hasPlantHealth || !phTotalTrains) return [];
    // Aggregate daily health % per calendar month → average
    const dayAcc = new Map<string, Set<string>>();
    (roReadings ?? []).forEach((r: any) => {
      if (!r.train_id) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!dayAcc.has(dk)) dayAcc.set(dk, new Set());
      dayAcc.get(dk)!.add(r.train_id);
    });
    const monthAcc = new Map<string, { sumPct: number; count: number; ts: number }>();
    dayAcc.forEach((trains, dk) => {
      const mk  = dk.slice(0, 7);
      const pct = (trains.size / phTotalTrains) * 100;
      const ts  = new Date(dk + 'T00:00:00').getTime();
      const prev = monthAcc.get(mk) ?? { sumPct: 0, count: 0, ts };
      monthAcc.set(mk, { sumPct: prev.sumPct + pct, count: prev.count + 1, ts: prev.ts });
    });
    return Array.from(monthAcc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([, { sumPct, count, ts }]) => ({
        date:         format(new Date(ts), 'MMM yyyy'),
        healthPct:    Math.round(sumPct / count),
        onlineCount:  null as number | null,
        offlineCount: null as number | null,
        totalTrains:  phTotalTrains,
        offlineTrains: [] as string[],
        _slotKey:     '',
      }));
  }, [hasPlantHealth, roReadings, phTotalTrains]);

  // Weekly (M4) — same daily-health%-then-average pattern as phMonthlyData,
  // just bucketed by ISO Monday-start week (getIsoWeekStart) instead of
  // calendar month, so it agrees with every other weekly bucket on the
  // dashboard. Averaging each day's (trains-online / totalTrains) % across
  // the days in a week is mathematically identical to (sum of trains-online
  // that week) / (totalTrains × dayCount) — no separate weight needed since
  // the denominator (totalTrains) doesn't change day to day.
  const phWeeklyData = useMemo(() => {
    if (!hasPlantHealth || !phTotalTrains) return [];
    const dayAcc = new Map<string, Set<string>>();
    (roReadings ?? []).forEach((r: any) => {
      if (!r.train_id) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!dayAcc.has(dk)) dayAcc.set(dk, new Set());
      dayAcc.get(dk)!.add(r.train_id);
    });
    const weekAcc = new Map<string, { sumPct: number; count: number; ts: number; label: string }>();
    dayAcc.forEach((trains, dk) => {
      const dayDate = new Date(dk + 'T00:00:00');
      const weekStart = getIsoWeekStart(dayDate);
      const wk = format(weekStart, 'yyyy-MM-dd');
      const pct = (trains.size / phTotalTrains) * 100;
      const prev = weekAcc.get(wk) ?? { sumPct: 0, count: 0, ts: weekStart.getTime(), label: `Wk of ${format(weekStart, 'MMM d')}` };
      weekAcc.set(wk, { sumPct: prev.sumPct + pct, count: prev.count + 1, ts: prev.ts, label: prev.label });
    });
    return Array.from(weekAcc.values())
      .sort((a, b) => a.ts - b.ts)
      .map(({ sumPct, count, label }) => ({
        date:         label,
        healthPct:    Math.round(sumPct / count),
        onlineCount:  null as number | null,
        offlineCount: null as number | null,
        totalTrains:  phTotalTrains,
        offlineTrains: [] as string[],
        _slotKey:     '',
      }));
  }, [hasPlantHealth, roReadings, phTotalTrains]);

  const phActiveData = hasPlantHealth
    ? phDrillMode === 'hourly'  ? phHourlyData
    : phDrillMode === 'weekly' ? phWeeklyData
    : phDrillMode === 'monthly' ? phMonthlyData
    : phDailyData
    : [];



  // Custom tooltip — same look as Recharts default but:
  //  • Shows the true raw (unclamped) value for any field that was clamped to 0
  //  • When the zero was caused by a meter replacement, shows "🔧 [Name] was Replaced"
  //    instead of the generic "⚠️ Negative reading" warning
  //  • If both a replacement AND a genuine negative exist on the same day, shows both
  const NegativeAwareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    // Looks up from trendRows (not chartData) so this still resolves once
    // the chart is bucketed to Weekly/Monthly, where `label` is a bucket
    // label ("Wk of Aug 4" / "Aug 2026") rather than a daily one. union'd
    // _meterReplacements/_permeateSourceNames (see TREND_FIELD_AGG) mean a
    // mid-week replacement still surfaces on the bucket that contains it.
    const chartRow: any = trendRows.find((d: any) => d.date === label);
    const replacements: string[] = chartRow?._meterReplacements ?? [];
    const permeateSourceNames: string[] = chartRow?._permeateSourceNames ?? [];
    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 10,
        fontSize: 11,
        padding: '9px 12px',
        minWidth: 148,
        maxWidth: 300,
        boxShadow: 'var(--shadow-elev)',
        backdropFilter: 'blur(8px)',
      }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 12, letterSpacing: '-0.01em' }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ margin: '2px 0', color: entry.color ?? entry.stroke, fontWeight: 500 }}>
            {entry.name}:{' '}
            <span style={{ fontWeight: 700 }}>{entry.value != null ? entry.value.toLocaleString() : '—'}</span>
          </p>
        ))}
        {replacements.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
            {replacements.map((name) => (
              <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--warn))', marginBottom: 2 }}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>🔧</span>
                <span style={{ fontSize: 10, lineHeight: 1.4 }}>
                  <strong>{name} was Replaced</strong>
                </span>
              </div>
            ))}
          </div>
        )}
        {permeateSourceNames.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--muted-foreground))' }}>
            <span style={{ fontSize: 11, lineHeight: 1 }}>💧</span>
            <span style={{ fontSize: 10, lineHeight: 1.4, opacity: 0.85 }}>
              Source: Permeate meter ({permeateSourceNames.join(', ')})
            </span>
          </div>
        )}
      </div>
    );
  };

  const chartHeight = compact ? 'h-[200px]' : 'h-[340px]';

  // ── M3: click-to-drill handler — shared between NRW's default (Total)
  // bars and the entity-breakdown bars. Bar click → time-drills into that
  // bucket at the next-finer granularity (a month's bar → that month's
  // weeks; a week's bar → that week's days); clicking a DAILY bar in the
  // Total view instead opens the by-locator breakdown, matching "a day's
  // bar in NRW → that day's by-locator breakdown" from the plan. Wired
  // into Production/NRW first (the flagship case); TDS/Recovery and Plant
  // Health can reuse the same makeDrillableBarShape + this pattern.
  const handleDrillBarActivate = (payload: Record<string, unknown>) => {
    if (viewGran === 'daily') {
      if (drillMode === 'default') setViewBreakdown('by-locator');
      return;
    }
    const bucketIsoDate = payload.isoDate as string | undefined;
    if (!bucketIsoDate) return;
    setDrillFocus({
      bucketIsoDate,
      label: payload.date as string,
      fromGranularity: viewGran as 'monthly' | 'weekly',
    });
    setViewGran(nextFinerGranularity(viewGran as 'monthly' | 'weekly'));
  };

  const drillFocusRange = drillFocus ? focusToRange(drillFocus) : null;
  // Rows for whichever chart is currently drilled into a specific
  // week/month, narrowed to that bucket's calendar span. Both the
  // entity-breakdown bars and NRW's own Total bars read from this so a
  // drill click visibly narrows the x-axis instead of just relabeling it.
  const focusedTrendRows = drillFocusRange
    ? trendRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey)
    : trendRows;
  const focusedEntityRows = drillFocusRange
    ? entityRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey)
    : entityRows;

  const drillCrumbs: DrillCrumb[] = drillFocus
    ? [
        { label: range === 'CUSTOM' ? 'Custom range' : range, onSelect: () => setDrillFocus(null) },
        { label: drillFocus.label },
      ]
    : [];

  // Legend click → isolate a single entity; click it again to restore all.
  const handleLegendIsolate = (e: any) => {
    const id = e?.dataKey as string | undefined;
    if (!id) return;
    setSelectedLocatorIds((prev) => toggleIsolateEntity(prev, id, activeEntities.map((x) => x.id)));
  };

  // Format large numbers as 1.2K / 3.4M on the Y-axis so the axis
  // label doesn't eat into the chart area on narrow mobile screens.
  const formatYAxis = (value: number) => {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(value);
  };

  // PV tooltip — defined here (not inside JSX) so esbuild can parse it.
  // Shows Grid PV and (Grid+Solar) PV ratios plus the underlying Volume and
  // Power values so operators can see what is driving each day's ratio.
  const PvTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    // trendRows (not chartData) so this resolves once bucketed to
    // Weekly/Monthly — production/kwh/solarKwh are bucket sums, so the
    // ratio shown here is the bucket's true (kWh total)/(m³ total), not an
    // average of daily ratios.
    const row: any = trendRows.find((d: any) => d.date === label);
    if (!row) return null;
    const gridPv  = row.production > 0 ? +(row.kwh / row.production).toFixed(2) : null;
    const totalPv = row.production > 0 && (row.kwh + row.solarKwh) > 0
      ? +((row.kwh + row.solarKwh) / row.production).toFixed(2) : null;
    const hasSolar = row.solarKwh > 0;
    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8, fontSize: 11, padding: '8px 10px',
        minWidth: 200, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
      }}>
        <p style={{ margin: '0 0 5px', fontWeight: 600 }}>{label}</p>
        <p style={{ margin: '1px 0', color: C_GRID_PV }}>
          Grid PV: <strong>{gridPv != null ? `${gridPv} kWh/m³` : '0 kWh/m³'}</strong>
        </p>
        {hasSolar && (
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            (Grid+Solar) PV: <strong>{totalPv != null ? `${totalPv} kWh/m³` : '—'}</strong>
          </p>
        )}
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            Volume: <span>{row.production > 0 ? row.production.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' m³' : '—'}</span>
          </p>
          <p style={{ margin: '1px 0', color: C_GRID_PV }}>
            Grid Power: <span>{row.kwh > 0 ? row.kwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
          </p>
          <p style={{ margin: '1px 0', color: C_PRODUCTION }}>
            Solar: <span>{row.solarKwh > 0 ? row.solarKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Title, range buttons, and Data Summary tab on one compact row */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {title && (
          <span className="text-xs font-bold tracking-[-0.01em] w-full sm:w-auto sm:mr-1 shrink-0 text-foreground">{title}</span>
        )}
        {/* Range pills — compact size */}
        <div className="flex flex-nowrap items-center gap-0.5 shrink-0 sm:flex-wrap">
          {(['7D', '14D', '30D', '60D', '90D'] as RangeKey[]).map((r) => (
            <button key={r}
              onClick={() => setRange(r)}
              data-testid={`trend-range-${metric}-${r}`}
              className={[
                'px-2 text-2xs font-semibold transition-colors leading-none sm:h-5 sm:rounded-full',
                range === r
                  ? 'text-primary font-bold sm:bg-primary sm:text-white'
                  : 'text-muted-foreground hover:text-foreground sm:bg-muted/70 sm:border sm:border-border',
              ].join(' ')}
            >{r}</button>
          ))}
          <button
            onClick={() => setRange('CUSTOM')}
            data-testid={`trend-range-${metric}-CUSTOM`}
            className={[
              'px-2 text-2xs font-semibold transition-colors leading-none sm:h-5 sm:rounded-full',
              range === 'CUSTOM'
                ? 'text-primary font-bold sm:bg-primary sm:text-white'
                : 'text-muted-foreground hover:text-foreground sm:bg-muted/70 sm:border sm:border-border',
            ].join(' ')}
          >Custom</button>
          {range === 'CUSTOM' && (
            <div className="flex items-center gap-1 mt-1 w-full sm:w-auto sm:mt-0">
              <Input
                type="date"
                value={from}
                onChange={(e) => handleFromChange(e.target.value)}
                className="h-6 w-[110px] text-2xs px-1.5"
                data-testid={`trend-from-${metric}`}
              />
              <span className="text-2xs text-muted-foreground shrink-0">→</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => handleToChange(e.target.value)}
                className="h-6 w-[110px] text-2xs px-1.5"
                data-testid={`trend-to-${metric}`}
              />
            </div>
          )}
          {isFetching && (
            <span className="text-2xs text-muted-foreground ml-1">Loading…</span>
          )}
        </div>

        {/* Data Summary — opens a popup dialog (non-retractable) */}
        <button
          onClick={() => setShowSummary(true)}
          className="ml-auto shrink-0 px-1 text-2xs font-medium transition-colors leading-none text-muted-foreground hover:text-foreground sm:h-5 sm:px-2 sm:rounded sm:border sm:bg-muted sm:hover:bg-muted/80 sm:border-border"
          title="Open data summary table"
        >
          Data Summary
        </button>

        {/* ── Mobile ⋮ overflow — secondary controls ───────────────────────── */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="sm:hidden h-6 w-6 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
              title="More chart options"
              aria-label="More chart options"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-56 p-2.5 flex flex-col gap-3">
            {/* View + Breakdown — production / nrw */}
            {hasConsumptionDrill && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <div className="mb-2">
                  <GranularityControl value={viewGran} onChange={(g) => { setViewGran(g); setSelectedLocatorIds(null); setShowLocatorFilter(false); }} rangeDays={rangeDays} />
                </div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Breakdown</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => { setViewBreakdown('total'); setSelectedLocatorIds(null); setShowLocatorFilter(false); }}
                    className={['h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none', viewBreakdown === 'total' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>Total</button>
                  <button onClick={() => { setViewBreakdown('by-locator'); setSelectedLocatorIds(null); }}
                    className={['h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none', viewBreakdown === 'by-locator' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>By locator</button>
                  {metric === 'production' && (
                    <button onClick={() => { setViewBreakdown('by-source'); setSelectedLocatorIds(null); }}
                      className={['h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none', viewBreakdown === 'by-source' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>By source</button>
                  )}
                </div>
                {(viewBreakdown === 'total' ? metric === 'nrw' : viewGran !== 'daily') && (
                  <div className="mt-2">
                    <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                    <StackToggle value={stackMode} onChange={setStackMode} />
                  </div>
                )}
              </div>
            )}
            {/* View — pv (M4: granularity only, no breakdown available) */}
            {metric === 'pv' && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} />
              </div>
            )}
            {/* View + Breakdown — raw water (By-well, M4) */}
            {metric === 'rawwater' && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <div className="mb-2">
                  <GranularityControl value={viewGran} onChange={(g) => { setViewGran(g); setSelectedWellIds(null); }} rangeDays={rangeDays} />
                </div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Breakdown</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => { setRawwaterBreakdown('total'); setSelectedWellIds(null); }}
                    className={['h-6 px-2 rounded text-2xs font-medium border', rawwaterBreakdown === 'total' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Total</button>
                  <button onClick={() => setRawwaterBreakdown('by-well')}
                    className={['h-6 px-2 rounded text-2xs font-medium border', rawwaterBreakdown === 'by-well' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground border-border'].join(' ')}>By well</button>
                </div>
                {rawwaterBreakdown === 'by-well' && viewGran !== 'daily' && (
                  <div className="mt-2">
                    <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                    <StackToggle value={stackMode} onChange={setStackMode} />
                  </div>
                )}
              </div>
            )}
            {/* View + Breakdown — tds / recovery */}
            {hasRoDrill && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  <GranularityControl
                    value={roDrillMode === 'by-hour' ? 'daily' : viewGran}
                    onChange={(g) => {
                      setViewGran(g);
                      // Hourly is a separate axis entirely — leaving it
                      // returns to 'default' (Total). Both Total and
                      // By-train now support Weekly/Monthly.
                      if (roDrillMode === 'by-hour') setRoDrillMode('default');
                      setShowTrainFilter(false);
                    }}
                    rangeDays={rangeDays}
                  />
                  <button onClick={() => setRoDrillMode(roDrillMode === 'by-hour' ? 'default' : 'by-hour')}
                    className={['h-5 px-1.5 rounded text-2xs font-medium border flex items-center gap-1', roDrillMode === 'by-hour' ? 'bg-kpi-ro text-white border-kpi-ro' : 'bg-muted text-muted-foreground border-border'].join(' ')}>
                    Hourly
                  </button>
                </div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Breakdown</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => { if (roDrillMode === 'by-train') { setRoDrillMode('default'); setShowTrainFilter(false); } }}
                    className={['h-6 px-2 rounded text-2xs font-medium border', roDrillMode !== 'by-train' ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Total</button>
                  <button onClick={() => setRoDrillMode(roDrillMode === 'by-train' ? 'default' : 'by-train')}
                    className={['h-6 px-2 rounded text-2xs font-medium border flex items-center gap-1', roDrillMode === 'by-train' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground border-border'].join(' ')}>
                    <ChevronsDown className="h-3 w-3" />By train
                  </button>
                </div>
                {roDrillMode === 'by-train' && viewGran !== 'daily' && (
                  <div className="mt-2">
                    <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                    <StackToggle value={stackMode} onChange={setStackMode} />
                  </div>
                )}
              </div>
            )}
            {/* View — plant health */}
            {hasPlantHealth && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <div className="flex flex-wrap gap-1">
                  {(['daily','hourly','weekly','monthly'] as const).map((m) => (
                    <button key={m} onClick={() => setPhDrillMode(m)}
                      disabled={m !== 'hourly' && !isGranularityUsable(m, rangeDays)}
                      className={['h-6 px-2 rounded text-2xs font-medium border capitalize', phDrillMode === m ? 'bg-primary text-white border-primary' : (m !== 'hourly' && !isGranularityUsable(m, rangeDays)) ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border' : 'bg-muted text-muted-foreground border-border'].join(' ')}>{m}</button>
                  ))}
                </div>
              </div>
            )}
            {/* View — Production Cost / kWh (M4: granularity, alongside their own toggles below) */}
            {(metric === 'productionCost' || metric === 'kwh') && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} />
              </div>
            )}
            {/* Production cost toggles */}
            {metric === 'productionCost' && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                <div className="mb-2">
                  <StackToggle value={stackMode} onChange={setStackMode} />
                </div>
                {stackMode !== 'stacked' && (<>
                  <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Show lines</p>
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => setShowTotalCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showTotalCostLine ? 'bg-accent text-accent-foreground border-accent' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Prod</button>
                    <button onClick={() => setShowPowerCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showPowerCostLine ? 'border-[hsl(var(--chart-6))] text-[hsl(var(--chart-6))] bg-[hsl(var(--chart-6))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Power</button>
                    <button onClick={() => setShowChemCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showChemCostLine ? 'border-[hsl(var(--highlight))] text-[hsl(var(--highlight))] bg-[hsl(var(--highlight))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Chem</button>
                  </div>
                </>)}
                {stackMode === 'stacked' && (
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => setShowPowerCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showPowerCostLine ? 'border-[hsl(var(--chart-6))] text-[hsl(var(--chart-6))] bg-[hsl(var(--chart-6))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Power</button>
                    <button onClick={() => setShowChemCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showChemCostLine ? 'border-[hsl(var(--highlight))] text-[hsl(var(--highlight))] bg-[hsl(var(--highlight))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Chem</button>
                  </div>
                )}
              </div>
            )}
            {/* kWh source filter + export */}
            {metric === 'kwh' && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Energy source</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {(['both','solar','grid'] as const).map(s => (
                    <button key={s} onClick={() => setKwhSource(s)}
                      className={['h-6 px-2 rounded text-2xs font-medium border capitalize', kwhSource === s ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border'].join(' ')}>{s}</button>
                  ))}
                </div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                <div className="mb-2">
                  <StackToggle value={stackMode} onChange={setStackMode} />
                </div>
                <button onClick={() => {
                    if (!chartData.length) return;
                    const rows = chartData.map((d: any) => `${d.date},${+(d.solarKwh??0).toFixed(2)},${+(d.kwh??0).toFixed(2)},${+((d.solarKwh??0)+(d.kwh??0)).toFixed(2)}`);
                    const csv = ['date,solar_kwh,grid_kwh,total_kwh',...rows].join('\n');
                    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
                    const a = document.createElement('a'); a.href=url; a.download='power_energy_mix.csv'; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full h-7 rounded border border-border bg-muted text-xs font-medium flex items-center justify-center gap-1 text-muted-foreground hover:text-foreground">
                  <Download className="h-3 w-3" /> Export CSV
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* ── Desktop-only secondary controls (hidden on mobile) ─────────────── */}
        <div className="hidden sm:contents">

        {/* kwh: Source filter — Both / Solar / Grid + CSV Export */}
        {metric === 'kwh' && (() => {
          const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
          const hasGridData  = chartData.some((d: any) => (d.kwh ?? 0) > 0);
          return (
            <div className="flex items-center gap-1 shrink-0 ml-1">
              <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
              {hasSolarData && hasGridData && (
                <>
                  <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                    {(['both', 'solar', 'grid'] as const).map(s => (
                      <button key={s} onClick={() => setKwhSource(s)}
                        className={[
                          'px-2 py-0.5 rounded text-2xs font-medium transition-colors',
                          kwhSource === s
                            ? 'bg-primary text-white'
                            : 'text-muted-foreground hover:text-foreground',
                        ].join(' ')}>
                        {s === 'both' ? 'Both' : s === 'solar' ? '☀ Solar' : '⚡ Grid'}
                      </button>
                    ))}
                  </div>
                  <StackToggle value={stackMode} onChange={setStackMode} testId="kwh-stack-toggle" />
                </>
              )}
              <button
                onClick={() => {
                  if (!chartData.length) { toast.error('No data to export'); return; }
                  const rows = chartData.map((d: any) =>
                    `${d.date},${+(d.solarKwh ?? 0).toFixed(2)},${+(d.kwh ?? 0).toFixed(2)},${+((d.solarKwh ?? 0) + (d.kwh ?? 0)).toFixed(2)}`
                  );
                  const csv = ['date,solar_kwh,grid_kwh,total_kwh', ...rows].join('\n');
                  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                  const a = document.createElement('a');
                  a.href = url; a.download = 'power_energy_mix.csv'; a.click();
                  URL.revokeObjectURL(url);
                  toast.success('CSV exported');
                }}
                className="h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border bg-muted text-muted-foreground hover:text-foreground border-border"
                title="Export CSV"
              >
                <Download className="h-3 w-3" />
                <span className="hidden sm:inline">Export</span>
              </button>
            </div>
          );
        })()}

        {/* Production Cost — granularity + Stack/Group + line toggles */}
        {metric === 'productionCost' && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
            <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
            <StackToggle value={stackMode} onChange={setStackMode} testId="cost-stack-toggle" />
            <span className="text-3xs text-muted-foreground mr-0.5 hidden sm:inline ml-1">Show:</span>
            {stackMode !== 'stacked' && (
              <button
                onClick={() => setShowTotalCostLine((v) => !v)}
                title="Toggle Production Cost (Power + Chem) line"
                className={[
                  'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                  showTotalCostLine
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >Prod</button>
            )}
            <button
              onClick={() => setShowPowerCostLine((v) => !v)}
              title="Toggle Power Cost (₱/m³) line"
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                showPowerCostLine
                  ? 'border-[hsl(var(--chart-6))] text-[hsl(var(--chart-6))] bg-[hsl(var(--chart-6))]/10'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >Power</button>
            <button
              onClick={() => setShowChemCostLine((v) => !v)}
              title="Toggle Chemical Cost (₱/m³) line"
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                showChemCostLine
                  ? 'border-[hsl(var(--highlight))] text-[hsl(var(--highlight))] bg-[hsl(var(--highlight))]/10'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >Chem</button>
          </div>
        )}

        {/* pv — granularity only (M4: no breakdown available) */}
        {metric === 'pv' && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
          </div>
        )}

        {/* raw water — granularity + By-well breakdown (M4) */}
        {metric === 'rawwater' && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <GranularityControl
              value={viewGran}
              onChange={(g) => { setViewGran(g); setSelectedWellIds(null); }}
              rangeDays={rangeDays}
              testIdPrefix={`drill-${metric}`}
            />
            <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">Breakdown</span>
            <button
              onClick={() => { setRawwaterBreakdown('total'); setSelectedWellIds(null); }}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                rawwaterBreakdown === 'total'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >Total</button>
            <button
              onClick={() => setRawwaterBreakdown(rawwaterBreakdown === 'by-well' ? 'total' : 'by-well')}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                rawwaterBreakdown === 'by-well'
                  ? 'bg-chart-2 text-white border-chart-2'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >By well</button>
            {rawwaterBreakdown === 'by-well' && viewGran !== 'daily' && (
              <>
                <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
                <StackToggle value={stackMode} onChange={setStackMode} testId="rawwater-stack-toggle" />
              </>
            )}
          </div>
        )}



        {/* ── Production / NRW — View granularity + Breakdown entity ────── */}
        {hasConsumptionDrill && (
          <div className="flex items-center gap-0.5 shrink-0">
            {/* ── Granularity ── */}
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <GranularityControl
              value={viewGran}
              onChange={(g) => { setViewGran(g); setSelectedLocatorIds(null); setShowLocatorFilter(false); }}
              rangeDays={rangeDays}
              testIdPrefix={`drill-${metric}`}
            />

            {/* ── Divider ── */}
            <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />

            {/* ── Breakdown ── */}
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">Breakdown</span>
            <button
              onClick={() => { setViewBreakdown('total'); setSelectedLocatorIds(null); setShowLocatorFilter(false); }}
              data-testid={`drill-total-${metric}`}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                viewBreakdown === 'total'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Combined total"
            >Total</button>
            <button
              onClick={() => { setViewBreakdown('by-locator'); setSelectedLocatorIds(null); }}
              data-testid={`drill-by-locator-${metric}`}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                viewBreakdown === 'by-locator'
                  ? 'bg-chart-2 text-white border-chart-2'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Break down by distribution locator"
            >By locator</button>
            {metric === 'production' && (
              <button
                onClick={() => { setViewBreakdown('by-source'); setSelectedLocatorIds(null); }}
                data-testid={`drill-by-source-${metric}`}
                className={[
                  'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                  viewBreakdown === 'by-source'
                    ? 'bg-chart-2 text-white border-chart-2'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
                title={usePermeateForSource ? 'Break down by RO Train permeate' : 'Break down by product meter'}
              >By source</button>
            )}

            {/* ── Locator / source filter — visible only when breakdown != total ── */}
            {viewBreakdown !== 'total' && (
              <button
                onClick={() => setShowLocatorFilter((v) => !v)}
                data-testid={`drill-filter-${metric}`}
                className={[
                  'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                  showLocatorFilter
                    ? 'bg-warn text-white border-warn'
                    : !allSelected
                      ? 'bg-warn-soft text-warn border-warn'
                      : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
                title="Filter locators"
                aria-label={!allSelected
                  ? `Filter locators — ${selectedLocatorIds?.size ?? drillEntities.length} of ${drillEntities.length} selected`
                  : 'Filter locators'}
              >
                <Filter className="h-3 w-3" />
                {!allSelected && (
                  <span className="font-semibold" aria-hidden>
                    {selectedLocatorIds?.size ?? drillEntities.length}/{drillEntities.length}
                  </span>
                )}
              </button>
            )}

            {/* ── Stack / Group (M2) — only where there's something to stack ── */}
            {(viewBreakdown === 'total' ? metric === 'nrw' : viewGran !== 'daily') && (
              <>
                <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
                <StackToggle value={stackMode} onChange={setStackMode} testId={`${metric}-stack-toggle`} />
              </>
            )}
          </div>
        )}
        {/* ── TDS / Recovery — View granularity + Breakdown entity ────────── */}
        {hasRoDrill && (
          <div className="flex items-center gap-0.5 shrink-0">
            {/* ── Granularity ── */}
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <GranularityControl
              value={roDrillMode === 'by-hour' ? 'daily' : viewGran}
              onChange={(g) => {
                setViewGran(g);
                // Hourly is a separate axis entirely — leaving it returns to
                // 'default' (Total). Both Total and By-train now support
                // Weekly/Monthly.
                if (roDrillMode === 'by-hour') setRoDrillMode('default');
                setShowTrainFilter(false);
              }}
              rangeDays={rangeDays}
              testIdPrefix={`drill-${metric}`}
            />
            <button
              onClick={() => setRoDrillMode(roDrillMode === 'by-hour' ? 'default' : 'by-hour')}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                roDrillMode === 'by-hour'
                  ? 'bg-kpi-ro text-white border-kpi-ro'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Hourly average across date range"
            >Hourly</button>

            {/* ── Divider ── */}
            <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />

            {/* ── Breakdown ── */}
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">Breakdown</span>
            <button
              onClick={() => { if (roDrillMode === 'by-train') { setRoDrillMode('default'); setShowTrainFilter(false); } }}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                roDrillMode !== 'by-train'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Fleet average (all trains combined)"
            >Total</button>
            <button
              onClick={() => setRoDrillMode(roDrillMode === 'by-train' ? 'default' : 'by-train')}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                roDrillMode === 'by-train'
                  ? 'bg-chart-2 text-white border-chart-2'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Daily average per RO train"
            >
              <ChevronsDown className="h-3 w-3" />
              By train
            </button>

            {/* Train filter — visible in by-train or by-hour mode */}
            {roDrillMode !== 'default' && (
              <button
                onClick={() => setShowTrainFilter((v) => !v)}
                className={[
                  'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                  showTrainFilter
                    ? 'bg-warn text-white border-warn'
                    : !allTrainsSelected
                      ? 'bg-warn-soft text-warn border-warn'
                      : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
                title="Filter trains"
                aria-label={!allTrainsSelected
                  ? `Filter trains — ${selectedTrainIds?.size ?? roTrainEntities.length} of ${roTrainEntities.length} selected`
                  : 'Filter trains'}
              >
                <Filter className="h-3 w-3" />
                {!allTrainsSelected && (
                  <span className="font-semibold" aria-hidden>
                    {selectedTrainIds?.size ?? roTrainEntities.length}/{roTrainEntities.length}
                  </span>
                )}
              </button>
            )}

            {/* ── Stack / Group (M2) — By-train bars, Weekly/Monthly only ── */}
            {roDrillMode === 'by-train' && viewGran !== 'daily' && (
              <>
                <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
                <StackToggle value={stackMode} onChange={setStackMode} testId="ro-train-stack-toggle" />
              </>
            )}
          </div>
        )}
        {/* ── Plant Health — granularity only (no entity breakdown) ────────── */}
        {hasPlantHealth && (
          <div className="flex items-center gap-0.5 shrink-0" title="Plant Health granularity">
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <button
              onClick={() => setPhDrillMode('daily')}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                phDrillMode === 'daily'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Daily average health %"
            >
              <BarChart2 className="h-3 w-3" />
              Daily
            </button>
            <button
              onClick={() => setPhDrillMode('hourly')}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                phDrillMode === 'hourly'
                  ? 'bg-chart-2 text-white border-chart-2'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Hourly health — one slot per hour"
            >
              <ChevronsDown className="h-3 w-3" />
              Hourly
            </button>
            <button
              onClick={() => isGranularityUsable('weekly', rangeDays) && setPhDrillMode('weekly')}
              disabled={!isGranularityUsable('weekly', rangeDays)}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                !isGranularityUsable('weekly', rangeDays)
                  ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border'
                  : phDrillMode === 'weekly'
                    ? 'bg-chart-2 text-white border-chart-2'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Weekly average health %"
            >
              <Rows3 className="h-3 w-3" />
              Weekly
            </button>
            <button
              onClick={() => isGranularityUsable('monthly', rangeDays) && setPhDrillMode('monthly')}
              disabled={!isGranularityUsable('monthly', rangeDays)}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                !isGranularityUsable('monthly', rangeDays)
                  ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border'
                  : phDrillMode === 'monthly'
                    ? 'bg-kpi-ro text-white border-kpi-ro'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Monthly average health %"
            >
              <ChevronsUp className="h-3 w-3" />
              Monthly
            </button>
          </div>
        )}
      </div>
      {metric === 'kwh' && (() => {
        const kwhRangeLabel =
          range === 'CUSTOM' ? `${from} → ${to}`
          : range === '7D'   ? 'last 7d'
          : range === '14D'  ? 'last 14d'
          : range === '30D'  ? 'last 30d'
          : range === '60D'  ? 'last 60d'
          : 'last 90d';
        const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
        const hasGridData  = chartData.some((d: any) => (d.kwh      ?? 0) > 0);
        const sourceSuffix = hasSolarData && hasGridData
          ? 'Solar vs Grid (kWh)'
          : hasSolarData ? 'Solar only (kWh)' : 'Grid only (kWh)';
        return (
          <p className="text-xs text-muted-foreground -mt-1 mb-2 ml-0.5 flex items-center gap-1.5">
            <span>{kwhRangeLabel}</span>
            <span className="opacity-40">·</span>
            <span>daily totals</span>
            <span className="opacity-40">·</span>
            <span>{sourceSuffix}</span>
          </p>
        );
      })()}

      {/* ── Train filter panel ─────────────────────────────────────────────── */}
      {hasRoDrill && roDrillMode !== 'default' && showTrainFilter && (
        <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground shrink-0">Filter Trains</span>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={selectAllTrains}
                className={[
                  'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
                  allTrainsSelected
                    ? 'bg-primary text-white border-primary'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >All</button>
              <button
                onClick={clearAllTrains}
                className={[
                  'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
                  noTrainsSelected
                    ? 'bg-danger text-white border-danger'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >None</button>
              <button
                onClick={() => setShowTrainFilter(false)}
                className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Close filter"
                aria-label="Close filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {roTrainEntities.length > 6 && (
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={trainSearch}
                onChange={(e) => setTrainSearch(e.target.value)}
                placeholder="Search trains…"
                className="w-full h-6 pl-6 pr-2 rounded border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {trainSearch && (
                <button onClick={() => setTrainSearch('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1 max-h-[130px] overflow-y-auto pr-0.5">
            {filteredTrainList.length === 0 && (
              <span className="text-xs text-muted-foreground py-1">No trains match search.</span>
            )}
            {filteredTrainList.map((entity) => {
              const isActive = selectedTrainIds === null || selectedTrainIds.has(entity.id);
              return (
                <button
                  key={entity.id}
                  onClick={() => toggleTrain(entity.id)}
                  title={entity.label}
                  className={[
                    'flex items-center gap-1 h-6 px-2 rounded-full text-2xs font-medium border transition-all leading-none max-w-[180px]',
                    isActive
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/30',
                  ].join(' ')}
                  style={isActive ? { backgroundColor: entity.color, borderColor: entity.color } : {}}
                >
                  {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{entity.label}</span>
                </button>
              );
            })}
          </div>

          <div className="text-2xs text-muted-foreground flex items-center gap-2 pt-0.5 border-t border-border/50">
            <span>
              {allTrainsSelected
                ? `All ${roTrainEntities.length} trains shown`
                : noTrainsSelected
                  ? 'No trains selected — chart will be empty'
                  : `${selectedTrainIds!.size} of ${roTrainEntities.length} trains shown`}
            </span>
            {!allTrainsSelected && !noTrainsSelected && (
              <button onClick={selectAllTrains} className="ml-auto text-2xs text-primary hover:underline">Reset</button>
            )}
          </div>
        </div>
      )}
      {hasConsumptionDrill && drillMode !== 'default' && showLocatorFilter && (
        <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 flex flex-col gap-1.5" data-testid={`locator-filter-panel-${metric}`}>
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground shrink-0">Filter Locators</span>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={selectAllLocators}
                className={[
                  'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
                  allSelected
                    ? 'bg-primary text-white border-primary'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >
                All
              </button>
              <button
                onClick={clearAllLocators}
                className={[
                  'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
                  noneSelected
                    ? 'bg-danger text-white border-danger'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >
                None
              </button>
              <button
                onClick={() => setShowLocatorFilter(false)}
                className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Close filter"
                aria-label="Close filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Search box */}
          {drillEntities.length > 6 && (
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={locatorSearch}
                onChange={(e) => setLocatorSearch(e.target.value)}
                placeholder="Search locators…"
                className="w-full h-6 pl-6 pr-2 rounded border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {locatorSearch && (
                <button
                  onClick={() => setLocatorSearch('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}

          {/* Locator chip grid */}
          <div className="flex flex-wrap gap-1 max-h-[130px] overflow-y-auto pr-0.5">
            {filteredLocatorList.length === 0 && (
              <span className="text-xs text-muted-foreground py-1">No locators match search.</span>
            )}
            {filteredLocatorList.map((entity) => {
              const isActive = selectedLocatorIds === null || selectedLocatorIds.has(entity.id);
              return (
                <button
                  key={entity.id}
                  onClick={() => toggleLocator(entity.id)}
                  title={entity.label}
                  className={[
                    'flex items-center gap-1 h-6 px-2 rounded-full text-2xs font-medium border transition-all leading-none max-w-[180px]',
                    isActive
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/30',
                  ].join(' ')}
                  style={isActive ? { backgroundColor: entity.color, borderColor: entity.color } : {}}
                >
                  {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{entity.label}</span>
                </button>
              );
            })}
          </div>

          {/* Summary footer */}
          <div className="text-2xs text-muted-foreground flex items-center gap-2 pt-0.5 border-t border-border/50">
            <span>
              {allSelected
                ? `All ${drillEntities.length} locators shown`
                : noneSelected
                  ? 'No locators selected — chart will be empty'
                  : `${selectedLocatorIds!.size} of ${drillEntities.length} locators shown`}
            </span>
            {!allSelected && !noneSelected && (
              <button
                onClick={selectAllLocators}
                className="ml-auto text-2xs text-primary hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

        </div>{/* end hidden sm:contents */}

      {/* ── Data Summary Popup Dialog — 3-tab pivot table ───────────────── */}
      {showSummary && (
        <DataSummaryPopup
          open={showSummary}
          onClose={() => setShowSummary(false)}
          metric={metric}
          title={title}
          chartData={chartData}
          locReadings={locReadings ?? []}
          productReadings={productReadings ?? []}
          wellReadings={wellReadings ?? []}
          costReadings={costReadings ?? []}
          roReadings={roReadings ?? []}
          permeateIsProductionPlants={permeateIsProductionPlants}
          productExcludedPlants={productExcludedPlants}
          trainPlantMap={_trainPlantMap}
          locatorNames={locatorNames}
          productMeterNames={productMeterNames}
          wellNames={wellNames}
          plantNames={plantNames}
          roTrainNames={roTrainNames}
          directLocatorIds={_directLocatorIds}
        />
      )}

      {/* ── kwh: Latest Solar / Grid / Total stat cards ──────────────────────
           Rendered above the chart so operators can see the most-recent day's
           figures at a glance without scrolling to the rightmost bar.
           "Latest" = the last chartData row that has any power data.
           Delta is vs. the row before it — labelled "vs prev day" because the
           selected range may not include today (e.g. a 90D window ending last week).
           Color semantics: Solar ↑ = good (green); Grid ↑ = bad (rose). ───── */}
      {metric === 'kwh' && chartData.length > 0 && (() => {
        // Walk from the end to find the most-recent row with actual power data
        const dataRows = chartData.filter((d: any) => (d.kwh ?? 0) > 0 || (d.solarKwh ?? 0) > 0);
        if (!dataRows.length) return null;

        const latest    = dataRows[dataRows.length - 1] as any;
        const prevRow   = dataRows.length > 1 ? dataRows[dataRows.length - 2] as any : null;

        const latestSolar = +(latest.solarKwh ?? 0);
        const latestGrid  = +(latest.kwh      ?? 0);
        const latestTotal = +(latestSolar + latestGrid).toFixed(1);
        const solarPct    = latestTotal > 0 ? +((latestSolar / latestTotal) * 100).toFixed(1) : 0;

        const solarDelta  = prevRow && (prevRow.solarKwh ?? 0) > 0
          ? +(((latestSolar - (prevRow.solarKwh ?? 0)) / (prevRow.solarKwh ?? 0)) * 100).toFixed(1)
          : null;
        const gridDelta   = prevRow && (prevRow.kwh ?? 0) > 0
          ? +(((latestGrid - (prevRow.kwh ?? 0)) / (prevRow.kwh ?? 0)) * 100).toFixed(1)
          : null;

        const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
        const hasGridData  = chartData.some((d: any) => (d.kwh      ?? 0) > 0);

        if (latestSolar === 0 && latestGrid === 0) return null;

        const fmtKwh = (v: number) =>
          v.toLocaleString(undefined, { maximumFractionDigits: 1 });

        return (
          <div className="grid grid-cols-3 gap-2 mb-3 mt-1" data-testid="kwh-stat-cards">
            {/* ── Solar ── */}
            {hasSolarData && (
              <div
                className="rounded-xl border border-warn/70 bg-warn-soft/50 px-3 py-3"
                data-testid="kwh-stat-solar"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sun className="h-3 w-3 text-warn shrink-0" />
                  <span className="text-3xs font-bold uppercase tracking-[0.08em] text-warn">
                    Solar · {latest.date}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold tabular-nums tracking-tight">{fmtKwh(latestSolar)}</span>
                  <span className="text-xs font-medium text-muted-foreground">kWh</span>
                </div>
                {solarDelta !== null && (
                  <p className={[
                    'text-2xs mt-0.5 font-semibold',
                    solarDelta >= 0 ? 'text-accent' : 'text-danger',
                  ].join(' ')}>
                    {solarDelta >= 0 ? '↑' : '↓'} {Math.abs(solarDelta)}% vs prev day
                  </p>
                )}
              </div>
            )}

            {/* ── Grid ── */}
            {hasGridData && (
              <div
                className="rounded-xl border border-info/70 bg-info-soft/50 px-3 py-3"
                data-testid="kwh-stat-grid"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Zap className="h-3 w-3 text-info shrink-0" />
                  <span className="text-3xs font-bold uppercase tracking-[0.08em] text-info">
                    Grid · {latest.date}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold tabular-nums tracking-tight">{fmtKwh(latestGrid)}</span>
                  <span className="text-xs font-medium text-muted-foreground">kWh</span>
                </div>
                {gridDelta !== null && (
                  <p className={[
                    'text-2xs mt-0.5 font-semibold',
                    // Grid consumption: lower is better (efficiency) → green when falling
                    gridDelta <= 0 ? 'text-accent' : 'text-danger',
                  ].join(' ')}>
                    {gridDelta >= 0 ? '↑' : '↓'} {Math.abs(gridDelta)}% vs prev day
                  </p>
                )}
              </div>
            )}

            {/* ── Total — spans 2 cols when only one source exists ── */}
            <div
              className={[
                'rounded-xl border border-primary/70 bg-primary-soft/50 px-3 py-3',
                !hasSolarData || !hasGridData ? 'col-span-2' : '',
              ].join(' ')}
              data-testid="kwh-stat-total"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <Zap className="h-3 w-3 text-primary shrink-0" />
                <span className="text-3xs font-bold uppercase tracking-[0.08em] text-primary">
                  Total · {latest.date}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold tabular-nums tracking-tight">{fmtKwh(latestTotal)}</span>
                <span className="text-xs font-medium text-muted-foreground">kWh</span>
              </div>
              {hasSolarData && latestSolar > 0 && (
                <p className="text-2xs mt-0.5 text-muted-foreground font-medium">
                  Solar:{' '}
                  <span className="font-bold text-warn">{solarPct}%</span>
                  {' '}of mix
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {(hasConsumptionDrill || (hasRoDrill && roDrillMode === 'by-train') || (metric === 'rawwater' && rawwaterBreakdown === 'by-well')) && <DrillBreadcrumb crumbs={drillCrumbs} />}

      <div className={`${chartHeight} w-full relative`} data-testid={`trend-chart-${metric}`}>
        {queryError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-danger bg-danger-soft/95 px-3 py-2 text-xs text-danger shadow-sm pointer-events-auto max-w-md text-center">
              <div className="font-semibold mb-0.5">Couldn't load trend data</div>
              <div className="text-xs opacity-80">{queryError.message}</div>
              <button
                type="button"
                onClick={retryFailedQueries}
                disabled={isFetching}
                className="mt-1.5 text-xs font-medium underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
              >
                {isFetching ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          </div>
        )}
        {!queryError && !isFetching && chartData.length === 0 && entityRows.length === 0 && phActiveData.length === 0 && metric !== 'kwh' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-border/60 bg-card/80 backdrop-blur-sm px-3 py-2 text-xs text-muted-foreground text-center pointer-events-auto max-w-md shadow-sm">
              <div className="font-medium text-foreground">No data in selected range</div>
              <div className="text-xs mt-0.5">
                Try a wider range, switch plant, or log readings for {metric === 'nrw' ? 'wells & locators' : metric === 'pv' ? 'wells & power' : metric === 'tds' || metric === 'recovery' || metric === 'plantHealth' ? 'RO trains' : metric === 'productionCost' ? 'power readings (Operations) + tariff rate (Costs → Power tab) + production volume (product meter readings)' : 'wells'}.
              </div>
            </div>
          </div>
        )}
        {/* productionCost-specific: data exists but all cost values are null (missing tariff or production) */}
        {!queryError && !isFetching && metric === 'productionCost' && chartData.length > 0
          && chartData.every((d) => d.totalCost == null) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-warn bg-warn-soft/95 px-4 py-3 text-xs text-warn text-left pointer-events-auto max-w-sm shadow-sm">
              <div className="font-semibold mb-1">Cost data incomplete</div>
              <div className="text-xs space-y-1 opacity-90">
                <p>Power cost requires all three of the following in this date range:</p>
                <ul className="list-disc list-inside space-y-0.5 mt-1">
                  <li><strong>Power readings</strong> — log kWh in Operations</li>
                  <li><strong>Tariff rate</strong> — add a bill in Costs → Power tab</li>
                  <li><strong>Production volume</strong> — log product meter readings</li>
                </ul>
                <p className="mt-1 opacity-75">Check: <code className="bg-warn-soft px-1 rounded">SELECT * FROM power_tariffs WHERE plant_id = '…'</code></p>
              </div>
            </div>
          </div>
        )}
        {!queryError && !isFetching && metric === 'kwh' && chartData.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 gap-2">
            <BarChart2 className="h-8 w-8 opacity-20 text-muted-foreground" />
            <div className="text-center">
              <div className="text-xs font-medium text-foreground">No power readings in this period</div>
              <div className="text-2xs text-muted-foreground mt-0.5 opacity-70">Log readings in Operations → Power, then run the SQL migration to backfill legacy rows.</div>
            </div>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          {(hasRoDrill && roDrillMode === 'by-train' && viewGran === 'daily') ? (
            <LineChart data={roTrainDrillData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? `${v} ${roUnit}` : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleLegendIsolate}
              />
              {visibleTrainEntities.map(({ id, label, color }) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={label}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : (hasRoDrill && roDrillMode === 'by-train') ? (
            // Weekly/Monthly (M4, deferred item now shipped) — per-train
            // averages are volume-weighted by that bucket's sample count
            // (see roTrainDrillData), rendered as grouped-or-stacked bars
            // with the same Stack/Group toggle and partial-bucket styling
            // the Production/NRW breakdown uses.
            <ComposedChart
              data={drillFocusRange ? roTrainDrillData.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey) : roTrainDrillData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? `${v} ${roUnit}` : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleLegendIsolate}
              />
              {visibleTrainEntities.map(({ id, label, color }) => (
                <Bar
                  key={id}
                  dataKey={id}
                  name={label}
                  fill={color}
                  maxBarSize={28}
                  radius={[3, 3, 0, 0]}
                  stackId={stackMode === 'stacked' ? 'trains' : undefined}
                  shape={makeDrillableBarShape(
                    handleDrillBarActivate,
                    (p) => `Drill into ${p.date as string}`,
                  )}
                />
              ))}
            </ComposedChart>
          ) : (hasRoDrill && roDrillMode === 'by-hour') ? (
            <AreaChart data={roHourDrillData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="hourlyDrillFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={metric === 'tds' ? C_TDS : C_RECOVERY} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={metric === 'tds' ? C_TDS : C_RECOVERY} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fontWeight: 500 }}
                stroke="hsl(var(--muted-foreground))"
                interval={Math.max(0, Math.floor(roHourDrillData.length / 12) - 1)}
                angle={-35}
                textAnchor="end"
                height={48}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any) => [v != null ? `${v} ${roUnit}` : '—', metric === 'tds' ? 'Avg TDS' : 'Avg Recovery']}
                labelFormatter={(label) => label}
              />
              <Area
                type="monotone"
                dataKey="value"
                name={metric === 'tds' ? 'Avg TDS (ppm)' : 'Avg Recovery (%)'}
                stroke={metric === 'tds' ? C_TDS : C_RECOVERY}
                strokeWidth={2.5}
                fill="url(#hourlyDrillFill)"
                dot={false}
                connectNulls
              />
            </AreaChart>
          ) : (hasConsumptionDrill && drillMode === 'drilldown' && viewGran === 'daily') ? (
            // Daily — 5+ entities × 30 daily bars is noisy as bars, so this
            // stays line-based regardless of the Weekly/Monthly bar switch below.
            <ComposedChart data={focusedEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleLegendIsolate}
              />
              {visibleEntities.map(({ id, label, color }) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={label}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          ) : (hasConsumptionDrill && drillMode === 'drilldown') ? (
            // Weekly/Monthly — bars, grouped or stacked per the Stack/Group
            // toggle (M2). Bars are keyboard-focusable and clicking one
            // drills into that bucket at the next-finer granularity (M3);
            // partial edge buckets render with reduced opacity + a dashed
            // outline instead of looking like a genuine low-volume period.
            <ComposedChart data={focusedEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleLegendIsolate}
              />
              {visibleEntities.map(({ id, label, color }) => (
                <Bar
                  key={id}
                  dataKey={id}
                  name={label}
                  fill={color}
                  maxBarSize={28}
                  radius={[3, 3, 0, 0]}
                  stackId={stackMode === 'stacked' ? 'entities' : undefined}
                  shape={makeDrillableBarShape(
                    handleDrillBarActivate,
                    (payload) => `Drill into ${payload.date as string ?? label}`,
                  )}
                />
              ))}
            </ComposedChart>
          ) : metric === 'nrw' ? (
            // Total (non-drilled) NRW view — Production/Consumption bars +
            // NRW% line, from focusedTrendRows so Weekly/Monthly (M1/M4) and
            // a drill-in focus window (M3) both apply. Grouped by default;
            // Stack toggle (M2) collapses the two into one total-input bar.
            // Bars are click-to-drill: Monthly→that month's weeks,
            // Weekly→that week's days, Daily→opens the by-locator breakdown.
            <ComposedChart data={focusedTrendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis yAxisId="vol" tick={{ fontSize: 10 }} stroke={C_PRODUCTION} tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} stroke={C_NRW} width={32} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Bar
                yAxisId="vol" dataKey="production" fill={C_PRODUCTION} name="Production (m³)" radius={[3, 3, 0, 0]} maxBarSize={32}
                stackId={stackMode === 'stacked' ? 'nrw' : undefined}
                shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
              />
              <Bar
                yAxisId="vol" dataKey="consumption" fill={C_CONSUMPTION} name="Consumption (m³)" radius={[3, 3, 0, 0]} maxBarSize={32}
                stackId={stackMode === 'stacked' ? 'nrw' : undefined}
                shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
              />
              <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke={C_NRW} strokeWidth={2.5} dot={{ r: 3.5, fill: C_NRW, strokeWidth: 0 }} name="NRW %" connectNulls />
            </ComposedChart>
          ) : metric === 'chemCost' ? (
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="chemCostFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="hsl(var(--highlight))" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="hsl(var(--highlight))" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--highlight))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Area type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2.5} fill="url(#chemCostFill)" dot={false} name="Chemical Cost (₱)" connectNulls />
            </AreaChart>
          ) : metric === 'powerCost' ? (
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="powerCostFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="hsl(var(--chart-6))" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="hsl(var(--chart-6))" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--chart-6))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Area type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2.5} fill="url(#powerCostFill)" dot={false} name="Power Cost (₱)" connectNulls />
            </AreaChart>
          ) : (metric === 'productionCost' && stackMode === 'stacked') ? (
            // Production Cost — stacked composition view (M2): "the best
            // stacking candidate on the dashboard" per the plan — Power +
            // Chem stacked so the bar height IS the total cost, instead of
            // three overlaid lines the eye has to add up. Weekly/Monthly
            // (M4) via trendRows' volume-weighted powerCost/chemCost avg.
            <BarChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--accent))" tickFormatter={(v) => `₱${formatYAxis(v)}`} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? `₱${(+v).toFixed(4)}/m³` : '—', name]}
              />
              {showPowerCostLine && (
                <Bar dataKey="powerCost" name="Power (₱/m³)" fill="hsl(var(--chart-6))" stackId="cost" radius={[0, 0, 0, 0]} maxBarSize={32} />
              )}
              {showChemCostLine && (
                <Bar dataKey="chemCost" name="Chem (₱/m³)" fill="hsl(var(--highlight))" stackId="cost" radius={[3, 3, 0, 0]} maxBarSize={32} />
              )}
            </BarChart>
          ) : metric === 'productionCost' ? (
            // Production Cost — all lines as ₱/m³ (unit cost per cubic metre):
            //   Prod Cost  = Power Cost + Chem Cost          (teal, always visible)
            //   Power Cost = daily_kwh × rate_per_kwh / m³  (blue, toggle: Power ₱)
            //   Chem Cost  = chem_cost_₱ / m³               (orange, toggle: Chem ₱)
            // Single ₱/m³ Y-axis — all lines share the same scale.
            // Points gap (null) when production = 0 or no tariff is configured.
            // ─ Where does rate_per_kwh come from? ────────────────────────────────
            //   Costs → Power tab: each monthly bill entry auto-derives a tariff row
            //   (total_amount ÷ kWh). That rate is stored in power_tariffs and looked
            //   up here using the latest effective_date ≤ each reading's date.
            // trendRows (not chartData) so Weekly/Monthly (M4) apply — powerCost/
            // chemCost/totalCost are volume-weighted averages, not naive means
            // (see TREND_FIELD_AGG).
            <LineChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--accent))"
                tickFormatter={(v) => `₱${formatYAxis(v)}`}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [
                  v != null ? `₱${(+v).toFixed(4)}/m³` : '—',
                  name,
                ]}
              />
              {showTotalCostLine && (
                <Line type="monotone" dataKey="totalCost" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 2 }} name="Prod Cost (₱/m³)" connectNulls />
              )}
              {showPowerCostLine && (
                <Line type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (₱/m³)" connectNulls />
              )}
              {showChemCostLine && (
                <Line type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2} dot={false} name="Chem (₱/m³)" connectNulls />
              )}
            </LineChart>
          ) : metric === 'pv' ? (
            // PV Ratio — two lines: Grid-only PV and (Grid+Solar) PV.
            // PvTooltip and domain are defined/hoisted above the return().
            // trendRows (not chartData) so Weekly/Monthly (M4) apply.
            <LineChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke={C_GRID_PV}
                width={44}
                axisLine={false}
                tickLine={false}
                domain={[
                  0,
                  (dataMax: number) => {
                    // For small PV ratios (e.g. 0.4–1.5 kWh/m³), 'auto' may give
                    // a too-large max. Round up to the nearest sensible tick.
                    if (dataMax <= 0) return 2;
                    if (dataMax < 1)  return Math.ceil(dataMax * 10) / 10 + 0.1;
                    if (dataMax < 4)  return Math.ceil(dataMax * 4)  / 4;
                    return Math.ceil(dataMax);
                  },
                ]}
                tickCount={6}
                tickFormatter={(v) => +v.toFixed(2) === 0 ? '0' : v.toFixed(v < 1 ? 2 : 1)}
              />
              <Tooltip content={<PvTooltip />} />
              <Line
                type="monotone"
                dataKey={(d: any) => d.production > 0 ? +(d.kwh / d.production).toFixed(2) : null}
                stroke={C_GRID_PV}
                strokeWidth={2.5}
                dot={false}
                name="Grid PV (kWh/m³)"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey={(d: any) => d.production > 0 && (d.kwh + d.solarKwh) > 0
                  ? +((d.kwh + d.solarKwh) / d.production).toFixed(2)
                  : null}
                stroke={C_PRODUCTION}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                name="(Grid+Solar) PV (kWh/m³)"
                connectNulls
              />
            </LineChart>
          ) : metric === 'kwh' ? (
            // ── Power Consumption & Energy Mix ────────────────────────────────────
            // Uses kwhChartRows (source-filtered useMemo) so zero-value bars are
            // never emitted. hasSolarData/hasGridData guards mirror PowerChart exactly.
            (() => {
              const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
              const hasGridData  = chartData.some((d: any) => (d.kwh      ?? 0) > 0);

              // Rich tooltip: shows Solar, Grid, Total, and Solar % in one popover
              const KwhTooltip = ({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const solarVal = payload.find((p: any) => p.dataKey === 'solarKwh')?.value ?? 0;
                const gridVal  = payload.find((p: any) => p.dataKey === 'gridKwh')?.value  ?? 0;
                const total    = solarVal + gridVal;
                const pct      = total > 0 ? ((solarVal / total) * 100).toFixed(1) : null;
                const fmt      = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
                return (
                  <div style={{
                    background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                    borderRadius: 8, fontSize: 11, padding: '8px 10px',
                    minWidth: 160, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
                  }}>
                    <p style={{ margin: '0 0 5px', fontWeight: 600, color: 'hsl(var(--foreground))' }}>{label}</p>
                    {hasSolarData && kwhSource !== 'grid' && solarVal > 0 && (
                      <p style={{ margin: '1px 0', color: 'hsl(48,96%,40%)' }}>
                        ☀ Solar: <strong>{fmt(solarVal)} kWh</strong>
                      </p>
                    )}
                    {hasGridData && kwhSource !== 'solar' && gridVal > 0 && (
                      <p style={{ margin: '1px 0', color: 'hsl(213,94%,55%)' }}>
                        ⚡ Grid: <strong>{fmt(gridVal)} kWh</strong>
                      </p>
                    )}
                    {total > 0 && (
                      <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
                        <p style={{ margin: '1px 0', color: 'hsl(var(--foreground))', fontWeight: 600 }}>
                          Total: {fmt(total)} kWh
                        </p>
                        {pct && hasSolarData && kwhSource === 'both' && (
                          <p style={{ margin: '2px 0 0', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
                            Solar: <span style={{ color: 'hsl(48,96%,40%)', fontWeight: 600 }}>{pct}%</span> of mix
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <ComposedChart
                  data={kwhChartRows}
                  margin={{ top: 8, right: 8, left: -8, bottom: 20 }}
                  barSize={Math.max(3, Math.min(18, 400 / Math.max(kwhChartRows.length, 1)))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    angle={-30}
                    textAnchor="end"
                    height={36}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={formatYAxis}
                    width={44}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<KwhTooltip />} />
                  {/* Solar — base of stack (or left bar when grouped), no rounded corners */}
                  {hasSolarData && kwhSource !== 'grid' && (
                    <Bar dataKey="solarKwh" name="☀ Solar (kWh)" fill="hsl(48,96%,53%)"
                      stackId={stackMode === 'stacked' ? 'kwh' : undefined}
                      radius={stackMode === 'stacked' ? [0, 0, 0, 0] : [3, 3, 0, 0]} />
                  )}
                  {/* Grid — top of stack (or right bar when grouped), rounded upper corners */}
                  {hasGridData && kwhSource !== 'solar' && (
                    <Bar dataKey="gridKwh"  name="⚡ Grid (kWh)"  fill="hsl(213,94%,68%)"
                      stackId={stackMode === 'stacked' ? 'kwh' : undefined}
                      radius={[3, 3, 0, 0]} />
                  )}
                </ComposedChart>
              );
            })()
          ) : hasPlantHealth ? (
            // ── Plant Health — % of trains Online per slot ───────────────────────
            // Color zones: ≥80% emerald, ≥50% amber, <50% rose.
            // Tooltip shows online/offline counts + named offline trains.
            (() => {
              const PhTooltip = ({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const row = phActiveData.find((d) => d.date === label);
                if (!row) return null;
                const pct = row.healthPct ?? 0;
                const dotColor = pct >= 80 ? 'hsl(var(--accent))' : pct >= 50 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';
                return (
                  <div style={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8, fontSize: 11, padding: '8px 10px',
                    minWidth: 170, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
                  }}>
                    <p style={{ margin: '0 0 5px', fontWeight: 600 }}>{label}</p>
                    <p style={{ margin: '1px 0', color: dotColor, fontWeight: 700 }}>
                      Health: {pct != null ? `${pct}%` : '—'}
                    </p>
                    {row.onlineCount != null && (
                      <>
                        <p style={{ margin: '1px 0', color: 'hsl(var(--accent))' }}>
                          ● Online: {row.onlineCount} / {row.totalTrains}
                        </p>
                        <p style={{ margin: '1px 0', color: 'hsl(var(--danger))' }}>
                          ● Offline: {row.offlineCount}
                        </p>
                      </>
                    )}
                    {row.offlineTrains.length > 0 && (
                      <div style={{
                        marginTop: 6, paddingTop: 5,
                        borderTop: '1px solid hsl(var(--border))',
                      }}>
                        <p style={{ margin: '0 0 3px', fontSize: 10, fontWeight: 600, color: 'hsl(var(--danger))' }}>
                          Offline trains:
                        </p>
                        {row.offlineTrains.map((name) => (
                          <p key={name} style={{ margin: '1px 0', fontSize: 10, color: 'hsl(var(--danger))', opacity: 0.85 }}>
                            · {name}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              };

              // Color each dot by health zone
              const dotFill = (entry: any) => {
                const p = entry?.healthPct ?? 0;
                return p >= 80 ? 'hsl(var(--accent))' : p >= 50 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';
              };

              return (
                <ComposedChart data={phActiveData} margin={{ top: 8, right: 8, left: 0, bottom: phDrillMode === 'hourly' ? 32 : 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: phDrillMode === 'hourly' ? 8 : 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    angle={phDrillMode === 'hourly' ? -35 : 0}
                    textAnchor={phDrillMode === 'hourly' ? 'end' : 'middle'}
                    height={phDrillMode === 'hourly' ? 48 : 20}
                    interval={phDrillMode === 'hourly'
                      ? Math.max(0, Math.floor(phActiveData.length / 12) - 1)
                      : 'preserveStartEnd'}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    width={44}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<PhTooltip />} />
                  {/* ── Green zone ≥80% ── */}
                  <ReferenceLine y={80} stroke="hsl(var(--accent))" strokeDasharray="4 3" strokeWidth={1}
                    label={{ value: '80%', position: 'right', fontSize: 9, fill: 'hsl(var(--accent))' }} />
                  {/* ── Amber zone ≥50% ── */}
                  <ReferenceLine y={50} stroke="hsl(var(--warn))" strokeDasharray="4 3" strokeWidth={1}
                    label={{ value: '50%', position: 'right', fontSize: 9, fill: 'hsl(var(--warn))' }} />
                  <Line
                    type="monotone"
                    dataKey="healthPct"
                    name="Plant Health (%)"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const { cx, cy, payload } = props;
                      const fill = dotFill(payload);
                      return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={fill} stroke={fill} />;
                    }}
                    stroke="hsl(var(--accent))"
                    connectNulls
                  />
                </ComposedChart>
              );
            })()
          ) : (metric === 'rawwater' && rawwaterBreakdown === 'by-well' && viewGran === 'daily') ? (
            // By-well breakdown — daily stays line-based, same reasoning as
            // the Production/NRW breakdown (a handful of wells × 30 daily
            // bars reads better as lines than bars).
            <ComposedChart data={wellEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleWellLegendIsolate}
              />
              {visibleWellEntities.map(({ id, label, color }) => (
                <Line key={id} type="monotone" dataKey={id} name={label} stroke={color} strokeWidth={2} dot={false} connectNulls />
              ))}
            </ComposedChart>
          ) : (metric === 'rawwater' && rawwaterBreakdown === 'by-well') ? (
            // Weekly/Monthly — grouped or stacked bars, click-to-drill,
            // partial-bucket styling — identical machinery to the
            // Production/NRW breakdown, just pointed at wellEntityRows.
            <ComposedChart
              data={drillFocusRange ? wellEntityRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey) : wellEntityRows}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)' }}
                formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
                onClick={handleWellLegendIsolate}
              />
              {visibleWellEntities.map(({ id, label, color }) => (
                <Bar
                  key={id}
                  dataKey={id}
                  name={label}
                  fill={color}
                  maxBarSize={28}
                  radius={[3, 3, 0, 0]}
                  stackId={stackMode === 'stacked' ? 'wells' : undefined}
                  shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
                />
              ))}
            </ComposedChart>
          ) : metric === 'rawwater' ? (
            // ── Raw Water — smooth gradient area chart ────────────────────────────
            // trendRows (not chartData) so Weekly/Monthly (M4) apply.
            <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rawWaterFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_RAWWATER} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={C_RAWWATER} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
                strokeOpacity={0.6}
              />
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
                tickFormatter={formatYAxis}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Area
                type="monotone"
                dataKey="rawwater"
                stroke={C_RAWWATER}
                strokeWidth={2.5}
                fill="url(#rawWaterFill)"
                dot={false}
                name="Raw Water (m³)"
                connectNulls
              />
            </AreaChart>
          ) : (metric === 'tds' && roDrillMode === 'default') ? (
            // ── Permeate TDS — smooth gradient area chart ─────────────────────────
            // trendRows (not chartData) so Weekly/Monthly (M4) apply — tds is a
            // sample-count-weighted average per TREND_FIELD_AGG, not a naive mean.
            <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tdsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_TDS} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={C_TDS} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
                strokeOpacity={0.6}
              />
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
                tickFormatter={formatYAxis}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Area
                type="monotone"
                dataKey="tds"
                stroke={C_TDS}
                strokeWidth={2.5}
                fill="url(#tdsFill)"
                dot={false}
                name="Permeate TDS (ppm)"
                connectNulls
              />
            </AreaChart>
          ) : (
            // ── Production / Recovery / TDS (default) — gradient area chart ────────
            // trendRows (not chartData): Production's Total view stays an
            // overlapping area chart at every granularity per the plan
            // ("Default overlap-area view stays as-is — reads better than a
            // stack") — it just now also supports Weekly/Monthly bucketing.
            // Recovery inherits the same weighted-avg treatment TDS gets.
            <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="productionFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_PRODUCTION} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C_PRODUCTION} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="consumptionFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_CONSUMPTION} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={C_CONSUMPTION} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="recoveryFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C_RECOVERY} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={C_RECOVERY} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
              <Tooltip content={<NegativeAwareTooltip />} />
              {metric === 'production' && (<>
                {/* Render consumption behind production for the overlapping-area effect */}
                <Area type="monotone" dataKey="consumption" stroke={C_CONSUMPTION} strokeWidth={2.5} fill="url(#consumptionFill)" dot={false} name="Consumption (m³)" connectNulls />
                <Area type="monotone" dataKey="production" stroke={C_PRODUCTION} strokeWidth={2.5} fill="url(#productionFill)" dot={false} name="Production (m³)" connectNulls />
              </>)}
              {metric === 'recovery' && roDrillMode === 'default' && (
                <Area type="monotone" dataKey="recovery" stroke={C_RECOVERY} strokeWidth={2.5} fill="url(#recoveryFill)" dot={false} name="Recovery (%)" connectNulls />
              )}
              {metric === 'tds' && roDrillMode === 'default' && (
                <Area type="monotone" dataKey="tds" stroke={C_TDS} strokeWidth={2.5} fill="url(#tdsFill)" dot={false} name="Permeate TDS (ppm)" connectNulls />
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* ── kwh: Legend (Solar / Grid swatches) ──────────────────────────── */}
      {metric === 'kwh' && kwhChartRows.length > 0 && (() => {
        const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
        const hasGridData  = chartData.some((d: any) => (d.kwh ?? 0) > 0);
        return (
          <ModernChartLegend items={[
            ...(hasSolarData && kwhSource !== 'grid'  ? [{ color: 'hsl(48,96%,53%)', label: 'Solar (kWh)', shape: 'bar' as const }] : []),
            ...(hasGridData  && kwhSource !== 'solar' ? [{ color: 'hsl(213,94%,68%)', label: 'Grid (kWh)', shape: 'bar' as const }] : []),
          ]} />
        );
      })()}

      {/* ── Production vs Consumption legend ─────────────────────────────── */}
      {metric === 'production' && !hasConsumptionDrill && (
        <ModernChartLegend items={[
          { color: C_PRODUCTION,  label: 'Production (m³)',  shape: 'area' },
          { color: C_CONSUMPTION, label: 'Consumption (m³)', shape: 'area' },
        ]} />
      )}

      {/* ── NRW legend ───────────────────────────────────────────────────── */}
      {metric === 'nrw' && !hasConsumptionDrill && (
        <ModernChartLegend items={[
          { color: C_PRODUCTION,  label: 'Production (m³)',  shape: 'bar' },
          { color: C_CONSUMPTION, label: 'Consumption (m³)', shape: 'bar' },
          { color: C_NRW,         label: 'NRW %',            shape: 'line' },
        ]} />
      )}

      {/* ── Raw Water legend ─────────────────────────────────────────────── */}
      {metric === 'rawwater' && !hasConsumptionDrill && (
        <ModernChartLegend items={[{ color: C_RAWWATER, label: 'Raw Water (m³)', shape: 'area' }]} />
      )}

      {/* ── Recovery legend ──────────────────────────────────────────────── */}
      {metric === 'recovery' && !hasRoDrill && (
        <ModernChartLegend items={[{ color: C_RECOVERY, label: 'Recovery (%)', shape: 'area' }]} />
      )}

      {/* ── TDS legend ───────────────────────────────────────────────────── */}
      {metric === 'tds' && !hasRoDrill && (
        <ModernChartLegend items={[{ color: C_TDS, label: 'Permeate TDS (ppm)', shape: 'area' }]} />
      )}

      {/* ── Production Cost legend ───────────────────────────────────────── */}
      {metric === 'productionCost' && (
        <ModernChartLegend items={[
          ...(showTotalCostLine ? [{ color: 'hsl(var(--accent))',     label: 'Prod Cost (₱/m³)', shape: 'line' as const }] : []),
          ...(showPowerCostLine ? [{ color: 'hsl(var(--chart-6))',    label: 'Power (₱/m³)',     shape: 'line' as const }] : []),
          ...(showChemCostLine  ? [{ color: 'hsl(var(--highlight))', label: 'Chem (₱/m³)',      shape: 'line' as const }] : []),
        ]} />
      )}

      {/* ── PV Ratio legend ──────────────────────────────────────────────── */}
      {metric === 'pv' && (
        <ModernChartLegend items={[
          { color: C_GRID_PV,    label: 'Grid PV (kWh/m³)',          shape: 'line' },
          { color: C_PRODUCTION, label: '(Grid+Solar) PV (kWh/m³)',  shape: 'line' },
        ]} />
      )}
    </>
  );
}
