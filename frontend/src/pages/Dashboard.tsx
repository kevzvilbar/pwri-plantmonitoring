import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlantStore } from '@/store/plantStore';
import { useChartStore } from '@/store/chartStore';
import { usePlants } from '@/hooks/usePlants';
import { format, subDays } from 'date-fns';
import { DowntimeEventsModal } from '@/components/DowntimeEventsModal';
import { DashboardViewMode, VIEW_MODE_KEY, pctDelta } from '@/components/dashboard/types';
import { PlantPulseHero } from '@/components/dashboard/PlantPulseHero';
import { PlantHealthStrip } from '@/components/dashboard/PlantHealthStrip';
import { DashboardSectionNav } from '@/components/dashboard/DashboardSectionNav';
import { loadThresholds, DEFAULT_THRESHOLDS } from '@/pages/Compliance';
import {
  useProductionStats,
  usePowerStats,
  useQualityStats,
  useCostStats,
} from './Dashboard/hooks';
import { ActionCenter } from './Dashboard/ActionCenter';
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
  // Fine-grained selectors so the Dashboard does not re-render on every alert
  // store change. NOTE P3-7: the alarm computation itself now lives in
  // <AlertsRuntime /> (AppShell), so this page no longer reads addAlerts /
  // clearConditionAlerts at all.
  const selectedPlantId = usePlantStore((s) => s.selectedPlantId);
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
    // ── Data freshness indicator ─────────────────────────────────────
  // Use React Query's dataUpdatedAt for real freshness instead of a fake
  // Real data freshness from latest reading in Supabase
  const { data: latestReading } = useQuery({
    queryKey: ['latest-reading', selectedPlantId],
    queryFn: async () => {
      let q = supabase
        .from('ro_train_readings')
        .select('reading_datetime')
        .order('reading_datetime', { ascending: false })
        .limit(1);
      if (selectedPlantId) {
        q = q.eq('plant_id', selectedPlantId);
      }
      const { data, error } = await q.maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 5 * 60_000, // 5 minutes
  });
  const dataFreshness = latestReading?.reading_datetime ? new Date(latestReading.reading_datetime) : null;

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

  // ── Domain 1: Production (volume, flow, NRW, blending) ─────────────────────
  const prodStats = useProductionStats({
    plantIds,
    today,
    yesterday,
    _localDateStr,
    _yesterdayKey,
  });

  // ── Domain 2: Water Quality (RO trains, well quality, recovery, TDS, NTU) ───
  const qualityStats = useQualityStats({
    plantIds,
    plants,
    todayWells: prodStats.todayWells,
  });

  // ── Domain 3: Power (meter readings, CT ratios, kWh, power cost, PV ratio) ──
  const powerStats = usePowerStats({
    plantIds,
    today,
    yesterday,
    production: prodStats.production,
  });

  // ── Domain 4: Financials & Costs (chemical, power, total production cost) ────
  const costStats = useCostStats({
    plantIds,
    todayPowerCostPeso: powerStats.powerCostPeso,
  });

  // ── Domain 5: Dashboard Alerts ──────────────────────────────────────────────
  // P3-7: the alarm computation moved to <AlertsRuntime /> in AppShell so that a
  // cold open on any route (not just this one) evaluates alarms instead of
  // showing "All plant systems and sensors operating normally" without having
  // checked anything. Do NOT re-add useDashboardAlerts() here — one mounted
  // instance only, or useTrainAutoOffline writes duplicate status-log rows.

  const selectedPlantName = (selectedPlantId ? plants?.find(p => p.id === selectedPlantId)?.name : null) || 'All Production Facilities';

  return (
    <div className="space-y-3 animate-fade-in">

      <PlantPulseHero
        plantIds={plantIds}
        selectedPlantName={selectedPlantName}
        openIncidentCount={openIncidentCount}
                lastReadingAt={dataFreshness}
        production={prodStats.production}
        dProduction={prodStats.dProduction}
        rawWaterVol={prodStats.rawWaterVol}
        recovery={qualityStats.avgRecovery}
        specificPower={powerStats.pv}
        onOpenDowntime={() => setDowntimeOpen(true)}
        onSelectPlant={(pid) => navigate(`/plants/${pid}`)}
        onViewIncidents={() => navigate('/incidents')}
      />

      <PlantHealthStrip
        plantIds={plantIds}
        onSelectPlant={(pid) => navigate(`/plants/${pid}`)}
      />

      {/* Unified sticky control bar: sections + range + view-mode (single source) */}
      <DashboardSectionNav
        viewMode={viewMode}
        onViewModeChange={persistViewMode}
        range={chartRange}
        onRangeChange={setChartRange}
        chartFrom={chartFrom}
        chartTo={chartTo}
        onCustomDatesChange={setChartCustomDates}
        chartYear={chartYear}
        chartMonth={chartMonth}
        onMonthlyPeriodChange={setChartMonthlyPeriod}
      />

      {/* Ops-first order: Action → Overview (water flow) → Quality → Cost → Health → Trust */}
      <ActionCenter plantIds={plantIds} />

      <OverviewCluster
        consumption={prodStats.consumption}
        dConsumption={prodStats.dConsumption}
        nrw={prodStats.nrw}
        yNrw={prodStats.yNrw}
        rawWaterVol={prodStats.rawWaterVol}
        dRawWater={prodStats.dRawWater}
        roFlowVol={prodStats.roPermeateProduction || (prodStats.todayAllPermeate?.reduce((s: number, r: any) => s + (+r.permeate_meter_delta || 0), 0) || null)}
        dRoFlow={pctDelta(prodStats.roPermeateProduction, prodStats.yRoPermeateProduction)}
        blending={prodStats.blending}
        viewMode={viewMode}
        expandedMetric={expandedMetric}
        plantIds={plantIds}
        onMetricClick={handleMetricClick}
      />

      <QualityCluster
        avgFeedTds={qualityStats.avgFeedTds}
        roByTrain={qualityStats.roByTrain}
        avgPermTds={qualityStats.avgPermTds}
        thresholds={thresholds}
        wellsByQuality={qualityStats.wellsByQuality}
        plantCodeById={qualityStats.plantCodeById}
        plantIds={plantIds}
        avgRecovery={qualityStats.avgRecovery}
        avgRawTds={qualityStats.avgRawTds}
        avgRawTurb={qualityStats.avgRawTurb}
        viewMode={viewMode}
        expandedMetric={expandedMetric}
        onMetricClick={handleMetricClick}
      />

      <CostCluster
        productionCost={costStats.productionCost}
        costIsStale={costStats.costIsStale}
        costDataDate={costStats.costDataDate}
        powerCost={costStats.powerCost}
        chemCost={costStats.chemCost}
        kwh={powerStats.kwh}
        powerIsStale={powerStats.powerIsStale}
        dKwh={powerStats.dKwh}
        pv={powerStats.pv}
        thresholds={thresholds}
        viewMode={viewMode}
        expandedMetric={expandedMetric}
        plantIds={plantIds}
        onMetricClick={handleMetricClick}
      />

      <HealthCluster plantIds={plantIds} viewMode={viewMode} />

      <AuditsCluster plantIds={plantIds} />

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
