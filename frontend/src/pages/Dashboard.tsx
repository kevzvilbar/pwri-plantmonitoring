import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlantStore } from '@/store/plantStore';
import { useChartStore } from '@/store/chartStore';
import { useAlertStore } from '@/store/alertStore';
import type { PlantAlert, PlantAlertSeverity } from '@/store/alertStore';
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
  AlertTriangle, LayoutGrid, ListCollapse, ExternalLink,
  ArrowUpRight, ArrowDownRight, Minus, CalendarDays,
  History, RefreshCw
} from 'lucide-react';
import { useTrainAutoOffline } from '@/hooks/useTrainAutoOffline';
import { DowntimeEventsModal } from '@/components/DowntimeEventsModal';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { calc } from '@/lib/calculations';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DashboardViewMode, VIEW_MODE_KEY, readSavedViewMode, pctDelta,
  OVERVIEW_CHART_METRICS, QUALITY_CHART_METRICS, COST_CHART_METRICS, ChartMetric,
} from '@/components/dashboard/types';
import { PlantPulseHero }       from '@/components/dashboard/PlantPulseHero';
import { PlantHealthStrip }    from '@/components/dashboard/PlantHealthStrip';
import { RangeAndMonthlyPicker } from '@/components/dashboard/RangeAndMonthlyPicker';
import { DashboardSectionNav } from '@/components/dashboard/DashboardSectionNav';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import { useDashboardQueries } from './useDashboardQueries';
import { useDashboardAggregates } from './useDashboardAggregates';
import { useDashboardAlerts } from './useDashboardAlerts';
import { OverviewCluster } from './Dashboard/OverviewCluster';
import { QualityCluster } from './Dashboard/QualityCluster';
import { CostCluster } from './Dashboard/CostCluster';
import { AuditsCluster } from './Dashboard/AuditsCluster';
import { HealthCluster } from './Dashboard/HealthCluster';
import { TrendModal } from '@/components/dashboard/TrendChartWrappers';

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
  const selectedPlantId = usePlantStore((s) => s.selectedPlantId);
  const addAlerts       = useAlertStore((s) => s.addAlerts);
  const removeAlerts    = useAlertStore((s) => s.removeAlerts);
  const chartRange      = useChartStore((s) => s.chartRange);
  const chartFrom       = useChartStore((s) => s.chartFrom);
  const chartTo         = useChartStore((s) => s.chartTo);
  const chartYear       = useChartStore((s) => s.chartYear);
  const chartMonth      = useChartStore((s) => s.chartMonth);
  const setChartRange   = useChartStore((s) => s.setChartRange);
  const setChartCustomDates   = useChartStore((s) => s.setChartCustomDates);
  const setChartMonthlyPeriod = useChartStore((s) => s.setChartMonthlyPeriod);
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

      <PlantHealthStrip
        plantIds={plantIds}
        onSelectPlant={(pid) => navigate(`/plants/${pid}`)}
      />

      <div className="p-2 rounded-xl border border-border/60 bg-card/70 backdrop-blur-xs flex flex-wrap items-center justify-between gap-2 shadow-2xs">
        <div className="flex items-center gap-2 flex-wrap">
          {chartRange !== 'MONTHLY' && (
            <span className="text-3xs uppercase font-bold tracking-wider text-muted-foreground mr-0.5 flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              <span className="hidden xs:inline">Range:</span>
            </span>
          )}
          <RangeAndMonthlyPicker
            range={chartRange}
            onRangeChange={setChartRange}
            from={chartFrom}
            to={chartTo}
            onCustomDatesChange={setChartCustomDates}
            chartYear={chartYear}
            chartMonth={chartMonth}
            onMonthlyPeriodChange={setChartMonthlyPeriod}
            testIdPrefix="dash-range"
            monthlyTestIdPrefix="dash-monthly"
          />
        </div>

        <div className="text-3xs font-mono text-muted-foreground shrink-0 px-1 hidden sm:block">
          {chartRange === 'MONTHLY'
            ? chartMonth === 'YTD'
              ? `Full Year ${chartYear}`
              : `${chartYear}-${chartMonth}`
            : `${chartFrom} → ${chartTo}`}
        </div>
      </div>

      <DashboardSectionNav />

      <OverviewCluster
        consumption={consumption}
        dConsumption={dConsumption}
        nrw={nrw}
        yNrw={yNrw}
        rawWaterVol={rawWaterVol}
        dRawWater={dRawWater}
        blending={blending}
        viewMode={viewMode}
        expandedMetric={expandedMetric}
        plantIds={plantIds}
        onMetricClick={handleMetricClick}
      />

      <QualityCluster
        avgFeedTds={avgFeedTds}
        roByTrain={roByTrain}
        avgPermTds={avgPermTds}
        thresholds={thresholds}
        wellsByQuality={wellsByQuality}
        plantCodeById={plantCodeById}
        plantIds={plantIds}
        avgRecovery={avgRecovery}
        avgRawTds={avgRawTds}
        avgRawTurb={avgRawTurb}
        viewMode={viewMode}
        expandedMetric={expandedMetric}
        onMetricClick={handleMetricClick}
      />

      <CostCluster
        productionCost={productionCost}
        costIsStale={costIsStale}
        costDataDate={costDataDate}
        powerCost={powerCost}
        chemCost={chemCost}
        kwh={kwh}
        powerIsStale={powerIsStale}
        dKwh={dKwh}
        pv={pv}
        thresholds={thresholds}
        viewMode={viewMode}
        expandedMetric={expandedMetric}
        plantIds={plantIds}
        onMetricClick={handleMetricClick}
      />

      <AuditsCluster plantIds={plantIds} />

      <HealthCluster plantIds={plantIds} viewMode={viewMode} />

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
