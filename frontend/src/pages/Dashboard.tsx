import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Droplet, FlaskConical, Zap, Activity, LayoutGrid } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePlantStore } from '@/store/plantStore';
import { useChartStore } from '@/store/chartStore';
import { usePlants } from '@/hooks/usePlants';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
import { useAlertBadge } from '@/hooks/useAlertBadge';
import { describeFreshness } from '@/shared/freshness';
import { cn } from '@/lib/utils';
import { NoPlantsAssigned } from '@/components/NoPlantsAssigned';
import { format, subDays } from 'date-fns';
import { DowntimeEventsModal } from '@/components/DowntimeEventsModal';
import { DashboardViewMode, VIEW_MODE_KEY, pctDelta } from '@/components/dashboard/types';
import { PlantPulseHero } from '@/components/dashboard/PlantPulseHero';
import { MobilePlantStatusCard } from '@/components/mobile/MobilePlantStatusCard';
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

type MobileDashboardCluster = 'flow' | 'quality' | 'cost' | 'health' | 'all';

const MOBILE_CLUSTER_TABS: { id: MobileDashboardCluster; label: string; icon: typeof Droplet }[] = [
  { id: 'flow', label: 'Flow', icon: Droplet },
  { id: 'quality', label: 'Quality', icon: FlaskConical },
  { id: 'cost', label: 'Cost', icon: Zap },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'all', label: 'All', icon: LayoutGrid },
];

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
  // P4-6: latest reading across RO trains, wells, locators and product
  // meters — not ro_train_readings alone, so a wells-only plant no longer
  // looks stale while it is logging. One small head query per source;
  // the max timestamp wins. Respects the plant picker via plant_id.
  const { data: latestReadingAt } = useQuery<Date | null>({
    queryKey: ['latest-reading', selectedPlantId ?? 'all'],
    queryFn: async () => {
      const pickLatest = async (table: string): Promise<string | null> => {
        // `as any` matches the codebase pattern for dynamic table names —
        // the generated Database type doesn't cover every table union here.
        let q: any = (supabase.from(table as any) as any)
          .select('reading_datetime')
          .order('reading_datetime', { ascending: false })
          .limit(1);
        if (selectedPlantId) {
          q = q.eq('plant_id', selectedPlantId);
        }
        const { data, error } = await q.maybeSingle();
        if (error || !data?.reading_datetime) return null;
        return data.reading_datetime as string;
      };
      const stamps = await Promise.all([
        pickLatest('ro_train_readings'),
        pickLatest('well_readings'),
        pickLatest('locator_readings'),
        pickLatest('product_meter_readings'),
      ]);
      let latest: Date | null = null;
      for (const s of stamps) {
        if (!s) continue;
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) continue;
        if (!latest || d.getTime() > latest.getTime()) latest = d;
      }
      return latest;
    },
    staleTime: 5 * 60_000, // 5 minutes
  });
  const dataFreshness = latestReadingAt ?? null;

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
  //   • inline   → expand the clicked metric in place (inline already shows all
  //                charts; clicking does not switch to sections or overwrite the
  //                user's saved preference — P5-9).
  const handleMetricClick = (metric: string, title: string): (() => void) => {
    return () => {
      if (viewMode === 'sections') {
        setExpandedMetric((prev) => (prev === metric ? null : metric));
      } else if (viewMode === 'popup') {
        setModal({ metric, title });
      } else {
        // inline → keep inline mode; toggle the clicked metric's chart in place
        // (on mobile this expands/collapses the tapped KPI chart without rewriting saved preference — P5-9).
        setExpandedMetric((prev) => (prev === metric ? null : metric));
      }
    };
  };

  // P5-1 (D5): scope to the plants this user may see (this page used to take
  // every plant regardless of assignment), then narrow by the picker. The
  // result is the same set <AlertsRuntime /> computes alarms for, so the two
  // share React Query keys instead of fetching twice.
  const { plants: allowedPlants, needsAssignment } = useVisiblePlants();
  const visiblePlants = useMemo(
    () => (selectedPlantId ? allowedPlants.filter((p) => p.id === selectedPlantId) : allowedPlants),
    [allowedPlants, selectedPlantId],
  );
  const plantIds = visiblePlants.map((p) => p.id);

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
  const { count: alertBadgeCount } = useAlertBadge();
  const [mobileCluster, setMobileCluster] = useState<MobileDashboardCluster>('flow');
  const freshnessInfo = describeFreshness(dataFreshness, Date.now());
  const mobileFreshnessTone =
    freshnessInfo.tone === 'fresh' ? 'good' : freshnessInfo.tone === 'aging' ? 'warn' : 'muted';

  // D5: with no plants, an empty `plantIds` is not "no filter". PlantPulseHero
  // and PlantHealthStrip both read [] as "show every plant", so an unassigned
  // user gets the explanation instead of those widgets.
  if (needsAssignment) {
    return (
      <div className="space-y-3 animate-fade-in">
        <NoPlantsAssigned />
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Mobile-first 2-second glanceable hero card */}
      <div className="md:hidden">
        <MobilePlantStatusCard
          plantName={selectedPlantName}
          isOnline={true}
          freshnessLabel={freshnessInfo.label}
          freshnessTone={mobileFreshnessTone}
          production={prodStats.production}
          dProduction={prodStats.dProduction}
          recovery={qualityStats.avgRecovery}
          rawWater={prodStats.rawWaterVol}
          specificPower={powerStats.pv}
          openIncidentsCount={openIncidentCount}
          unacknowledgedAlertsCount={alertBadgeCount}
          trainsCount={qualityStats.qualityTrainIds.length}
          onlineTrainsCount={qualityStats.roByTrain.length}
          onOpenLogReading={() => navigate('/operations?action=log')}
          onViewIncidents={() => navigate('/incidents')}
          onViewAlerts={() => navigate('/alerts')}
        />
      </div>

      {/* Desktop telemetry hero */}
      <div className="hidden md:block">
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
      </div>

      <div className={cn(selectedPlantId && 'hidden md:block')}>
        <PlantHealthStrip
          plantIds={plantIds}
          onSelectPlant={(pid) => navigate(`/plants/${pid}`)}
        />
      </div>

      {/* Ops-first order: Action Center (today's live tasks) sits above historical range & domain clusters */}
      <ActionCenter plantIds={plantIds} />

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

      {/* Mobile Domain Cluster Switcher: avoids 4,500px vertical scroll on phones */}
      <div
        className="md:hidden flex items-center gap-1 p-1 rounded-2xl bg-muted/60 border border-border/60 overflow-x-auto no-scrollbar"
        role="tablist"
        aria-label="Mobile dashboard domain selector"
      >
        {MOBILE_CLUSTER_TABS.map((item) => {
          const Icon = item.icon;
          const active = mobileCluster === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setMobileCluster(item.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer',
                active
                  ? 'bg-card text-foreground shadow-xs border border-border/80'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className={cn(mobileCluster !== 'all' && mobileCluster !== 'flow' && 'hidden md:block')}>
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
      </div>

      <div className={cn(mobileCluster !== 'all' && mobileCluster !== 'quality' && 'hidden md:block')}>
        <QualityCluster
          avgFeedTds={qualityStats.avgFeedTds}
          roByTrain={qualityStats.roByTrain}
          avgPermTds={qualityStats.avgPermTds}
          avgChlorineResidual={qualityStats.avgChlorineResidual}
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
      </div>

      <div className={cn(mobileCluster !== 'all' && mobileCluster !== 'cost' && 'hidden md:block')}>
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
      </div>

      <div className={cn(mobileCluster !== 'all' && mobileCluster !== 'health' && 'hidden md:block', 'space-y-3')}>
        <HealthCluster plantIds={plantIds} viewMode={viewMode} />
        <AuditsCluster plantIds={plantIds} />
      </div>

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
