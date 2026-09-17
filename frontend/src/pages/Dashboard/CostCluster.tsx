import React, { Suspense, lazy } from 'react';
import { format } from 'date-fns';
import { Zap, Banknote, FlaskConical, PieChart } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { StatCard, ClusterHeader } from '@/components/dashboard/StatCard';
import { ClusterCharts } from '@/components/dashboard/TrendChartWrappers';
import { ChartSkeleton } from '@/components/dashboard/CardSkeleton';
import { COST_CHART_METRICS, type ChartMetric } from '@/components/dashboard/types';
import type { DashboardViewMode } from '@/components/dashboard/types';

// d3 sunburst is the heaviest card on the dashboard — split it out so Cost
// KPIs + charts paint first, composition streams in behind a skeleton.
const LazyCostSunburst = lazy(() =>
  import('@/components/dashboard/CostSunburst').then((m) => ({ default: m.CostSunburst })),
);

interface CostClusterProps {
  productionCost: number | null;
  costIsStale: boolean;
  costDataDate: string | null;
  powerCost: number | null;
  chemCost: number | null;
  kwh: number;
  powerIsStale: boolean;
  dKwh: number | null;
  pv: number | null;
  thresholds: any;
  viewMode: DashboardViewMode;
  expandedMetric: string | null;
  plantIds: string[];
  onMetricClick: (metric: string, title: string) => () => void;
}

export function CostCluster({
  productionCost, costIsStale, costDataDate, powerCost, chemCost, kwh, powerIsStale, dKwh, pv, thresholds,
  viewMode, expandedMetric, plantIds, onMetricClick,
}: CostClusterProps) {
  return (
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

      <div className="grid gap-2.5 sm:gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 items-stretch">
        <StatCard icon={Banknote} label="Total Production Cost"
          calc
          calcTooltip={
            costIsStale && costDataDate
              ? `Production Cost = (kWh × tariff rate) + Chemical Cost (latest data: ${format(new Date(costDataDate + 'T00:00:00'), 'MMM d, yyyy')})`
              : 'Production Cost = Power Cost (kWh × ₱/kWh) + Chemical Cost (today)'
          }
          value={productionCost == null ? '—' : `₱${fmtNum(productionCost, 0)}`}
          onClick={onMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />

        <StatCard icon={Zap} label="Power Cost"
          calc
          calcTooltip="Power Cost = Power kWh × tariff rate (₱/kWh) from power_tariffs — same formula as chart"
          value={powerCost == null ? '—' : `₱${fmtNum(powerCost, 0)}`}
          onClick={onMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />

        <StatCard icon={FlaskConical} label="Chemical Cost"
          value={chemCost == null ? '—' : `₱${fmtNum(chemCost, 0)}`}
          onClick={onMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />

        <StatCard icon={Zap} label="Power kWh"
          value={powerIsStale || kwh > 0 ? fmtNum(kwh) : '—'}
          unit={kwh > 0 ? 'kWh' : undefined}
          trend={dKwh}
          onClick={onMetricClick('kwh', 'Power Consumption & Energy Mix')} />

        <StatCard
          icon={Zap}
          label="PV Ratio"
          value={pv == null ? '—' : pv}
          unit="kWh/m³"
          calc
          threshold={`≤${thresholds.pv_ratio_max}`}
          calcTooltip={`PV Ratio = Power kWh ÷ Production m³ (target: ≤ ${thresholds.pv_ratio_max} kWh/m³)`}
          onClick={onMetricClick('pv', 'PV Ratio Trend')}
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

      <div className="grid gap-2.5 sm:gap-3 grid-cols-1 lg:grid-cols-2 items-stretch">
        <Suspense fallback={<ChartSkeleton />}>
          <LazyCostSunburst plantIds={plantIds} />
        </Suspense>
        <div className="rounded-xl border border-border/60 bg-card/60 p-3 flex items-start gap-2.5 text-xs text-muted-foreground">
          <PieChart className="h-4 w-4 mt-0.5 shrink-0 text-chart-6" aria-hidden />
          <p>
            Cost composition follows the shared dashboard range above. Power splits
            into grid vs solar, chemicals split per dosed chemical. Add chemical
            pricing on the Costs page to unlock the full dosing breakdown.
          </p>
        </div>
      </div>
    </section>
  );
}
