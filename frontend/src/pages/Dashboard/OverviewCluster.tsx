import React from 'react';
import { Receipt, Droplet, Waves } from 'lucide-react';
import { RawWaterIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import { StatCard, ClusterHeader } from '@/components/dashboard/StatCard';
import { NRWGaugeCard } from '@/components/dashboard/NRWGaugeCard';
import { ClusterCharts } from '@/components/dashboard/TrendChartWrappers';
import { WaterBalanceBridgeCard } from '@/components/dashboard/WaterBalanceBridgeCard';
import { OVERVIEW_CHART_METRICS } from '@/components/dashboard/types';
import type { DashboardViewMode } from '@/components/dashboard/types';

interface OverviewClusterProps {
  consumption: number | null;
  dConsumption: number | null;
  nrw: number | null;
  yNrw: number | null;
  rawWaterVol: number | null;
  dRawWater: number | null;
  blending: number | null;
  viewMode: DashboardViewMode;
  expandedMetric: string | null;
  plantIds: string[];
  onMetricClick: (metric: string, title: string) => () => void;
}

export function OverviewCluster({
  consumption, dConsumption, nrw, yNrw, rawWaterVol, dRawWater, blending,
  viewMode, expandedMetric, plantIds, onMetricClick,
}: OverviewClusterProps) {
  return (
    <section id="overview-cluster" className="scroll-mt-28 space-y-2.5">
      <ClusterHeader icon={Droplet} title="Overview" accent="text-primary" subtitle="Distribution & Sources" />

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
        {/* Tier 1 Primary Bento Leads: Distribution & Loss KPIs */}
        <div className="sm:col-span-1 lg:col-span-2">
          <StatCard
            icon={Receipt}
            label="Locators Consumption"
            value={fmtNum(consumption)}
            unit="m³"
            size="lg"
            trend={dConsumption}
            onClick={onMetricClick('production', 'Production vs Consumption')}
            className="h-full border-primary/20 shadow-xs hover:border-primary/40 transition-all"
          />
        </div>

        <div className="sm:col-span-1 lg:col-span-2">
          <NRWGaugeCard
            nrw={nrw}
            yNrw={yNrw}
            size="lg"
            onClick={onMetricClick('nrw', 'NRW Trend')}
            className="h-full border-primary/20 shadow-xs hover:border-primary/40 transition-all"
          />
        </div>

        {/* Tier 2 Secondary Bento Tiles: Inflow Sources */}
        <div className="sm:col-span-1 lg:col-span-2">
          <StatCard
            icon={RawWaterIcon}
            label="Raw Water In"
            value={fmtNum(rawWaterVol)}
            unit="m³"
            trend={dRawWater}
            onClick={onMetricClick('rawwater', 'Raw Water (m³)')}
            className="h-full"
          />
        </div>

        <div className="sm:col-span-1 lg:col-span-2">
          <StatCard
            icon={Waves}
            label="Blending Flow"
            value={fmtNum(blending)}
            unit="m³"
            className="h-full"
          />
        </div>
      </div>

      <ClusterCharts metrics={OVERVIEW_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="overview" />
      <WaterBalanceBridgeCard plantIds={plantIds} />
    </section>
  );
}
