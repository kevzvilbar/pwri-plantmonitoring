import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import type { PlantAlert, PlantAlertSeverity } from '@/store/appStore';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// deltaCache sits in front of every raw-reading computation.
//   • Cache hit  → return the stored value instantly (no recomputation).
//   • Cache miss → compute from raw rows, populate cache, return computed value.
//   • Mutation   → Operations/ROTrains/Plants call flushDeltaCache(entityIds)
//                  which clears affected entries so the next render recomputes.
// hydrateFromStoredDeltas seeds the cache from DB-stored deltas (daily_volume,
// permeate_meter_delta) so that simple reads never recompute unnecessarily.
import { deltaCache, hydrateFromStoredDeltas, flushDeltaCache } from '@/lib/deltaCache';
import { usePlants } from '@/hooks/usePlants';
import { fmtNum, nrwColor, ALERTS } from '@/lib/calculations';
import {
  evaluateROMeterSpike, computeROAverageFlowRate, evaluatePhaseImbalance, evaluatePhaseLoss, dpPsi,
  type ROMeterKind,
} from '@/lib/roReadingGuards';
import { computeRate, classifyDeviation, computeRollingAverageRateFromDeltas, type VolumePoint } from '@/lib/flowRateGuards';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { format, subDays, startOfDay, parseISO, addDays } from 'date-fns';
import {
  Droplet, Activity, Zap, FlaskConical, AlertTriangle, Gauge, Percent,
  Waves, Cloud, Receipt, Banknote, LayoutGrid, ListCollapse, ExternalLink,
  ArrowUpRight, ArrowDownRight, Minus, CalendarDays,
  ShieldAlert, History, RefreshCw
} from 'lucide-react';
import { useTrainAutoOffline } from '@/hooks/useTrainAutoOffline';
import { DowntimeEventsModal } from '@/components/DowntimeEventsModal';
import { BlendingVolumeCard } from '@/components/BlendingVolumeCard';
import { RawWaterIcon } from '@/components/icons/water-icons';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { calc } from '@/lib/calculations';
import {
  StatCard, PerWellSourceCard, ClusterHeader,
} from '@/components/dashboard/StatCard';
import {
  ClusterCharts, TrendModal, InlineTrendChart,
} from '@/components/dashboard/TrendChartWrappers';
import {
  DashboardViewMode, VIEW_MODE_KEY, readSavedViewMode, pctDelta,
  OVERVIEW_CHART_METRICS, QUALITY_CHART_METRICS, COST_CHART_METRICS, ChartMetric,
} from '@/components/dashboard/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PlantPulseHero }       from '@/components/dashboard/PlantPulseHero';
import { PlantHealthStrip }    from '@/components/dashboard/PlantHealthStrip';
import { NRWGaugeCard }        from '@/components/dashboard/NRWGaugeCard';
import { WaterBalanceBridgeCard } from '@/components/dashboard/WaterBalanceBridgeCard';
import { ReadingCoverageCard } from '@/components/dashboard/ReadingCoverageCard';
import { PMDueSoonCard }       from '@/components/dashboard/PMDueSoonCard';
import { PendingReviewCard }   from '@/components/dashboard/PendingReviewCard';
import { DataCompletenessRadarCard } from '@/components/dashboard/DataCompletenessRadarCard';
import { CostSunburst }        from '@/components/dashboard/CostSunburst';
import { DateRangePicker } from '@/components/ui/date-picker';
import { MonthlyPeriodBar } from '@/components/dashboard/MonthlyPeriodBar';
import { DashboardSectionNav } from '@/components/dashboard/DashboardSectionNav';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import { useDashboardQueries } from './useDashboardQueries';
import { useDashboardAggregates } from './useDashboardAggregates';
import { useDashboardAlerts } from './useDashboardAlerts';

// ─── Dashboard ────────────────────────────────────────────────────────────────

// ── Permeate production helpers ──────────────────────────────────────────────
// Returns the ISO date string (YYYY-MM-DD, local) that a permeate reading
// should be attributed to, honouring the optional daily cut-off time.
//
// Rule: readings at or before the cut-off time on date D belong to day D.
// Readings AFTER the cut-off on date D belong to day D+1.
// When cutoff is disabled (or null) the natural calendar date is used.
//
// Example (cutoff 00:20):
//   May 4 00:05  → May 4  (before cut-off, still "today")
//   May 4 00:21  → May 5  (after cut-off, first reading of next day's period)
//   May 3 23:00  → May 4  wait — that's wrong. Let me re-read the rule.
// Correct rule from UI: "May 4 = readings from May 3 00:21 to May 4 00:20"


export default function Dashboard() {
  // Use fine-grained selectors so Dashboard only re-renders when selectedPlantId
  // changes — NOT when addAlerts updates plantAlerts in the store.
  // Without selectors, every addAlerts() call would re-render Dashboard →
  // re-run the useEffect → call addAlerts() again → infinite loop (React #185).
  const selectedPlantId = useAppStore((s) => s.selectedPlantId);
  const addAlerts       = useAppStore((s) => s.addAlerts);
  const removeAlerts    = useAppStore((s) => s.removeAlerts);
  const chartRange      = useAppStore((s) => s.chartRange);
  const chartFrom       = useAppStore((s) => s.chartFrom);
  const chartTo         = useAppStore((s) => s.chartTo);
  const chartYear       = useAppStore((s) => s.chartYear);
  const chartMonth      = useAppStore((s) => s.chartMonth);
  const setChartRange   = useAppStore((s) => s.setChartRange);
  const setChartCustomDates   = useAppStore((s) => s.setChartCustomDates);
  const setChartMonthlyPeriod = useAppStore((s) => s.setChartMonthlyPeriod);
  const { data: plants } = usePlants();
  const navigate = useNavigate();
  const [modal, setModal] = useState<null | { metric: string; title: string }>(null);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(2);
  useEffect(() => {
    const timer = setInterval(() => setSecondsAgo(s => (s % 20) + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Compliance Thresholds (derived from compliance settings, per-plant or global) ──
  const thresholdScope = selectedPlantId || 'global';
  const { data: complianceThresholds } = useQuery({
    queryKey: ['thresholds', thresholdScope],
    queryFn: () => loadThresholds(thresholdScope),
    staleTime: 2 * 60_000,
  });
  const thresholds = complianceThresholds ?? DEFAULT_THRESHOLDS;

  // ── Enhancement ⑥: open incident count for the compliance badge ───────────
  const { data: openIncidentCount = 0 } = useQuery<number>({
    queryKey: ['open-incidents-count', selectedPlantId],
    queryFn: async () => {
      let q = supabase
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Open');
      if (selectedPlantId) q = (q as any).eq('plant_id', selectedPlantId);
      const { count } = await q;
      return count ?? 0;
    },
    staleTime: 2 * 60_000,
  });

  // View mode controls how trend graphs surface on the dashboard.
  // See `components/dashboard/types.ts` for definitions. Lazy-init
  // from localStorage so the user's preference survives reload
  // without a flash of "inline".
  // Default to 'sections' so clicking a KPI card expands its chart inline.
  // Falls back to whatever was saved in localStorage from a previous visit.
  const [viewMode, setViewMode] = useState<DashboardViewMode>(() => {
    try {
      const v = window.localStorage.getItem(VIEW_MODE_KEY) as DashboardViewMode | null;
      if (v === 'inline' || v === 'sections' || v === 'popup') return v;
    } catch { /* Safari private / quota */ }
    return 'sections';
  });
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
      console.warn('[Dashboard] could not persist view mode preference:', err);
    }
  };
  // Returns the click handler for chart-bearing KPI cards. Behaviour:
  //   • sections → toggle this metric's collapsible chart (single-open, default)
  //   • popup    → open the TrendModal in a dialog
  //   • inline   → auto-switch to sections mode and expand the clicked metric
  //                (inline already shows charts; clicking gives a focused view)
  const handleMetricClick = (metric: string, title: string): (() => void) => {
    return () => {
      if (viewMode === 'sections') {
        setExpandedMetric((prev) => (prev === metric ? null : metric));
      } else if (viewMode === 'popup') {
        setModal({ metric, title });
      } else {
        // inline → switch to sections so the chart collapses into a focused view
        persistViewMode('sections');
        setExpandedMetric(metric);
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
  const _yesterdayKey = format(subDays(new Date(), 1), 'yyyy-MM-dd'); // promoted here so permeate queries can use it
  const today     = new Date(_localDateStr + 'T00:00:00').toISOString();   // local midnight → ISO
  const yesterday = new Date(format(subDays(new Date(), 1), 'yyyy-MM-dd') + 'T00:00:00').toISOString();

  // ----- Today aggregates from raw tables -----
  //
  // IMPORTANT: locator_readings and well_readings do NOT have a plant_id column.
  // Filtering them with .in('plant_id', plantIds) returns zero rows — which is
  // why the stat cards were showing 0 m³. We must first resolve the entity IDs
  // (locator_id / well_id) for this plant, then query by those IDs.

  const {
    _locatorIds, _directLocatorIds, _directProductMeterIds, _wellIds,
    todayLocators, todayWells, todayProductMeters,
    plantMeterConfigs, permeateProductionPlantIds, productExcludedPlantIds,
    _permeateTrainMeta, _permeateTrainIds, _permeateTrainPlantMap,
    todayRoPermeate, _dayBeforeYesterdayKey, yRoPermeate,
    todayPowerRaw, todayPower, powerIsStale, dashPowerConfigMap,
    yLocators, yWells, yProductMeters, yPower,
    _qualityTrainMeta, _qualityTrainIds, _qualityTrainMeta2, _wellNamesByTrainWell,
    latestRO, roHistory10d, roAvgFlowByTrain,
    recentPretreatment, latestPumpReadings,
    powerHistory, powerAvgByPlant, prevPowerRowByPlant,
    productMetersHaveData, todayAllPermeate,
    todayCostsRaw, todayCosts, costDataDate, costIsStale, dashTariffByPlant, dashDosingPeso,
    blendingTodayRows,
  } = useDashboardQueries({
    plantIds, today, yesterday, _localDateStr, _yesterdayKey, plants,
  });

  const {
    _todayKey, rawWaterVol, roPermeateProduction, yRoPermeateProduction,
    production, consumption, kwh, powerCostPeso: todayPowerCostPeso, nrw, pv,
    yRawWaterVol, yProduction, yConsumption, yKwh, dProduction, dConsumption, dRawWater, dKwh,
    yNrw, nrwBreached, roByTrain, wellsByQuality,
    avgPermTds, avgFeedTds, avgRecovery, avgTurb, wellsWithTds, wellsWithNtu, avgRawTds, avgRawTurb,
    plantCodeById, hasCostData, prodCostsChem, chemCostTotal, chemCost, powerCost, productionCost,
    blending, chemInv, trainGaps, wellGaps, locatorGaps, trainHourlyGaps, _localROPerTrain, feed, feedAlerts,
  } = useDashboardAggregates({
    plantIds, today, yesterday, _localDateStr, _yesterdayKey, plants, selectedPlantId,
    _directLocatorIds, _directProductMeterIds,
    todayLocators, todayWells, todayProductMeters,
    permeateProductionPlantIds, productExcludedPlantIds,
    todayRoPermeate, yRoPermeate, todayPowerRaw, todayPower, dashPowerConfigMap,
    yLocators, yWells, yProductMeters, yPower,
    _qualityTrainMeta2, _wellNamesByTrainWell, latestRO,
    todayAllPermeate, todayCosts, costIsStale, dashTariffByPlant, dashDosingPeso,
    blendingTodayRows,
  });

  const {
    plantNameById, roMeterSpikes, pretreatmentAlerts, pumpElectricalAlerts,
  } = useDashboardAlerts({
    selectedPlantId, addAlerts, removeAlerts, plants, plantIds,
    latestRO, roAvgFlowByTrain, recentPretreatment, latestPumpReadings,
    powerAvgByPlant, prevPowerRowByPlant, todayPower, powerIsStale,
    nrw, nrwBreached, feedAlerts, trainGaps, wellGaps, locatorGaps, trainHourlyGaps, chemInv, consumption, _qualityTrainMeta2,
  });

  const netBalance = (production ?? 0) - (consumption ?? 0);
  const selectedPlantName = selectedPlantId ? plants?.find(p => p.id === selectedPlantId)?.name : 'All Production Facilities';

  return (
    <div className="space-y-3 animate-fade-in">
      
      {/* ─── Unified Hero: Live Plant Pulse & Operations Command ─── */}
      <PlantPulseHero
        plantIds={plantIds}
        selectedPlantName={selectedPlantName}
        openIncidentCount={openIncidentCount}
        secondsAgo={secondsAgo}
        production={production}
        dProduction={dProduction}
        viewMode={viewMode}
        onViewModeChange={persistViewMode}
        onOpenDowntime={() => setDowntimeOpen(true)}
        onSelectPlant={(pid) => navigate(`/plants/${pid}`)}
        onViewIncidents={() => navigate('/incidents')}
      />

      {/* ① Plant health strip — per-plant status dots + last reading time */}
      <PlantHealthStrip 
        plantIds={plantIds} 
        onSelectPlant={(pid) => navigate(`/plants/${pid}`)}
      />

      {/* ─── Dashboard Time Range & Monthly Period Control ─── */}
      <div className="p-2 rounded-xl border border-border/60 bg-card/70 backdrop-blur-xs flex flex-wrap items-center justify-between gap-2 shadow-2xs">
        <div className="flex items-center gap-2 flex-wrap">
          {chartRange !== 'MONTHLY' ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-3xs uppercase font-bold tracking-wider text-muted-foreground mr-0.5 flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                <span className="hidden xs:inline">Range:</span>
              </span>
              <div className="flex items-center gap-0.5 bg-muted/60 p-0.5 rounded-lg border border-border/60">
                {(['7D', '14D', '30D', '60D', '90D'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setChartRange(r)}
                    data-testid={`dash-range-${r}`}
                    className={[
                      'h-7 px-2.5 text-2xs font-semibold rounded-md transition-all cursor-pointer',
                      chartRange === r
                        ? 'bg-card text-primary shadow-xs border border-border/80'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    {r}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setChartRange('CUSTOM')}
                  data-testid="dash-range-CUSTOM"
                  className={[
                    'h-7 px-2.5 text-2xs font-semibold rounded-md transition-all cursor-pointer',
                    chartRange === 'CUSTOM'
                      ? 'bg-card text-primary shadow-xs border border-border/80'
                      : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  Custom
                </button>
                <div className="h-3.5 border-r border-border/40 mx-0.5" aria-hidden />
                <button
                  type="button"
                  onClick={() => setChartRange('MONTHLY')}
                  data-testid="dash-range-MONTHLY"
                  className="h-7 px-2.5 text-2xs font-semibold rounded-md transition-all cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  Monthly
                </button>
              </div>

              {chartRange === 'CUSTOM' && (
                <DateRangePicker
                  from={chartFrom}
                  to={chartTo}
                  onChange={({ from: f, to: t }) => setChartCustomDates(f, t)}
                  size="sm"
                  className="h-7 w-[200px] text-2xs px-2"
                />
              )}
            </div>
          ) : (
            <MonthlyPeriodBar
              year={chartYear}
              selectedMonth={chartMonth}
              onPeriodChange={setChartMonthlyPeriod}
              onBackToDays={() => setChartRange('7D')}
              testIdPrefix="dash-monthly"
            />
          )}
        </div>

        <div className="text-3xs font-mono text-muted-foreground shrink-0 px-1 hidden sm:block">
          {chartRange === 'MONTHLY'
            ? chartMonth === 'YTD'
              ? `Full Year ${chartYear}`
              : `${chartYear}-${chartMonth}`
            : `${chartFrom} → ${chartTo}`}
        </div>
      </div>

      {/* ─── Sticky Cluster Quick-Jump Section Navigation ─── */}
      <DashboardSectionNav />

      {/* ─── Cluster 1: Overview ─── */}
      <section id="overview-cluster" className="scroll-mt-28 space-y-2.5">
        <ClusterHeader icon={Droplet} title="Overview" accent="text-primary" subtitle="Distribution & Sources" />
        
        {/* 4-Column Operational Overview Grid */}
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
          {/* 1. Locators Consumption / Offtake */}
          <StatCard
            icon={Receipt}
            accent="text-highlight"
            label="Locators Consumption"
            value={fmtNum(consumption)}
            unit="m³"
            trend={dConsumption}
            onClick={handleMetricClick('production', 'Production vs Consumption')}
          />

          {/* 2. NRW Gauge Card */}
          <NRWGaugeCard
            nrw={nrw}
            yNrw={yNrw}
            onClick={handleMetricClick('nrw', 'NRW Trend')}
          />

          {/* 3. Raw Water Extraction */}
          <StatCard
            icon={RawWaterIcon}
            accent="text-info"
            label="Raw Water"
            value={fmtNum(rawWaterVol)}
            unit="m³"
            trend={dRawWater}
            onClick={handleMetricClick('rawwater', 'Raw Water (m³)')}
          />

          {/* 4. Blending Volume */}
          <StatCard
            icon={Waves}
            accent="text-kpi-ro"
            label="Blending"
            value={fmtNum(blending)}
            unit="m³"
          />
        </div>

        <ClusterCharts metrics={OVERVIEW_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="overview" />
        <WaterBalanceBridgeCard plantIds={plantIds} />
      </section>

      {/* ─── Cluster 2: Quality ─── */}
      <section id="quality-cluster" className="scroll-mt-28 space-y-2.5">
        <ClusterHeader icon={FlaskConical} title="Quality" accent="text-accent" subtitle="RO output" />
        <div className="stagger-grid grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          {/* Feed TDS — expandable per-train breakdown (chevron, hidden by default) */}
          <StatCard
            icon={Gauge}
            label="Feed TDS"
            value={avgFeedTds ?? '—'}
            unit="ppm"
            expandRows={roByTrain.map((r) => ({
              label: r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?'),
              value: r.feed_tds != null ? Math.round(r.feed_tds) : null,
            }))}
            expandUnit="ppm"
          />
          {/* Product TDS — expandable per-train breakdown (chevron, hidden by default) */}
          <StatCard
            icon={FlaskConical}
            accent="text-accent"
            label="Product TDS"
            value={avgPermTds ?? '—'}
            unit="ppm"
            threshold={`≤${thresholds.permeate_tds_max}`}
            calc
            calcTooltip={`Product TDS compliance limit: ≤ ${thresholds.permeate_tds_max} ppm`}
            onClick={handleMetricClick('tds', 'Permeate TDS Trend')}
            expandRows={roByTrain.map((r) => ({
              label: r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?'),
              value: r.permeate_tds != null ? Math.round(r.permeate_tds) : null,
            }))}
            expandUnit="ppm"
          />
          {/* Raw TDS — per-well breakdown from well_readings.tds_ppm (Operations data) */}
          <PerWellSourceCard
            icon={Gauge}
            label="Raw TDS"
            unit="ppm"
            aggregate={avgRawTds}
            rows={wellsByQuality}
            field="tds_ppm"
            plantCodeById={plantCodeById}
            multiPlant={plantIds.length > 1}
            testId="raw-tds-per-well-source"
          />
          {/* Raw NTU — per-well breakdown from well_readings.turbidity_ntu (Operations data) */}
          <PerWellSourceCard
            icon={Cloud}
            label="Raw NTU"
            unit="NTU"
            aggregate={avgRawTurb}
            rows={wellsByQuality}
            field="turbidity_ntu"
            plantCodeById={plantCodeById}
            multiPlant={plantIds.length > 1}
            testId="raw-ntu-per-well-source"
            decimals={2}
          />
          <StatCard
            icon={Percent}
            label="Recovery"
            value={avgRecovery ?? '—'}
            unit="%"
            threshold={`≥${thresholds.recovery_pct_min}%`}
            calc
            calcTooltip={`Recovery compliance target: ≥ ${thresholds.recovery_pct_min}%`}
            onClick={handleMetricClick('recovery', 'Recovery Trendline')}
          />
        </div>
        <ClusterCharts metrics={QUALITY_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="quality" />
      </section>

      {/* ─── Cluster 3: Production Cost (Power + Chemical) ─── */}
      <section id="cost-cluster" className="scroll-mt-28 space-y-2.5">
        <ClusterHeader
          icon={Zap}
          title="Production Cost (Power + Chemical)"
          accent="text-chart-6"
          subtitle={
            costIsStale && costDataDate
              ? `as of ${format(new Date(costDataDate + 'T00:00:00'), 'MMM d')}`
              : 'Today'
          }
        />
        <div className="stagger-grid grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
          <StatCard icon={Banknote} accent="text-accent" label="Total Production Cost"
            calc
            calcTooltip={
              costIsStale && costDataDate
                ? `Production Cost = (kWh × tariff rate) + Chemical Cost (latest data: ${format(new Date(costDataDate + 'T00:00:00'), 'MMM d, yyyy')})`
                : 'Production Cost = Power Cost (kWh × ₱/kWh) + Chemical Cost (today)'
            }
            value={productionCost == null ? '—' : `₱${fmtNum(productionCost, 0)}`}
            onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
          <StatCard icon={Zap} accent="text-chart-6" label="Power Cost"
            calc
            calcTooltip="Power Cost = Power kWh × tariff rate (₱/kWh) from power_tariffs — same formula as chart"
            value={powerCost == null ? '—' : `₱${fmtNum(powerCost, 0)}`}
            onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
          <StatCard icon={FlaskConical} accent="text-highlight" label="Chemical Cost"
            value={chemCost == null ? '—' : `₱${fmtNum(chemCost, 0)}`}
            onClick={handleMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />
          <StatCard icon={Zap} accent="text-chart-6" label="Power kWh"
            value={powerIsStale || kwh > 0 ? fmtNum(kwh) : '—'}
            unit={kwh > 0 ? 'kWh' : undefined}
            trend={dKwh}
            onClick={handleMetricClick('kwh', 'Power Consumption & Energy Mix')} />
          <StatCard
            icon={Zap}
            accent="text-chart-6"
            label="PV Ratio"
            value={pv == null ? '—' : pv}
            unit="kWh/m³"
            calc
            threshold={`≤${thresholds.pv_ratio_max}`}
            calcTooltip={`PV Ratio = Power kWh ÷ Production m³ (target: ≤ ${thresholds.pv_ratio_max} kWh/m³)`}
            onClick={handleMetricClick('pv', 'PV Ratio Trend')}
          />
        </div>
        <ClusterCharts
          metrics={[
            ...COST_CHART_METRICS.filter((m: ChartMetric) => m.metric !== 'kwh'),
            { metric: 'kwh', title: 'Power Consumption & Energy Mix' },
          ] as ChartMetric[]}
          viewMode={viewMode}
          expandedMetric={expandedMetric}
          plantIds={plantIds}
          clusterId="cost"
        />
      </section>

      {/* ─── Cluster 4: Audits & Multi-Facility Analytics ─── */}
      <section id="audits-cluster" className="scroll-mt-28 space-y-2.5">
        <ClusterHeader icon={ShieldAlert} title="Audits & Multi-Facility Analytics" accent="text-highlight" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <DataCompletenessRadarCard plantIds={plantIds} />
          <CostSunburst plantIds={plantIds} />
        </div>
      </section>

      {/* ─── Cluster 5: Operations & Plant Health ─── */}
      <section id="health-cluster" className="scroll-mt-28 space-y-2.5">
        <ClusterHeader icon={Activity} title="Plant Health Trend" accent="text-accent" subtitle="RO trains" />
        <InlineTrendChart metric="plantHealth" title="Plant Health Trend" plantIds={plantIds} compact={viewMode === 'inline'} />

        {/* Coverage, PM due, and review cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ReadingCoverageCard plantIds={plantIds} />
          <PMDueSoonCard       plantIds={plantIds} />
          <PendingReviewCard   plantIds={plantIds} />
        </div>

        <BlendingVolumeCard plantIds={plantIds} />
      </section>

      <TrendModal open={!!modal} onClose={() => setModal(null)} metric={modal?.metric ?? ''} title={modal?.title ?? ''} plantIds={plantIds} />
      <DowntimeEventsModal
        open={downtimeOpen}
        onClose={() => setDowntimeOpen(false)}
        plantId={selectedPlantId || undefined}
        plantName={selectedPlantId ? visiblePlants?.[0]?.name : 'All plants'}
      />
    </div>
  );
}
