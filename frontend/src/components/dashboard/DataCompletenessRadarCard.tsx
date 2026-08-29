// Data Completeness Radar — one polygon per plant, axes = % of expected
// data-entry actually logged for that category over the selected window
// (100% = every active entity logged on every day in range; Power Log
// and Chemicals are plant-level instead of per-entity — one dosing log
// expected per day, not one per well/train/etc). Same radar mechanic as
// ComplianceRadarCard, just re-pointed from "actual ÷ threshold" to
// "logged ÷ expected" so it reads as an operational data-quality gauge
// instead of a violation gauge.
//
// Deliberately PLANT-level, not per-operator — the radar itself never
// scores or ranks individual operators. Every readings table's
// `recorded_by`/`completed_by` is nullable (imports, shared logins), and
// there's no shift-roster table anywhere in the schema — so there's no
// reliable way to pin a specific MISSING entry on a specific person, and
// a per-operator polygon here would misattribute gaps that aren't
// actually anyone's fault.
//
// For that reason, per-operator depth lives behind a link-out to
// Employees → KPI → Individual Activity instead of being rebuilt here.
// That view already handles this correctly: it shows raw per-operator
// *activity* (who logged what) rather than scoring anyone against a
// pass/fail target, which is the right framing when duties on a
// multi-operator plant aren't evenly split. Each plant chip below links
// straight to that plant's operator breakdown, pre-expanded.
import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import { Users, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
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

const AXES: { id: string; label: string; icon?: string }[] = [
  { id: 'wells', label: 'Wells' },
  { id: 'locators', label: 'Locators' },
  { id: 'trains', label: 'RO Trains' },
  { id: 'meters', label: 'Product Meters' },
  { id: 'power', label: 'Power Log' },
  { id: 'chemicals', label: 'Chemicals' },
];

type Completeness = Record<string, number | null>;

// Distinct "entity + calendar day" pairs actually logged, vs
// entityCount × days expected. Capped at 100 so a plant that logs an
// entity more than once a day doesn't blow past a full polygon.
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
  from?: string, // yyyy-MM-dd — explicit range start; overrides `days` when given
  to?: string,   // yyyy-MM-dd — explicit range end; bounds the query when given
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

  const radarData = useMemo(() => {
    if (!loaded.length) return [];
    return AXES.map((axis) => {
      const row: Record<string, string | number | null> = { axis: axis.label };
      for (const { plant, completeness } of loaded) {
        row[plant.id] = completeness[axis.id];
      }
      return row;
    });
  }, [loaded]);

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

  // Aggregate per-axis breakdown (first plant shown when multiple)
  const axisBreakdown = useMemo(() => {
    if (!loaded.length) return [];
    return AXES.map((axis) => {
      const vals = loaded.map((p) => p.completeness[axis.id]).filter((v): v is number => v != null);
      const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
      return { ...axis, avg };
    });
  }, [loaded]);

  return (
    <Card className="p-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-1 mb-3">
        <span className="text-xs font-bold tracking-[-0.01em] text-foreground">Data Completeness Radar</span>
        <span className="text-2xs text-muted-foreground ml-auto">logged ÷ expected · {rangeLabel}</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[200px] w-full rounded-lg" />
          <div className="grid grid-cols-3 gap-1.5">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8 rounded-md" />)}
          </div>
        </div>
      ) : !loaded.length || !radarData.length ? (
        <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground">
          No entity/logging data for this period.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Score pills row */}
          <div className="flex flex-wrap gap-1.5">
            {plantStatus.map(({ plant, color, avg, worst, tone }) => {
              const Icon = tone === 'danger' ? AlertTriangle : tone === 'warn' ? TrendingUp : CheckCircle2;
              return (
                <div
                  key={plant.id}
                  className="flex items-center gap-1.5 text-xs bg-muted/60 rounded-lg px-2 py-1 border border-border/60"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-foreground/90 font-medium truncate max-w-[80px]">{plant.name}</span>
                  <span
                    className="tabular-nums font-bold font-numeral text-xs ml-0.5"
                    style={{ color: completenessColor(avg) }}
                  >
                    {avg == null ? '—' : `${avg}%`}
                  </span>
                  <StatusPill tone={tone} className="px-1.5 py-0 text-[10px]">
                    {tone === 'danger' ? 'Gaps' : tone === 'warn' ? 'Partial' : tone === 'muted' ? 'No data' : 'Good'}
                  </StatusPill>
                  <Link
                    to={`/employees?tab=kpi&view=individual&plant=${plant.id}`}
                    className="flex items-center gap-0.5 pl-1 ml-0.5 border-l border-border/60 text-muted-foreground hover:text-foreground transition-colors"
                    title={`See who's logging at ${plant.name}`}
                  >
                    <Users className="h-3 w-3" />
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Radar chart */}
          <div className="w-full h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="75%" margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
                <PolarGrid stroke="hsl(var(--border))" strokeOpacity={0.7} />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }}
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
                    fillOpacity={loaded.length > 1 ? 0.12 : 0.2}
                    strokeWidth={1.5}
                    connectNulls
                  />
                ))}
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                    borderRadius: 10, fontSize: 11, boxShadow: 'var(--shadow-elev)',
                  }}
                  formatter={(v: number, name: string) => [`${v == null ? '—' : `${v}%`}`, name]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-axis breakdown bars */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 pt-1 border-t border-border/50">
            {axisBreakdown.map((axis) => (
              <div key={axis.id} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{axis.label}</span>
                  <span
                    className="text-[10px] tabular-nums font-semibold font-numeral"
                    style={{ color: completenessColor(axis.avg) }}
                  >
                    {axis.avg == null ? '—' : `${axis.avg}%`}
                  </span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
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
