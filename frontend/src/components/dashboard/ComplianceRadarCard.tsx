// Compliance Radar — one polygon per plant, axes = % of that plant's
// compliance threshold currently being used (100% = right at the limit,
// >100% = in violation). Deliberately reuses fetchPlantMetrics/loadThresholds
// from Compliance.tsx instead of re-deriving the threshold logic, so this
// card can never drift out of sync with what the Compliance page reports.
//
// Layout/typography mirrors the rest of the dashboard's chart cards
// (InlineTrendChart's compact `p-3` Card, the 13px bold title + tiny
// muted-right-side row, hsl(var(--border/--muted-foreground)) axis
// colors) rather than the generic shadcn Card header/content padding —
// and reuses StatusPill + the DM Sans "tnum" numeral treatment that
// StatCard already uses for every other KPI on this dashboard.
import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { useQueries } from '@tanstack/react-query';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/StatusPill';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { rangeKeyToDays } from './types';
import { fetchPlantMetrics, loadThresholds, type Thresholds } from '@/pages/Compliance';
import { DRILL_COLORS } from './TrendChartLegend';

// Same numeral treatment StatCard/NRWGaugeCard use for every KPI value on
// this dashboard — keeps the radar's numbers visually consistent with the
// stat tiles right above it instead of falling back to the body font.
// Declared once as the `font-numeral` Tailwind token (tailwind.config.ts)
// and loaded via the single app-wide @import in index.css.

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
  // chartFrom/chartTo only reflect the real selection when chartRange is
  // CUSTOM (rangeKeyToDays ignores them for the preset buttons) — same fix
  // as CostSunburst/useCostComposition, and the same reason this card was
  // showing "last 1d" instead of whatever date was actually picked.
  const isCustomRange = chartRange === 'CUSTOM';

  // Same "last Nd" tell CostSunburst had — show the real dates once they're
  // actually being used; presets keep "last Nd" since that's still accurate.
  const rangeLabel = isCustomRange
    ? (chartFrom === chartTo
        ? format(parseISO(chartFrom), 'MMM d')
        : `${format(parseISO(chartFrom), 'MMM d')}–${format(parseISO(chartTo), 'MMM d')}`)
    : `last ${days}d`;

  const activePlants = useMemo(
    () => (plants ?? []).filter((p) => plantIds.includes(p.id)),
    [plants, plantIds],
  );

  const results = useQueries({
    queries: activePlants.map((p) => ({
      queryKey: ['compliance-radar', p.id, days, isCustomRange ? chartFrom : null, isCustomRange ? chartTo : null],
      queryFn: async () => {
        const [{ metrics }, thresholds] = await Promise.all([
          fetchPlantMetrics(p.id, days, isCustomRange ? chartFrom : undefined, isCustomRange ? chartTo : undefined),
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

  // Tight radius domain so a well-within-compliance plant still fills most
  // of the plot instead of shrinking to a speck in the middle of a huge web.
  const maxObserved = radarData.reduce((m, row) => {
    for (const { plant } of loaded) {
      const v = row[plant.id];
      if (typeof v === 'number' && v > m) m = v;
    }
    return m;
  }, 0);
  const radiusMax = Math.max(40, Math.ceil((maxObserved + 10) / 10) * 10);

  // Per-plant status pill driven by the single worst axis — reuses the
  // same accent/warn/danger tone system as every StatCard on this page.
  const plantStatus = loaded.map(({ plant }, i) => {
    const values = radarData
      .map((row) => row[plant.id])
      .filter((v): v is number => typeof v === 'number');
    const worst = values.length ? Math.max(...values) : null;
    const tone = worst == null ? 'muted' as const
      : worst >= 100 ? 'danger' as const
      : worst >= 70 ? 'warn' as const
      : 'accent' as const;
    return { plant, color: DRILL_COLORS[i % DRILL_COLORS.length], worst, tone };
  });

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-1 mb-2">
        <span className="text-xs font-bold tracking-[-0.01em] text-foreground">Compliance Radar</span>
        <span className="text-2xs text-muted-foreground ml-auto">actual ÷ threshold · {rangeLabel}</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : !loaded.length || !radarData.length ? (
        <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground">
          No compliance data for this period.
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="w-full max-w-[420px] h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="78%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, radiusMax]}
                  tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }}
                  tickCount={4}
                  axisLine={false}
                />
                {loaded.map(({ plant }, i) => (
                  <Radar
                    key={plant.id}
                    name={plant.name}
                    dataKey={plant.id}
                    stroke={DRILL_COLORS[i % DRILL_COLORS.length]}
                    fill={DRILL_COLORS[i % DRILL_COLORS.length]}
                    fillOpacity={loaded.length > 1 ? 0.15 : 0.25}
                    strokeWidth={1.5}
                    connectNulls
                  />
                ))}
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                    borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)',
                  }}
                  formatter={(v: number) => (v == null ? '—' : `${v}%`)}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-plant status chips — sized to their own content and
              centered/wrapped, so they never stretch edge-to-edge across
              a wide card the way a `justify-between` column would. */}
          <div className="flex flex-wrap justify-center gap-1.5">
            {plantStatus.map(({ plant, color, worst, tone }) => (
              <div
                key={plant.id}
                className="flex items-center gap-1.5 text-xs bg-muted/50 rounded-full pl-1.5 pr-2 py-0.5"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-foreground/90 font-medium">{plant.name}</span>
                <span className="tabular-nums text-muted-foreground font-numeral">
                  {worst == null ? '—' : `${Math.round(worst)}%`}
                </span>
                <StatusPill tone={tone} className="px-1.5 py-0">
                  {tone === 'danger' ? 'Over limit' : tone === 'warn' ? 'Near limit' : tone === 'muted' ? 'No data' : 'OK'}
                </StatusPill>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
