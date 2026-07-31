// Data Completeness Radar — one polygon per plant, axes = % of expected
// data-entry actually logged for that category over the selected window
// (100% = every active entity logged on every day in range; the
// Checklists axis is completed ÷ scheduled checklist_executions rows
// instead of an entity×day count). Same radar mechanic as
// ComplianceRadarCard, just re-pointed from "actual ÷ threshold" to
// "logged ÷ expected" so it reads as an operational data-quality gauge
// instead of a violation gauge.
//
// Deliberately PLANT-level, not per-operator. Every readings table's
// `recorded_by`/`completed_by` is nullable (imports, shared logins),
// and there's no shift-roster table anywhere in the schema — so there's
// no reliable way to pin a specific missing entry on a specific person.
// A per-operator version of this chart would misattribute gaps that
// aren't actually anyone's fault. Aggregating to the plant sidesteps
// that and still surfaces the same "what's not getting logged" signal.
// If per-operator accountability is wanted later, it needs a shift/
// roster table first — see reading_gap_reasons for the closest existing
// analogue (it already captures *why* a gap happened, which a raw
// completion % would otherwise throw away).
import { useMemo } from 'react';
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
import { DRILL_COLORS } from './TrendChart';

interface Props {
  plantIds: string[];
}

const AXES: { id: string; label: string }[] = [
  { id: 'wells', label: 'Wells' },
  { id: 'locators', label: 'Locators' },
  { id: 'trains', label: 'RO Trains' },
  { id: 'meters', label: 'Product Meters' },
  { id: 'power', label: 'Power Log' },
  { id: 'checklists', label: 'Checklists' },
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

async function fetchPlantCompleteness(plantId: string, days: number): Promise<Completeness> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();
  const sinceDateOnly = sinceIso.slice(0, 10);

  const [
    wellTotal, locTotal, trainTotal, meterTotal,
    wellRows, locRows, trainRows, meterRows,
    powerRows, checklistRows,
  ] = await Promise.all([
    supabase.from('wells').select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId).eq('status', 'Active').then((r) => r.count ?? 0),
    supabase.from('locators').select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId).eq('status', 'Active').then((r) => r.count ?? 0),
    supabase.from('ro_trains').select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId).then((r) => r.count ?? 0),
    supabase.from('product_meters').select('id', { count: 'exact', head: true })
      .eq('plant_id', plantId).eq('status', 'Active').then((r) => r.count ?? 0),

    supabase.from('well_readings').select('well_id, reading_datetime')
      .eq('plant_id', plantId).gte('reading_datetime', sinceIso)
      .then((r) => (r.data ?? []).map((x: any) => ({ entityId: x.well_id, dt: x.reading_datetime }))),
    supabase.from('locator_readings').select('locator_id, reading_datetime')
      .eq('plant_id', plantId).gte('reading_datetime', sinceIso)
      .then((r) => (r.data ?? []).map((x: any) => ({ entityId: x.locator_id, dt: x.reading_datetime }))),
    supabase.from('ro_train_readings').select('train_id, reading_datetime')
      .eq('plant_id', plantId).gte('reading_datetime', sinceIso)
      .then((r) => (r.data ?? []).map((x: any) => ({ entityId: x.train_id, dt: x.reading_datetime }))),
    supabase.from('product_meter_readings').select('meter_id, reading_datetime')
      .eq('plant_id', plantId).gte('reading_datetime', sinceIso)
      .then((r) => (r.data ?? []).map((x: any) => ({ entityId: x.meter_id, dt: x.reading_datetime }))),

    supabase.from('power_readings').select('reading_datetime')
      .eq('plant_id', plantId).gte('reading_datetime', sinceIso)
      .then((r) => r.data ?? []),
    supabase.from('checklist_executions').select('completed')
      .eq('plant_id', plantId).gte('execution_date', sinceDateOnly)
      .then((r) => r.data ?? []),
  ]);

  // Power is metered at the plant level (one log per day), not per-entity.
  const powerDays = new Set(powerRows.map((r: any) => String(r.reading_datetime).slice(0, 10))).size;
  const powerPct = days ? Math.min(100, Math.round((powerDays / days) * 1000) / 10) : null;

  // Checklist rows are pre-scheduled per occurrence (Daily/Weekly/Monthly/...),
  // so completed ÷ scheduled already accounts for frequency — no need to
  // hand-roll a per-frequency expected count.
  const checklistTotal = checklistRows.length;
  const checklistDone = checklistRows.filter((r: any) => r.completed).length;
  const checklistPct = checklistTotal ? Math.round((checklistDone / checklistTotal) * 1000) / 10 : null;

  return {
    wells: coverageRatio(wellRows, wellTotal, days),
    locators: coverageRatio(locRows, locTotal, days),
    trains: coverageRatio(trainRows, trainTotal, days),
    meters: coverageRatio(meterRows, meterTotal, days),
    power: powerPct,
    checklists: checklistPct,
  };
}

export function DataCompletenessRadarCard({ plantIds }: Props) {
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
      queryKey: ['data-completeness-radar', p.id, days],
      queryFn: async () => ({ plant: p, completeness: await fetchPlantCompleteness(p.id, days) }),
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

  // Per-plant status pill driven by the single WORST (lowest) axis — the
  // inverse of ComplianceRadarCard, where high values are the problem;
  // here low values are.
  const plantStatus = loaded.map(({ plant }, i) => {
    const values = radarData
      .map((row) => row[plant.id])
      .filter((v): v is number => typeof v === 'number');
    const worst = values.length ? Math.min(...values) : null;
    const tone = worst == null ? 'muted' as const
      : worst < 50 ? 'danger' as const
      : worst < 80 ? 'warn' as const
      : 'accent' as const;
    return { plant, color: DRILL_COLORS[i % DRILL_COLORS.length], worst, tone };
  });

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-1 mb-2">
        <span className="text-xs font-bold tracking-[-0.01em] text-foreground">Data Completeness Radar</span>
        <span className="text-2xs text-muted-foreground ml-auto">logged ÷ expected · last {days}d</span>
      </div>

      {isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : !loaded.length || !radarData.length ? (
        <div className="h-[240px] flex items-center justify-center text-xs text-muted-foreground">
          No entity/checklist data for this period.
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
                  domain={[0, 100]}
                  tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }}
                  tickCount={5}
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
                    borderRadius: 10, fontSize: 11, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  }}
                  formatter={(v: number) => (v == null ? '—' : `${v}%`)}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

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
                  {tone === 'danger' ? 'Big gaps' : tone === 'warn' ? 'Some gaps' : tone === 'muted' ? 'No data' : 'Complete'}
                </StatusPill>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
