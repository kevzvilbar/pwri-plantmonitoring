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
  avgFeedTds, roByTrain, avgPermTds, thresholds, wellsByQuality, plantCodeById, plantIds,
  avgRecovery, avgRawTds, avgRawTurb, viewMode, expandedMetric, onMetricClick,
}: QualityClusterProps) {
  return (
    <section id="quality-cluster" className="scroll-mt-28 space-y-2.5">
      <ClusterHeader icon={FlaskConical} title="Quality" accent="text-accent" subtitle="RO output" />

      <div className="stagger-grid grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
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

        <StatCard
          icon={FlaskConical}
          accent="text-accent"
          label="Product TDS"
          value={avgPermTds ?? '—'}
          unit="ppm"
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

        <StatCard
          icon={Percent}
          label="Recovery"
          value={avgRecovery ?? '—'}
          unit="%"
          threshold={`≥${thresholds.recovery_pct_min}%`}
          calc
          calcTooltip={`Recovery compliance target: ≥ ${thresholds.recovery_pct_min}%`}
          onClick={onMetricClick('recovery', 'Recovery Trendline')}
        />
      </div>

      <ClusterCharts metrics={QUALITY_CHART_METRICS} viewMode={viewMode} expandedMetric={expandedMetric} plantIds={plantIds} clusterId="quality" />
    </section>
  );
}
