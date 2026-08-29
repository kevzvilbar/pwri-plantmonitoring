import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calc } from '@/lib/calculations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronsDown, ChevronsUp, BarChart2, Filter, X, Check, Search, Sun, Zap, Download, MoreVertical, MessageCircleOff, Rows3 } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';
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
import { TrendChartToolbar } from './TrendChartToolbar';
// Foundation (Weekly-granularity improvement plan) — the shared
// bucketing/aggregation engine. See TrendChartAggregate.ts's header comment
// for why this buckets already-computed daily rows rather than raw readings.
import {
  buildTrendRows, buildEntityPivotRows, isGranularityUsable, rangeDaysBetween, getIsoWeekStart,
  type Granularity, type TrendFieldConfig,
} from './TrendChartAggregate';
// M2/M3 — shared granularity control, stack/group toggle, and breadcrumb
// components, plus their underlying logic (kept in a separate plain-.ts
// module so TrendChartDrill.tsx exports only components — see that file's
// and TrendChartDrillKit.ts's header comments for why).
import {
  GranularityControl, StackToggle, DrillBreadcrumb,
} from './TrendChartDrill';
import {
  readStackMode, writeStackMode, type StackMode,
  type DrillCrumb, makeDrillableBarShape, toggleIsolateEntity,
  focusToRange, nextFinerGranularity, type DrillFocus,
} from './TrendChartDrillKit';
import { useTrendChartQueries } from './useTrendChartQueries';
import { useTrendChartData } from './useTrendChartData';
import { useTrendChartDerived } from './useTrendChartDerived';
import { TrendChartCanvas } from './TrendChartCanvas';
import { TrendChartControls } from './TrendChartControls';

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
// that week's actual totals. (Now lives in useTrendChartData.ts, the only
// place it's actually consumed — this comment stays as a pointer.)

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

  // Well filter for Raw Water breakdown
  const [wellSearch, setWellSearch] = useState('');
  const [showWellFilter, setShowWellFilter] = useState(false);

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

  // ── Plant Health: Day → Hour click-drill (M3/M4) ─────────────────────────
  // phHourlyData below is hour-of-day across the WHOLE fetched range (up to
  // 720 bars on a 30D window) — useful as its own manual toggle, but far too
  // dense to be what a click on a single day's dot should jump to. This
  // narrows that same hourly data down to just the clicked day, the "Day→hour,
  // nearly free" case the plan called out for TDS/Recovery/Plant Health.
  // null = the Hourly tab shows its normal full-range view.
  const [phDayFocus, setPhDayFocus] = useState<string | null>(null);
  useEffect(() => { if (!hasPlantHealth) setPhDayFocus(null); }, [hasPlantHealth]);

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

  const {
    wellNames, locatorNames, productMeterNames, _directProductMeterIds, plantNames,
    _locatorIdsForReadings, _directLocatorIds,
    locReadings, fetchingLoc, errLoc, refetchLoc,
    productReadings, fetchingProduct, errProduct, refetchProduct,
    wellReadings, fetchingWell, errWell, refetchWell,
    _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap,
    roReadings, fetchingRo, errRo, refetchRo,
    roTrainNames, permeateConfigData, permeateIsProductionPlants, productExcludedPlants,
    powerReadings, fetchingPower, errPower, refetchPower,
    costReadings, fetchingCost, errCost, refetchCost,
    powerTariffs, billMultiplierMap, powerConfigMap,
    isFetching, queryError, retryFailedQueries,
  } = useTrendChartQueries({ metric, plantIds, startISO, endISO, startKey, endKey });

  const { chartData, trendRows, kwhChartRows } = useTrendChartData({
    metric, startKey, endKey, startISO, viewGran, usesSharedGranularity, kwhSource,
    locReadings, wellReadings, productReadings, roReadings, powerReadings, costReadings,
    powerTariffs, billMultiplierMap, powerConfigMap,
    wellNames, locatorNames, productMeterNames, plantNames,
    permeateIsProductionPlants, productExcludedPlants,
    _trainPlantMap, _trainUnitTypeMap, _directLocatorIds, _directProductMeterIds,
  });


  const {
    drillEntities, usePermeateForSource, sourceDrillEntities, activeEntities, visibleEntities,
    filteredLocatorList, locatorTotals, selectTopNLocators,
    wellEntities, visibleWellEntities, wellEntityRows, handleWellLegendIsolate,
    filteredWellList, wellTotals, selectTopNWells, allWellsSelected, noneWellsSelected,
    toggleWell, selectAllWells, clearAllWells,
    allSelected, noneSelected, toggleLocator, selectAllLocators, clearAllLocators,
    entityRows, roTrainEntities, visibleTrainEntities, filteredTrainList, allTrainsSelected, noTrainsSelected,
    toggleTrain, selectAllTrains, clearAllTrains, valueKey, roUnit,
    roTrainDrillData, roHourDrillData, phTotalTrains, phDailyData, phHourlyData, phMonthlyData, phWeeklyData,
    phFocusedHourlyData, phActiveData, handlePhDayDotActivate, NegativeAwareTooltip, chartHeight,
    handleDrillBarActivate, drillFocusRange, focusedTrendRows, focusedEntityRows, drillCrumbs,
    handleLegendIsolate, handleTrainLegendIsolate, formatYAxis, PvTooltip,
  } = useTrendChartDerived({
    metric, compact, drillFocus, setDrillFocus, drillMode, range,
    selectedLocatorIds, setSelectedLocatorIds, locatorSearch,
    selectedTrainIds, setSelectedTrainIds, trainSearch,
    selectedWellIds, setSelectedWellIds, wellSearch,
    prodDrillSource, roDrillMode, phDrillMode, setPhDrillMode, phDayFocus, setPhDayFocus,
    viewGran, setViewGran, viewBreakdown, setViewBreakdown, rawwaterBreakdown,
    hasConsumptionDrill, hasRoDrill, hasPlantHealth,
    startKey, endKey,
    trendRows, chartData,
    wellNames, locatorNames, productMeterNames, plantNames, roTrainNames,
    wellReadings, locReadings, productReadings, roReadings,
    _directLocatorIds, _directProductMeterIds, _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap,
  });

  return (
    <>
      <TrendChartToolbar
        metric={metric}
        title={title}
        range={range}
        from={from}
        to={to}
        isFetching={isFetching}
        onRangeChange={setRange}
        onFromChange={handleFromChange}
        onToChange={handleToChange}
        onOpenSummary={() => setShowSummary(true)}
        trailingControls={
        <TrendChartControls
          metric={metric} compact={compact} viewGran={viewGran} setViewGran={setViewGran}
          viewBreakdown={viewBreakdown} setViewBreakdown={setViewBreakdown}
          rawwaterBreakdown={rawwaterBreakdown} setRawwaterBreakdown={setRawwaterBreakdown}
          stackMode={stackMode} setStackMode={setStackMode}
          kwhSource={kwhSource} setKwhSource={setKwhSource} chartData={chartData}
          range={range} rangeDays={rangeDays}
          selectedLocatorIds={selectedLocatorIds} setSelectedLocatorIds={setSelectedLocatorIds}
          selectedWellIds={selectedWellIds} setSelectedWellIds={setSelectedWellIds}
          roDrillMode={roDrillMode} setRoDrillMode={setRoDrillMode}
          showTrainFilter={showTrainFilter} setShowTrainFilter={setShowTrainFilter}
          showWellFilter={showWellFilter} setShowWellFilter={setShowWellFilter}
          phDrillMode={phDrillMode} setPhDrillMode={setPhDrillMode}
          phDayFocus={phDayFocus} setPhDayFocus={setPhDayFocus}
          showTotalCostLine={showTotalCostLine} setShowTotalCostLine={setShowTotalCostLine}
          showPowerCostLine={showPowerCostLine} setShowPowerCostLine={setShowPowerCostLine}
          showChemCostLine={showChemCostLine} setShowChemCostLine={setShowChemCostLine}
          prodDrillSource={prodDrillSource} usePermeateForSource={usePermeateForSource} drillMode={drillMode}
          hasConsumptionDrill={hasConsumptionDrill} hasRoDrill={hasRoDrill} hasPlantHealth={hasPlantHealth}
          allSelected={allSelected} noneSelected={noneSelected}
          selectAllLocators={selectAllLocators} clearAllLocators={clearAllLocators} toggleLocator={toggleLocator}
          allWellsSelected={allWellsSelected} noneWellsSelected={noneWellsSelected}
          selectAllWells={selectAllWells} clearAllWells={clearAllWells} toggleWell={toggleWell}
          allTrainsSelected={allTrainsSelected} noTrainsSelected={noTrainsSelected}
          selectAllTrains={selectAllTrains} clearAllTrains={clearAllTrains} toggleTrain={toggleTrain}
          drillEntities={drillEntities} roTrainEntities={roTrainEntities} selectedTrainIds={selectedTrainIds}
          wellEntities={wellEntities}
          filteredLocatorList={filteredLocatorList} filteredTrainList={filteredTrainList}
          filteredWellList={filteredWellList}
          locatorSearch={locatorSearch} setLocatorSearch={setLocatorSearch}
          trainSearch={trainSearch} setTrainSearch={setTrainSearch}
          wellSearch={wellSearch} setWellSearch={setWellSearch}
          showLocatorFilter={showLocatorFilter} setShowLocatorFilter={setShowLocatorFilter}
          locatorTotals={locatorTotals} wellTotals={wellTotals}
          selectTopNLocators={selectTopNLocators} selectTopNWells={selectTopNWells}
        />
        }
      />

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
          directMeterIds={_directProductMeterIds}
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
                  <GridPylonIcon className="h-3.5 w-3.5 text-info shrink-0" />
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

      {(hasConsumptionDrill || (hasRoDrill && roDrillMode === 'by-train') || (metric === 'rawwater' && rawwaterBreakdown === 'by-well') || (hasPlantHealth && phDayFocus)) && <DrillBreadcrumb crumbs={drillCrumbs} />}

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
        <TrendChartCanvas
          hasRoDrill={hasRoDrill} roDrillMode={roDrillMode} viewGran={viewGran}
          roTrainDrillData={roTrainDrillData} roHourDrillData={roHourDrillData}
          hasConsumptionDrill={hasConsumptionDrill} hasPlantHealth={hasPlantHealth}
          phDrillMode={phDrillMode} phActiveData={phActiveData} phDayFocus={phDayFocus}
          metric={metric} drillMode={drillMode} chartData={chartData} trendRows={trendRows}
          kwhChartRows={kwhChartRows} kwhSource={kwhSource}
          entityRows={entityRows} visibleEntities={visibleEntities}
          wellEntityRows={wellEntityRows} visibleWellEntities={visibleWellEntities}
          visibleTrainEntities={visibleTrainEntities}
          focusedTrendRows={focusedTrendRows} focusedEntityRows={focusedEntityRows}
          drillFocusRange={drillFocusRange}
          formatYAxis={formatYAxis} handleDrillBarActivate={handleDrillBarActivate}
          handlePhDayDotActivate={handlePhDayDotActivate}
          handleLegendIsolate={handleLegendIsolate} handleTrainLegendIsolate={handleTrainLegendIsolate}
          handleWellLegendIsolate={handleWellLegendIsolate}
          NegativeAwareTooltip={NegativeAwareTooltip} PvTooltip={PvTooltip}
          valueKey={valueKey} roUnit={roUnit}
          showTotalCostLine={showTotalCostLine} showPowerCostLine={showPowerCostLine} showChemCostLine={showChemCostLine}
          stackMode={stackMode} rawwaterBreakdown={rawwaterBreakdown} viewBreakdown={viewBreakdown}
          prodDrillSource={prodDrillSource}
        />
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
