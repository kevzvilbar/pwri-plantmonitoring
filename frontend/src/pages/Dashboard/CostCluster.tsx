import React from 'react';
import { format } from 'date-fns';
import { Zap, Banknote, FlaskConical } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { StatCard, ClusterHeader } from '@/components/dashboard/StatCard';
import { ClusterCharts } from '@/components/dashboard/TrendChartWrappers';
import { COST_CHART_METRICS, type ChartMetric } from '@/components/dashboard/types';
import type { DashboardViewMode } from '@/components/dashboard/types';

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

      <div className="stagger-grid grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard icon={Banknote} accent="text-accent" label="Total Production Cost"
          calc
          calcTooltip={
            costIsStale && costDataDate
              ? `Production Cost = (kWh × tariff rate) + Chemical Cost (latest data: ${format(new Date(costDataDate + 'T00:00:00'), 'MMM d, yyyy')})`
              : 'Production Cost = Power Cost (kWh × ₱/kWh) + Chemical Cost (today)'
          }
          value={productionCost == null ? '—' : `₱${fmtNum(productionCost, 0)}`}
          onClick={onMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />

        <StatCard icon={Zap} accent="text-chart-6" label="Power Cost"
          calc
          calcTooltip="Power Cost = Power kWh × tariff rate (₱/kWh) from power_tariffs — same formula as chart"
          value={powerCost == null ? '—' : `₱${fmtNum(powerCost, 0)}`}
          onClick={onMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />

        <StatCard icon={FlaskConical} accent="text-highlight" label="Chemical Cost"
          value={chemCost == null ? '—' : `₱${fmtNum(chemCost, 0)}`}
          onClick={onMetricClick('productionCost', 'Production Cost (Power + Chemical)')} />

        <StatCard icon={Zap} accent="text-chart-6" label="Power kWh"
          value={powerIsStale || kwh > 0 ? fmtNum(kwh) : '—'}
          unit={kwh > 0 ? 'kWh' : undefined}
          trend={dKwh}
          onClick={onMetricClick('kwh', 'Power Consumption & Energy Mix')} />

        <StatCard
          icon={Zap}
          accent="text-chart-6"
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
    </section>
  );
}
