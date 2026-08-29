// Data Completeness Radar — one polygon per plant, axes = % of expected
// data-entry actually logged for that category over the selected window
// (100% = every active entity logged on every day in range; Power Log
// and Chemicals are plant-level instead of per-entity — one dosing log
// expected per day, not one per well/train/etc).
import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import { Users, TrendingUp, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/StatusPill';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { supabase } from '@/integrations/supabase/client';
import { rangeKeyToDays } from './types';
import { DRILL_COLORS } from './TrendChartLegend';

interface Props {
  plantIds: string[];
}

const AXES: { id: string; label: string }[] = [
  { id: 'wells', label: 'Wells' },
  { id: 'locators', label: 'Locators' },
  { id: 'trains', label: 'RO Trains' },
  { id: 'meters', label: 'Product Meters' },
  { id: 'power', label: 'Power Log' },
  { id: 'chemicals', label: 'Chemicals' },
];

type Completeness = Record<string, number | null>;

function coverageRatio(
  rows: { entityId: string | null; dt: string }[],
  entityCount: number,
  days: number,
): number | null {
  if (!entityCount || !days) return null;
  const seen = new Set(
    rows.filter((r) => r.entityId).map((r) => `${r.entityId}|${r.dt.slice(0, 10)}`),
  );
  const expected = entityCount * days;
  return expected ? Math.min(100, Math.round((seen.size / expected) * 1000) / 10) : null;
}

async function fetchPlantCompleteness(
  plantId: string,
  days: number,
  from?: string,
  to?: string,
): Promise<Completeness> {
  let sinceIso: string;
  if (from) {
    sinceIso = new Date(`${from}T00:00:00.000Z`).toISOString();
  } else {
    const since = new Date();
    since.setDate(since.getDate() - days);
    sinceIso = since.toISOString();
  }
  const untilIso = to
    ? new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000).toISOString()
    : undefined;

  let wellQ = supabase.from('well_readings').select('well_id, reading_datetime')
    .eq('plant_id', plantId).gte('reading_datetime', sinceIso);
  let locQ = supabase.from('locator_readings').select('locator_id, reading_datetime')
    .eq('plant_id', plantId).gte('reading_datetime', sinceIso);
  let trainQ = supabase.from('ro_train_readings').select('train_id, reading_datetime')
    .eq('plant_id', plantId).gte('reading_datetime', sinceIso);
  let meterQ = supabase.from('product_meter_readings').select('meter_id, reading_datetime')
    .eq('plant_id', plantId).gte('reading_datetime', sinceIso);
  let powerQ = supabase.from('power_readings').select('reading_datetime')
    .eq('plant_id', plantId).gte('reading_datetime', sinceIso);
  let chemQ = supabase.from('chemical_dosing_logs').select('log_datetime')
    .eq('plant_id', plantId).gte('log_datetime', sinceIso);

  if (untilIso) {
    wellQ = wellQ.lt('reading_datetime', untilIso);
    locQ = locQ.lt('reading_datetime', untilIso);
    trainQ = trainQ.lt('reading_datetime', untilIso);
    meterQ = meterQ.lt('reading_datetime', untilIso);
    powerQ = powerQ.lt('reading_datetime', untilIso);
    chemQ = chemQ.lt('log_datetime', untilIso);
  }

  const [
    wellTotal, locTotal, trainTotal, meterTotal,
    wellRows, locRows, trainRows, meterRows,
    powerRows, chemicalRows,
  ] = await Promise.all([
    supabase.from('wells').select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId).eq('status', 'Active').then((r) => r.count ?? 0),
    supabase.from('locators').select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId).eq('status', 'Active').then((r) => r.count ?? 0),
    supabase.from('ro_trains').select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId).then((r) => r.count ?? 0),
    supabase.from('product_meters').select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId).eq('status', 'Active').then((r) => r.count ?? 0),

    wellQ.then((r) => (r.data ?? []).map((x: any) => ({ entityId: x.well_id, dt: x.reading_datetime }))),
    locQ.then((r) => (r.data ?? []).map((x: any) => ({ entityId: x.locator_id, dt: x.reading_datetime }))),
    trainQ.then((r) => (r.data ?? []).map((x: any) => ({ entityId: x.train_id, dt: x.reading_datetime }))),
    meterQ.then((r) => (r.data ?? []).map((x: any) => ({ entityId: x.meter_id, dt: x.reading_datetime }))),
    powerQ.then((r) => r.data ?? []),
    chemQ.then((r) => r.data ?? []),
  ]);

  const powerDays = new Set(powerRows.map((r: any) => String(r.reading_datetime).slice(0, 10))).size;
  const powerPct = days ? Math.min(100, Math.round((powerDays / days) * 1000) / 10) : null;

  const chemicalDays = new Set(chemicalRows.map((r: any) => String(r.log_datetime).slice(0, 10))).size;
  const chemicalPct = days ? Math.min(100, Math.round((chemicalDays / days) * 1000) / 10) : null;

  return {
    wells: coverageRatio(wellRows, wellTotal, days),
    locators: coverageRatio(locRows, locTotal, days),
    trains: coverageRatio(trainRows, trainTotal, days),
    meters: coverageRatio(meterRows, meterTotal, days),
    power: powerPct,
    chemicals: chemicalPct,
  };
}

function completenessColor(pct: number | null): string {
  if (pct == null) return 'hsl(var(--muted-foreground))';
  if (pct >= 90) return 'hsl(var(--success, 142 71% 45%))';
  if (pct >= 60) return 'hsl(var(--warning, 38 92% 50%))';
  return 'hsl(var(--destructive))';
}

function completenessBarColor(pct: number | null): string {
  if (pct == null) return 'bg-muted';
  if (pct >= 90) return 'bg-emerald-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

export function DataCompletenessRadarCard({ plantIds }: Props) {
  const { data: plants } = usePlants();
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);
  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);
  const isCustomRange = chartRange === 'CUSTOM';
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
      queryKey: ['data-completeness-radar', p.id, days, isCustomRange ? chartFrom : null, isCustomRange ? chartTo : null],
      queryFn: async () => ({
        plant: p,
        completeness: await fetchPlantCompleteness(
          p.id, days, isCustomRange ? chartFrom : undefined, isCustomRange ? chartTo : undefined,
        ),
      }),
      enabled: !!p.id,
      staleTime: 2 * 60_000,
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const loaded = results.map((r) => r.data).filter(Boolean) as {
    plant: { id: string; name: string };
    completeness: Completeness;
  }[];

  // Aggregate per-axis breakdown
  const axisBreakdown = useMemo(() => {
    if (!loaded.length) return [];
    return AXES.map((axis) => {
      const vals = loaded.map((p) => p.completeness[axis.id]).filter((v): v is number => v != null);
      const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
      return { ...axis, avg };
    });
  }, [loaded]);

  const radarData = useMemo(() => {
    if (!loaded.length) return [];
    return AXES.map((axis) => {
      const matchingAxis = axisBreakdown.find((a) => a.id === axis.id);
      const avgStr = matchingAxis?.avg != null ? ` (${matchingAxis.avg}%)` : '';
      const row: Record<string, string | number | null> = {
        axisKey: axis.id,
        axis: `${axis.label}${avgStr}`,
        shortLabel: axis.label,
      };
      for (const { plant, completeness } of loaded) {
        row[plant.id] = completeness[axis.id];
      }
      return row;
    });
  }, [loaded, axisBreakdown]);

  // Per-plant derived stats
  const plantStatus = loaded.map(({ plant, completeness }, i) => {
    const values = AXES.map((a) => completeness[a.id]).filter((v): v is number => typeof v === 'number');
    const worst = values.length ? Math.min(...values) : null;
    const avg = values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
    const tone = worst == null ? 'muted' as const
      : worst < 50 ? 'danger' as const
      : worst < 80 ? 'warn' as const
      : 'accent' as const;
    return { plant, color: DRILL_COLORS[i % DRILL_COLORS.length], worst, avg, tone, completeness };
  });

  return (
    <Card className="p-4 flex flex-col justify-between">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-1 mb-2.5">
          <span className="text-sm font-bold tracking-[-0.01em] text-foreground">Data Completeness Radar</span>
          <span className="text-2xs text-muted-foreground ml-auto">logged ÷ expected · {rangeLabel}</span>
        </div>

        {/* Score pills row */}
        {!isLoading && loaded.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {plantStatus.map(({ plant, color, avg, tone }) => (
              <div
                key={plant.id}
                className="flex items-center gap-2 text-xs bg-muted/60 rounded-xl px-3 py-1.5 border border-border/70 shadow-2xs"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs" style={{ background: color }} />
                <span className="text-foreground font-semibold truncate max-w-[110px]">{plant.name}</span>
                <span
                  className="tabular-nums font-bold font-numeral text-xs ml-0.5"
                  style={{ color: completenessColor(avg) }}
                >
                  {avg == null ? '—' : `${avg}% Overall`}
                </span>
                <StatusPill tone={tone} className="px-2 py-0.5 text-[10px] font-bold">
                  {tone === 'danger' ? 'Gaps' : tone === 'warn' ? 'Partial' : tone === 'muted' ? 'No data' : 'Good'}
                </StatusPill>
                <Link
                  to={`/employees?tab=kpi&view=individual&plant=${plant.id}`}
                  className="flex items-center gap-1 pl-1.5 ml-0.5 border-l border-border/70 text-muted-foreground hover:text-foreground transition-colors"
                  title={`See who's logging at ${plant.name}`}
                >
                  <Users className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3 py-4">
          <Skeleton className="h-[270px] w-full rounded-xl" />
          <div className="grid grid-cols-3 gap-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9 rounded-lg" />)}
          </div>
        </div>
      ) : !loaded.length || !radarData.length ? (
        <div className="h-[270px] flex items-center justify-center text-xs text-muted-foreground">
          No entity/logging data for this period.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Prominent Large Radar chart */}
          <div className="w-full h-[270px] sm:h-[285px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="82%" margin={{ top: 12, right: 28, bottom: 12, left: 28 }}>
                <PolarGrid stroke="hsl(var(--border))" strokeOpacity={0.8} />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{
                    fontSize: 11,
                    fontWeight: 600,
                    fill: 'hsl(var(--foreground))',
                    fillOpacity: 0.9,
                  }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickCount={5}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                {loaded.map(({ plant }, i) => (
                  <Radar
                    key={plant.id}
                    name={plant.name}
                    dataKey={plant.id}
                    stroke={DRILL_COLORS[i % DRILL_COLORS.length]}
                    fill={DRILL_COLORS[i % DRILL_COLORS.length]}
                    fillOpacity={loaded.length > 1 ? 0.18 : 0.28}
                    strokeWidth={2}
                    dot={{
                      r: 3.5,
                      fill: DRILL_COLORS[i % DRILL_COLORS.length],
                      stroke: 'hsl(var(--card))',
                      strokeWidth: 1.5,
                    }}
                    activeDot={{
                      r: 5.5,
                      stroke: 'hsl(var(--card))',
                      strokeWidth: 2,
                    }}
                    connectNulls
                  />
                ))}
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 12,
                    fontSize: 12,
                    boxShadow: 'var(--shadow-elev)',
                    padding: '8px 12px',
                  }}
                  formatter={(v: number, name: string) => [`${v == null ? '—' : `${v}%`}`, name]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-axis breakdown bars */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 pt-2.5 border-t border-border/60">
            {axisBreakdown.map((axis) => (
              <div key={axis.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">{axis.label}</span>
                  <span
                    className="tabular-nums font-bold font-numeral"
                    style={{ color: completenessColor(axis.avg) }}
                  >
                    {axis.avg == null ? '—' : `${axis.avg}%`}
                  </span>
                </div>
                <div className="h-1.5 bg-muted/80 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${completenessBarColor(axis.avg)}`}
                    style={{ width: `${axis.avg ?? 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
