// Compliance Radar — one polygon per plant, axes = % of that plant's
// compliance threshold currently being used (100% = right at the limit,
// >100% = in violation). Deliberately reuses fetchPlantMetrics/loadThresholds
// from Compliance.tsx instead of re-deriving the threshold logic, so this
// card can never drift out of sync with what the Compliance page reports.
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Legend, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { rangeKeyToDays } from './types';
import { fetchPlantMetrics, loadThresholds, type Thresholds } from '@/pages/Compliance';
import { DRILL_COLORS } from './TrendChart';

interface Props {
  plantIds: string[];
}

// Each axis is "actual as % of the threshold that governs it". A value of
// 100 sits exactly on the compliance line; below 100 is comfortably inside
// it. Recovery is a MIN threshold so it's inverted (falling below the
// minimum still reads as climbing past 100). pH has two bounds, so it's
// expressed as % of the allowed band consumed from the band's midpoint.
const AXES: {
  id: string;
  label: string;
  metricKey: string;
  compute: (value: number | undefined, t: Thresholds) => number | null;
}[] = [
  { id: 'nrw', label: 'NRW', metricKey: 'nrw_pct',
    compute: (v, t) => (v == null || !t.nrw_pct_max) ? null : (v / t.nrw_pct_max) * 100 },
  { id: 'downtime', label: 'Downtime', metricKey: 'downtime_hrs',
    compute: (v, t) => (v == null || !t.downtime_hrs_per_day_max) ? null : (v / t.downtime_hrs_per_day_max) * 100 },
  { id: 'tds', label: 'Permeate TDS', metricKey: 'permeate_tds',
    compute: (v, t) => (v == null || !t.permeate_tds_max) ? null : (v / t.permeate_tds_max) * 100 },
  { id: 'turbidity', label: 'Raw Turbidity', metricKey: 'raw_turbidity',
    compute: (v, t) => (v == null || !t.raw_turbidity_max) ? null : (v / t.raw_turbidity_max) * 100 },
  { id: 'dp', label: 'ΔP', metricKey: 'dp_psi',
    compute: (v, t) => (v == null || !t.dp_psi_max) ? null : (v / t.dp_psi_max) * 100 },
  { id: 'recovery', label: 'Recovery', metricKey: 'recovery_pct',
    compute: (v, t) => (v == null || !v || !t.recovery_pct_min) ? null : (t.recovery_pct_min / v) * 100 },
  { id: 'pv', label: 'PV Ratio', metricKey: 'pv_ratio',
    compute: (v, t) => (v == null || !t.pv_ratio_max) ? null : (v / t.pv_ratio_max) * 100 },
  { id: 'ph', label: 'Permeate pH', metricKey: 'permeate_ph',
    compute: (v, t) => {
      if (v == null) return null;
      const mid = (t.permeate_ph_min + t.permeate_ph_max) / 2;
      const halfBand = (t.permeate_ph_max - t.permeate_ph_min) / 2;
      if (halfBand <= 0) return null;
      return (Math.abs(v - mid) / halfBand) * 100;
    } },
];

export function ComplianceRadarCard({ plantIds }: Props) {
  const { data: plants } = usePlants();
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);

  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);

  const activePlants = useMemo(
    () => (plants ?? []).filter((p) => plantIds.includes(p.id)),
    [plants, plantIds],
  );

  const results = useQueries({
    queries: activePlants.map((p) => ({
      queryKey: ['compliance-radar', p.id, days],
      queryFn: async () => {
        const [{ metrics }, thresholds] = await Promise.all([
          fetchPlantMetrics(p.id, days),
          loadThresholds(p.id),
        ]);
        return { plant: p, metrics, thresholds };
      },
      enabled: !!p.id,
      staleTime: 2 * 60_000,
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const loaded = results.map((r) => r.data).filter(Boolean) as {
    plant: { id: string; name: string };
    metrics: Record<string, number | undefined>;
    thresholds: Thresholds;
  }[];

  const radarData = useMemo(() => {
    if (!loaded.length) return [];
    return AXES.map((axis) => {
      const row: Record<string, string | number | null> = { axis: axis.label };
      for (const { plant, metrics, thresholds } of loaded) {
        const pct = axis.compute(metrics[axis.metricKey], thresholds);
        row[plant.id] = pct == null ? null : Math.round(pct * 10) / 10;
      }
      return row;
    });
  }, [loaded]);

  const maxObserved = radarData.reduce((m, row) => {
    for (const { plant } of loaded) {
      const v = row[plant.id];
      if (typeof v === 'number' && v > m) m = v;
    }
    return m;
  }, 0);
  const radiusMax = Math.max(120, Math.ceil((maxObserved + 10) / 20) * 20);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Compliance Radar</CardTitle>
        <CardDescription>
          Each axis is actual ÷ threshold — 100% sits right on the compliance limit.
          Last {days} day{days === 1 ? '' : 's'}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : !loaded.length || !radarData.length ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            No compliance data for this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid />
              <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
              <PolarRadiusAxis
                angle={90}
                domain={[0, radiusMax]}
                tick={{ fontSize: 9 }}
                tickCount={5}
              />
              {loaded.map(({ plant }, i) => (
                <Radar
                  key={plant.id}
                  name={plant.name}
                  dataKey={plant.id}
                  stroke={DRILL_COLORS[i % DRILL_COLORS.length]}
                  fill={DRILL_COLORS[i % DRILL_COLORS.length]}
                  fillOpacity={loaded.length > 1 ? 0.12 : 0.25}
                  connectNulls
                />
              ))}
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => (v == null ? '—' : `${v}%`)} />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
