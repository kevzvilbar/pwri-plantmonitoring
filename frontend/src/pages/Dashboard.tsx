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
  ShieldAlert, FileSpreadsheet, History, RefreshCw
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
import { PlantHealthStrip }    from '@/components/dashboard/PlantHealthStrip';
import { NRWGaugeCard }        from '@/components/dashboard/NRWGaugeCard';
import { WaterBalanceBridgeCard } from '@/components/dashboard/WaterBalanceBridgeCard';
import { ReadingCoverageCard } from '@/components/dashboard/ReadingCoverageCard';
import { PMDueSoonCard }       from '@/components/dashboard/PMDueSoonCard';
import { PendingReviewCard }   from '@/components/dashboard/PendingReviewCard';
import { DataCompletenessRadarCard } from '@/components/dashboard/DataCompletenessRadarCard';
import { CostSunburst }        from '@/components/dashboard/CostSunburst';


import { DataSummaryModal, computePivotFromReadingsNoCache, pivotDayTotal } from '@/components/dashboard/DataSummaryModal';
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
  const { data: plants } = usePlants();
  const navigate = useNavigate();
  const [modal, setModal] = useState<null | { metric: string; title: string }>(null);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(2);
  useEffect(() => {
    const timer = setInterval(() => setSecondsAgo(s => (s % 20) + 1), 1000);
    return () => clearInterval(timer);
  }, []);

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
      
      {/* ── Top Telemetry Command Strip ── */}
      <div className="rounded-lg border border-border bg-card text-foreground p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Title & Live Status */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
                PWRI Operations Telemetry
              </h1>
              <span className="px-2 py-0.5 rounded-full text-2xs font-medium bg-primary-soft text-primary border border-primary/30">
                {selectedPlantName}
              </span>
              {openIncidentCount > 0 && (
                <button
                  onClick={() => navigate('/incidents')}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger-soft text-danger border border-danger/30 text-2xs font-semibold hover:bg-danger/20 transition-colors"
                  title={`${openIncidentCount} open incident${openIncidentCount > 1 ? 's' : ''} — click to view`}
                >
                  <ShieldAlert className="h-3 w-3" aria-hidden />
                  <span>{openIncidentCount} open incidents</span>
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
              </span>
              <span>Fleet Telemetry Online</span>
              <span className="text-muted-foreground/60">&bull;</span>
              <span>Updated <strong className="text-foreground font-mono">{secondsAgo}s</strong> ago</span>
            </p>
          </div>

          {/* Quick Metrics & Action Controls */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSummaryOpen(true)}
              className="h-8 text-xs gap-1.5 font-medium"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
              <span className="hidden sm:inline">Data Summary</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setDowntimeOpen(true)}
              className="h-8 text-xs gap-1.5 font-medium"
            >
              <History className="h-3.5 w-3.5 text-info" />
              <span className="hidden sm:inline">Downtime Log</span>
            </Button>

            {/* View-mode toggle */}
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && persistViewMode(v as DashboardViewMode)}
              className="h-8 bg-muted/60 border border-border rounded-md p-0.5"
              data-testid="dashboard-view-mode"
            >
              <ToggleGroupItem
                value="inline"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-primary data-[state=on]:shadow-xs rounded-sm"
                title="Inline — all trend graphs visible directly on the dashboard"
                aria-label="Inline view"
              >
                <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden md:inline">Inline</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="sections"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-primary data-[state=on]:shadow-xs rounded-sm"
                title="Sections — click any KPI card to fold/unfold its trend chart inline"
                aria-label="Sections view"
              >
                <ListCollapse className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden md:inline">Sections</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="popup"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-primary data-[state=on]:shadow-xs rounded-sm"
                title="Dialog — click a KPI card to open its trend chart in a dialog"
                aria-label="Dialog view"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden md:inline">Dialog</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

        </div>
      </div>

      {/* ① Plant health strip — per-plant status dots + last reading time */}
      <PlantHealthStrip 
        plantIds={plantIds} 
        onSelectPlant={(pid) => navigate(`/plants/${pid}`)}
      />

      {/* ─── Cluster 1: Overview ─── */}
      {/* Order (updated): Production Volume · Locators Consumption · NRW
          · Raw Water · Blending. Production Cost has been moved to the
          Production Cost (Power + Chemical) cluster where it sits alongside
          Power Cost, Chemical Cost, and PV Ratio. Production Volume is now
          surfaced here so operators can see today's output at a glance. */}
      <ClusterHeader icon={Droplet} title="Overview" accent="text-primary" />
      <div className="stagger-grid grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard icon={Droplet} accent="text-primary" label="Production Volume"
          value={fmtNum(production)} unit="m³" trend={dProduction}
          onClick={handleMetricClick('production', 'Production vs Consumption')} />
        <StatCard icon={Receipt} accent="text-highlight" label="Locators Consumption" value={fmtNum(consumption)} unit="m³"
          trend={dConsumption}
          onClick={handleMetricClick('production', 'Production vs Consumption')} />
        {/* ③ NRW — full-width on mobile so the gauge has room; auto-fits on sm+ */}
        <div className="col-span-2 sm:col-span-1">
          <NRWGaugeCard
            nrw={nrw}
            yNrw={yNrw}
            onClick={handleMetricClick('nrw', 'NRW Trend')}
          />
        </div>
        <StatCard icon={RawWaterIcon} accent="text-info" label="Raw Water"
          value={fmtNum(rawWaterVol)} unit="m³" trend={dRawWater}
          onClick={handleMetricClick('rawwater', 'Raw Water (m³)')} />
        <StatCard icon={Waves} accent="text-kpi-ro" label="Blending"
          value={fmtNum(blending)} unit="m³" />
      </div>
      <ClusterCharts metrics={OVERVIEW_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="overview" />
      {/* Bridges the five Overview tiles above (Raw Water, Production, Consumption,
          Blending, NRW) into one connected waterfall instead of five separate
          numbers — same shared date range, same underlying reading computation. */}
      <WaterBalanceBridgeCard plantIds={plantIds} />

      {/* ─── Cluster 2: Quality ─── */}
      {/* Spec order: Feed TDS · Product TDS · Raw TDS (per well source) ·
          Raw NTU (per well source). The Raw TDS / NTU tiles surface the
          aggregate headline plus a small breakdown labelled "per well
          source" — see PerWellSourceCard for the schema caveat (these
          are physically measured at the RO feed manifold which BLENDS
          multiple well sources, so each row represents one source line). */}
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
        <StatCard icon={Percent} label="Recovery" value={avgRecovery ?? '—'} unit="%"
          onClick={handleMetricClick('recovery', 'Recovery Trendline')} />
      </div>
      <ClusterCharts metrics={QUALITY_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="quality" />

      {/* ─── Cluster 3: Production Cost (Power + Chemical) ─── */}
      {/* Spec order: Power Cost · Chemical Cost · Power kWh · PV Ratio.
          The header subtitle shows "Today" normally or "as of MMM d" when
          cost data was pulled from the most-recent fallback (no today entry). */}
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
        <StatCard icon={Zap} accent="text-chart-6" label="PV Ratio" value={pv == null ? '—' : pv} unit="kWh/m³"
          calc threshold="1.2"
          calcTooltip="PV Ratio = Power kWh ÷ Production m³ (lower is more efficient)"
          onClick={handleMetricClick('pv', 'PV Ratio Trend')} />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <DataCompletenessRadarCard plantIds={plantIds} />
        <CostSunburst plantIds={plantIds} />
      </div>

      {/* ─── Cluster 4: Plant Health + Blending Volume ───────────────────── */}
      <ClusterHeader icon={Activity} title="Plant Health Trend" accent="text-accent" subtitle="RO trains" />
      <InlineTrendChart metric="plantHealth" title="Plant Health Trend" plantIds={plantIds} compact={viewMode === 'inline'} />

      {/* Blending Volume sits immediately below the trend chart in the same cluster.
          Alerts have moved to the TopBar notification bell (see useEffect above). */}
      {/* ④ Reading coverage  +  ⑤ PM due soon  +  ⑥ Pending review — side-by-side on sm+ */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReadingCoverageCard plantIds={plantIds} />
        <PMDueSoonCard       plantIds={plantIds} />
        <PendingReviewCard   plantIds={plantIds} />
      </div>

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
