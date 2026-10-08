import React from 'react';
import { Gauge, FlaskConical, Cloud, Percent } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { StatCard, PerWellSourceCard, ClusterHeader } from '@/components/dashboard/StatCard';
import { ClusterCharts } from '@/components/dashboard/TrendChartWrappers';
import { QUALITY_CHART_METRICS, type ChartMetric } from '@/components/dashboard/types';
import type { DashboardViewMode } from '@/components/dashboard/types';

interface QualityClusterProps {
  avgFeedTds: number | null;
  roByTrain: any[];
  avgPermTds: number | null;
  avgChlorineResidual: number | null;
  thresholds: any;
  wellsByQuality: any[];
  plantCodeById: Map<string, string>;
  plantIds: string[];
  avgRecovery: number | null;
  avgRawTds: number | null;
  avgRawTurb: number | null;
  viewMode: DashboardViewMode;
  expandedMetric: string | null;
  onMetricClick: (metric: string, title: string) => () => void;
}

export function QualityCluster({
  avgFeedTds, roByTrain, avgPermTds, avgChlorineResidual, thresholds, wellsByQuality, plantCodeById, plantIds,
  avgRecovery, avgRawTds, avgRawTurb, viewMode, expandedMetric, onMetricClick,
}: QualityClusterProps) {
  return (
    <section id="quality-cluster" className="scroll-mt-40 space-y-2.5">
      <ClusterHeader icon={FlaskConical} title="Quality" accent="text-accent" subtitle="RO output" />

      <div className="grid gap-2.5 sm:gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-6 items-stretch">
        {/* Primary Compliance North Stars */}
        <div className="md:col-span-2 xl:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
          <StatCard
            icon={FlaskConical}
            label="Product TDS"
            value={avgPermTds ?? '—'}
            unit="ppm"
            size="lg"
            threshold={`≤${thresholds.permeate_tds_max}`}
            calc
            calcTooltip={`Product TDS compliance limit: ≤ ${thresholds.permeate_tds_max} ppm`}
            onClick={onMetricClick('tds', 'Permeate TDS Trend')}
            expandRows={roByTrain.map((r) => ({
              label: r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?'),
              value: r.permeate_tds != null ? Math.round(r.permeate_tds) : null,
            }))}
            expandUnit="ppm"
          />

          <StatCard
            icon={FlaskConical}
            label="Free Chlorine"
            value={avgChlorineResidual != null ? avgChlorineResidual.toFixed(2) : '—'}
            unit="mg/L"
            size="lg"
            threshold="0.3 – 1.5"
            calc
            calcTooltip="PNSDW Free Chlorine Residual limit: 0.3 – 1.5 mg/L (suspect > 3.0 excluded)"
            onClick={onMetricClick('chlorine', 'Free Chlorine Residual Trend')}
            expandRows={roByTrain.map((r) => ({
              label: r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?'),
              value: r.chlorine_residual_mg_l != null ? +r.chlorine_residual_mg_l.toFixed(2) : null,
            }))}
            expandUnit="mg/L"
          />

          <StatCard
            icon={Percent}
            label="Recovery"
            value={avgRecovery ?? '—'}
            unit="%"
            size="lg"
            threshold={`≥${thresholds.recovery_pct_min}%`}
            calc
            calcTooltip={`Recovery compliance target: ≥ ${thresholds.recovery_pct_min}%`}
            onClick={onMetricClick('recovery', 'Recovery Trendline')}
          />
        </div>

        {/* Upstream Quality Conditions */}
        <div className="md:col-span-2 xl:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
          <StatCard
            icon={Gauge}
            label="Feed TDS"
            value={avgFeedTds ?? '—'}
            unit="ppm"
            size="compact"
            expandRows={roByTrain.map((r) => ({
              label: r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?'),
              value: r.feed_tds != null ? Math.round(r.feed_tds) : null,
            }))}
            expandUnit="ppm"
          />

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
        </div>
      </div>

      <ClusterCharts metrics={QUALITY_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="quality" />
    </section>
  );
}
