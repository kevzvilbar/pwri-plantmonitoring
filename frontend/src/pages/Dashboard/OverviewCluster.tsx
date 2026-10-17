import React, { useState } from 'react';
import { Receipt, Droplet, Waves, Split, ChevronDown, ChevronUp } from 'lucide-react';
import { RawWaterIcon } from '@/components/icons/water-icons';
import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { StatCard, ClusterHeader } from '@/components/dashboard/StatCard';
import { NRWGaugeCard } from '@/components/dashboard/NRWGaugeCard';
import { ClusterCharts } from '@/components/dashboard/TrendChartWrappers';
import { WaterBalanceBridgeCard } from '@/components/dashboard/WaterBalanceBridgeCard';
import { ReconciliationHealthCard } from '@/components/dashboard/ReconciliationHealthCard';
import { BlendingVolumeCard } from '@/components/BlendingVolumeCard';
import { OVERVIEW_CHART_METRICS } from '@/components/dashboard/types';
import type { DashboardViewMode } from '@/components/dashboard/types';

interface OverviewClusterProps {
  consumption: number | null;
  dConsumption: number | null;
  nrw: number | null;
  yNrw: number | null;
  rawWaterVol: number | null;
  dRawWater: number | null;
  roFlowVol?: number | null;
  dRoFlow?: number | null;
  blending: number | null;
  viewMode: DashboardViewMode;
  expandedMetric: string | null;
  plantIds: string[];
  onMetricClick: (metric: string, title: string) => () => void;
}

export function OverviewCluster({
  consumption, dConsumption, nrw, yNrw, rawWaterVol, dRawWater, roFlowVol, dRoFlow, blending,
  viewMode, expandedMetric, plantIds, onMetricClick,
}: OverviewClusterProps) {
  const [showMobileDeepDive, setShowMobileDeepDive] = useState(false);

  return (
    <section id="overview-cluster" className="scroll-mt-40 space-y-2.5">
      <ClusterHeader icon={Droplet} title="Overview" accent="text-primary" subtitle="Distribution & Sources" />

      {/* Standardized KPI grid: 2-col mobile → 3-col tablet → 5-col desktop. */}
      <div className="grid gap-2.5 sm:gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 items-stretch">
        <StatCard
          icon={RawWaterIcon}
          label="Raw Water In"
          value={fmtNum(rawWaterVol)}
          unit="m³"
          trend={dRawWater}
          onClick={onMetricClick('rawwater', 'Raw Water (m³)')}
        />

        <StatCard
          icon={Split}
          label="RO Train Flow"
          value={fmtNum(roFlowVol)}
          unit="m³"
          trend={dRoFlow}
          onClick={onMetricClick('roFlowBalance', 'RO Train Water Balance')}
        />

        <StatCard
          icon={Waves}
          label="Blending Flow"
          value={fmtNum(blending)}
          unit="m³"
        />

        <StatCard
          icon={Receipt}
          label="Locators Consumption"
          value={fmtNum(consumption)}
          unit="m³"
          trend={dConsumption}
          onClick={onMetricClick('production', 'Production vs Consumption')}
        />

        <NRWGaugeCard
          nrw={nrw}
          yNrw={yNrw}
          onClick={onMetricClick('nrw', 'NRW Trend')}
          className="col-span-2 md:col-span-1"
        />
      </div>

      <ClusterCharts metrics={OVERVIEW_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="overview" />

      {/* Mobile progressive disclosure toggle for secondary Water Balance / Reconciliation / Blending breakdown */}
      <button
        type="button"
        onClick={() => setShowMobileDeepDive((v) => !v)}
        className="md:hidden w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 border border-border/60 text-xs font-semibold text-foreground transition-colors cursor-pointer"
      >
        <span>Water Balance, Reconciliation &amp; Blending (3)</span>
        <span className="flex items-center gap-1 text-2xs text-primary">
          <span>{showMobileDeepDive ? 'Hide' : 'Expand'}</span>
          {showMobileDeepDive ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* Reconciliation card only ever needs to show a handful of plant rows,
          so at desktop widths it gets a quarter of the row (half of its old
          50/50 share) and the Water balance waterfall gets the rest. Both
          still stack full-width below `lg`. */}
      <div className={cn(!showMobileDeepDive && 'hidden md:block', 'space-y-2.5')}>
        <div className="grid gap-2.5 sm:gap-3 grid-cols-1 lg:grid-cols-4 items-stretch">
          <div className="lg:col-span-3">
            <WaterBalanceBridgeCard plantIds={plantIds} />
          </div>
          <div className="lg:col-span-1">
            <ReconciliationHealthCard plantIds={plantIds} />
          </div>
        </div>

        <BlendingVolumeCard plantIds={plantIds} />
      </div>
    </section>
  );
}
