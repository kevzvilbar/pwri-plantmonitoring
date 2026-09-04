// ── Water balance bridge (waterfall) ─────────────────────────────────────────
// IWA-style water balance rendered as a waterfall: Raw water in → Treatment
// loss → + Blending → Distribution/NRW loss → Locator consumption. Each delta
// bar is derived so the bars telescope exactly onto the next total — no
// separate reconciliation step needed.
//
// Recharts has no native waterfall type, so each row is a stacked <Bar> pair:
// an invisible `base` segment (the floating offset) under a colored `height`
// segment (the visible delta/total). Same technique used for any "bridge"
// chart in Recharts — see e.g. https://recharts.org bar-chart-stacked docs.
//
// Reuses the dashboard's existing metric colors (chartColors.ts) instead of
// inventing new ones, so this reads as the same visual language as the NRW /
// Production / Blending charts elsewhere on the dashboard:
//   C_RAWWATER    → raw water in (start)
//   C_RECOVERY    → treatment loss (tied to RO recovery — water not
//                   converted to product)
//   C_BLEND_VOLUME→ blending volume added back into distribution
//   C_NRW         → distribution / non-revenue water loss
//   C_CONSUMPTION → locator (billed) consumption (end)
//
// ── Data sourcing (important) ────────────────────────────────────────────
// An earlier version of this card summed daily_plant_summary directly.
// That table has no populate function anywhere in this repo (no trigger, no
// edge function, no migration ever INSERTs into it) and — more importantly —
// the rest of this dashboard deliberately does NOT use it for these three
// fields. The Overview StatCards and every historical trend chart compute
// Raw Water / Production / Consumption from raw meter readings via a
// meter-replacement-aware delta walk (see lib/entityDeltas.ts), because a
// naive column sum has a real bug history here (see that file's header).
// This card now uses the same computation, over the same shared dashboard
// date range, so its numbers agree with the StatCards and trend charts
// sitting right above it instead of silently drifting from them.
//
// blending_events is still summed directly (unchanged from the original
// version) — that part was already correct: daily_plant_summary.blending_m3
// is meant to be filled in nightly, but that job has a documented history of
// silently not running (see Dashboard.tsx's "today's blending" comment), so
// blending_events — the table Operations → Blending actually writes to — is
// the trustworthy source, same as BlendingVolumeCard.tsx already does it.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, startOfDay, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from 'recharts';
import {
  C_RAWWATER, C_RECOVERY, C_BLEND_VOLUME, C_NRW, C_CONSUMPTION,
} from '@/lib/chartColors';
import { computeEntityDeltas } from '@/lib/entityDeltas';
import { useAppStore } from '@/store/appStore';
import { RANGE_DAYS, rangeKeyToDays, type RangeKey } from './types';
import { ModernChartLegend } from './TrendChartLegend';

export type WaterBalanceTotals = {
  hasAnyData: boolean;
  rawWater: number;
  production: number;
  locatorConsumption: number;
  blending: number;
};

export type BridgeRow = {
  name: string;
  base: number;
  height: number;
  fill: string;
  deltaLabel: string;
  kind: 'start' | 'delta' | 'end';
};

// ── Shared date-range resolution ─────────────────────────────────────────
// Mirrors TrendChart.tsx's startISO/endISO/startKey/endKey useMemo exactly
// (same RANGE_DAYS lookup, same UTC+8-safe end-of-day cap for preset
// ranges, same CUSTOM passthrough) so this card's query window always
// matches what the trend charts above it are drawing. Kept as a local
// mirror rather than an import for the same reason lib/entityDeltas.ts is —
// see that file's header.
export function resolveDateWindow(range: RangeKey, from: string, to: string) {
  if (range === 'CUSTOM') {
    const s = new Date(`${from}T00:00:00`);
    const e = new Date(`${to}T23:59:59`);
    return { startISO: s.toISOString(), endISO: e.toISOString(), startKey: from, endKey: to };
  }
  const days = RANGE_DAYS[range];
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const start = startOfDay(subDays(today, days));
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startKey: format(start, 'yyyy-MM-dd'),
    endKey: format(today, 'yyyy-MM-dd'),
  };
}

// ── Data ──────────────────────────────────────────────────────────────────
// Follows the shared dashboard date range (chartRange/chartFrom/chartTo from
// appStore) instead of taking from/to as props — same convention
// ComplianceRadarCard and CostSunburst use for cards that don't render their
// own range picker.
function useWaterBalancePeriodTotals(plantIds: string[]) {
  const hasPlants = plantIds.length > 0;
  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);

  const { startISO, endISO, startKey, endKey } = useMemo(
    () => resolveDateWindow(chartRange, chartFrom, chartTo),
    [chartRange, chartFrom, chartTo],
  );

  // Plant meter config — which plants source Production from the RO permeate
  // meter instead of (or in addition to) a product meter. Mirrors the query
  // TrendChart.tsx runs for the same purpose.
  const { data: permeateConfig } = useQuery({
    queryKey: ['wb-plant-meter-config', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id, permeate_is_production, config')
        .in('plant_id', plantIds);
      const permeateCounts = new Set<string>();
      const productExcluded = new Set<string>();
      (data ?? []).forEach((row: any) => {
        const permeateOn = row.permeate_is_production === true || row.config?.permeate_is_production === true;
        if (permeateOn) permeateCounts.add(row.plant_id);
        if (row.config?.ro_production_source === 'permeate' && permeateOn) productExcluded.add(row.plant_id);
      });
      return { permeateCounts, productExcluded };
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });
  // Stable empty-Set fallbacks: without useMemo here, `?? new Set()` mints a
  // fresh object every render while the query is still loading, which would
  // otherwise invalidate the totals useMemo below on every render for no
  // reason (caught by react-hooks/exhaustive-deps).
  const permeateIsProductionPlants = useMemo(
    () => permeateConfig?.permeateCounts ?? new Set<string>(),
    [permeateConfig],
  );
  const productExcludedPlants = useMemo(
    () => permeateConfig?.productExcluded ?? new Set<string>(),
    [permeateConfig],
  );

  // RO train → plant / unit_type map, needed to route permeate deltas back
  // to a plant and to exclude secondary (2nd-pass) units from production.
  const { data: roTrainMeta } = useQuery({
    queryKey: ['wb-ro-train-ids', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('ro_trains' as never) as any)
        .select('id, plant_id, unit_type')
        .in('plant_id', plantIds);
      const rows = data ?? [];
      const trainPlantMap = new Map<string, string>();
      const trainUnitTypeMap = new Map<string, string>();
      rows.forEach((t: any) => {
        trainPlantMap.set(t.id, t.plant_id);
        trainUnitTypeMap.set(t.id, t.unit_type ?? 'primary');
      });
      return { ids: rows.map((t: any) => t.id as string), trainPlantMap, trainUnitTypeMap };
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });
  const trainIds = roTrainMeta?.ids ?? [];
  const trainPlantMap = useMemo(
    () => roTrainMeta?.trainPlantMap ?? new Map<string, string>(),
    [roTrainMeta],
  );
  const trainUnitTypeMap = useMemo(
    () => roTrainMeta?.trainUnitTypeMap ?? new Map<string, string>(),
    [roTrainMeta],
  );

  // Product meters flagged is_derived (mirrored/residual meters) — treated as
  // direct-mode, same as TrendChart.tsx, so a derived meter's own value isn't
  // diffed against the previous row as if it were a rising cumulative meter.
  const { data: directProductMeterIds } = useQuery({
    queryKey: ['wb-product-meter-direct-ids', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as never) as any)
        .select('id,is_derived')
        .in('plant_id', plantIds);
      return new Set<string>((data ?? []).filter((m: any) => m.is_derived === true).map((m: any) => m.id as string));
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });

  // Active locator IDs + direct-mode set (default_input_mode='direct' or
  // is_derived) — locator_readings has no plant_id column, so IDs must be
  // resolved via the locators table first (same two-step fix TrendChart.tsx
  // applies).
  const { data: locatorMeta } = useQuery({
    queryKey: ['wb-locator-meta', plantIds],
    queryFn: async () => {
      const { data } = await supabase
        .from('locators').select('id,default_input_mode,is_derived')
        .in('plant_id', plantIds).eq('status', 'Active');
      const rows = data ?? [];
      return {
        ids: rows.map((l) => l.id as string),
        directIds: new Set<string>(
          rows.filter((l: any) => l.default_input_mode === 'direct' || l.is_derived === true).map((l) => l.id as string),
        ),
      };
    },
    enabled: hasPlants,
    staleTime: 10 * 60_000,
  });
  const locatorIds = locatorMeta?.ids ?? [];
  const directLocatorIds = useMemo(
    () => locatorMeta?.directIds ?? new Set<string>(),
    [locatorMeta],
  );

  const { data: wellReadings, isFetching: fWell, error: eWell } = useQuery({
    queryKey: ['wb-well-readings', plantIds, startKey, endKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('well_readings')
        .select('well_id,current_reading,previous_reading,daily_volume,reading_datetime,is_meter_replacement,plant_id,norm_status')
        .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 5 * 60_000,
  });

  const { data: productReadings, isFetching: fProduct, error: eProduct } = useQuery({
    queryKey: ['wb-product-readings', plantIds, startKey, endKey],
    queryFn: async () => {
      const FULL = 'meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id,norm_status';
      const LEGACY = 'meter_id,daily_volume,current_reading,previous_reading,reading_datetime,plant_id,norm_status';
      const { data, error } = await (supabase.from('product_meter_readings' as never) as any)
        .select(FULL).in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      if (error) {
        if (error.message?.includes('is_meter_replacement')) {
          const { data: d2, error: e2 } = await (supabase.from('product_meter_readings' as never) as any)
            .select(LEGACY).in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
          if (e2) throw e2;
          return d2 ?? [];
        }
        throw error;
      }
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 5 * 60_000,
  });

  const { data: roReadings, isFetching: fRo, error: eRo } = useQuery({
    queryKey: ['wb-ro-readings', plantIds, startKey, endKey, trainIds],
    queryFn: async () => {
      if (!trainIds.length) return [];
      const FULL = 'train_id,permeate_meter,permeate_meter_prev,permeate_meter_delta,reading_datetime,is_meter_replacement,norm_status';
      const LEGACY = 'train_id,permeate_meter,reading_datetime,is_meter_replacement,norm_status';
      const { data, error } = await (supabase.from('ro_train_readings' as never) as any)
        .select(FULL).in('train_id', trainIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      if (error) {
        const { data: d2, error: e2 } = await (supabase.from('ro_train_readings' as never) as any)
          .select(LEGACY).in('train_id', trainIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
        if (e2) throw e2;
        return d2 ?? [];
      }
      return data ?? [];
    },
    enabled: hasPlants && roTrainMeta !== undefined,
    staleTime: 5 * 60_000,
  });

  const { data: locReadings, isFetching: fLoc, error: eLoc } = useQuery({
    queryKey: ['wb-loc-readings', plantIds, startKey, endKey, locatorIds],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data, error } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,norm_status')
        .in('locator_id', locatorIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants && locatorMeta !== undefined,
    staleTime: 5 * 60_000,
  });

  // blending_events — unchanged from the original version of this card.
  const { data: blendRows, isFetching: fBlend, error: eBlend } = useQuery({
    queryKey: ['wb-blending-events', plantIds, startKey, endKey],
    queryFn: async () => {
      const { data, error } = await (supabase.from('blending_events' as any) as any)
        .select('volume_m3')
        .in('plant_id', plantIds).gte('event_date', startKey).lte('event_date', endKey);
      if (error) throw error;
      return data ?? [];
    },
    enabled: hasPlants,
    staleTime: 5 * 60_000,
  });

  const metaLoaded = permeateConfig !== undefined && roTrainMeta !== undefined
    && directProductMeterIds !== undefined && locatorMeta !== undefined;
  const isLoading = hasPlants && (!metaLoaded || fWell || fProduct || fRo || fLoc || fBlend);
  const error = eWell || eProduct || eRo || eLoc || eBlend;

  const totals = useMemo<WaterBalanceTotals | null>(() => {
    if (!hasPlants || isLoading || error) return null;

    const rawWater = computeEntityDeltas(wellReadings ?? [], 'well_id', null)
      .reduce((s, { delta }) => s + delta, 0);

    // Production — Step 1: product meter deltas, excluding plants whose
    // product meter reads the same water their RO permeate meter already
    // counts (exclusive permeate mode). Plants in "both" mode fall through
    // here on purpose — their product meter is a genuinely separate source.
    let production = computeEntityDeltas(
      (productReadings ?? []).filter((r: any) => !productExcludedPlants.has(r.plant_id)),
      'meter_id', 'daily_volume', { directModeIds: directProductMeterIds ?? new Set() },
    ).reduce((s, { delta }) => s + delta, 0);

    // Production — Step 2: RO permeate deltas for plants where
    // permeate_is_production = true. Primary path uses the pre-saved
    // permeate_meter_delta column; falls back to walking the raw cumulative
    // permeate_meter odometer when that column isn't populated yet.
    if (permeateIsProductionPlants.size > 0) {
      const hasSavedDelta = (roReadings ?? []).some(
        (r: any) => r.permeate_meter_delta != null && +r.permeate_meter_delta > 0,
      );
      if (hasSavedDelta) {
        (roReadings ?? []).forEach((r: any) => {
          const plantId = trainPlantMap.get(r.train_id);
          if (!plantId || !permeateIsProductionPlants.has(plantId)) return;
          if (trainUnitTypeMap.get(r.train_id) === 'secondary') return;
          if (r.is_meter_replacement) return;
          const delta = r.permeate_meter_delta != null ? Math.max(0, +r.permeate_meter_delta)
            : r.permeate_meter != null && r.permeate_meter_prev != null
              ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
              : null;
          if (delta === null) return;
          production += delta;
        });
      } else {
        const permeateRoReadings = (roReadings ?? [])
          .filter((r: any) => {
            const plantId = trainPlantMap.get(r.train_id);
            return plantId && permeateIsProductionPlants.has(plantId)
              && trainUnitTypeMap.get(r.train_id) !== 'secondary'
              && r.permeate_meter != null;
          })
          .map((r: any) => ({ ...r, current_reading: +r.permeate_meter }));
        computeEntityDeltas(permeateRoReadings, 'train_id', null, { skipAfterRepl: true })
          .forEach(({ delta, isMeterReplacement }) => {
            if (delta === 0 || isMeterReplacement) return;
            production += delta;
          });
      }
    }

    const locatorConsumption = computeEntityDeltas(
      locReadings ?? [], 'locator_id', 'daily_volume', { directModeIds: directLocatorIds },
    ).reduce((s, { delta }) => s + delta, 0);

    const blending = (blendRows ?? []).reduce((s: number, r: any) => s + (Number(r.volume_m3) || 0), 0);

    const hasAnyData = (wellReadings?.length ?? 0) > 0 || (productReadings?.length ?? 0) > 0
      || (locReadings?.length ?? 0) > 0 || (roReadings?.length ?? 0) > 0 || (blendRows?.length ?? 0) > 0;

    return { hasAnyData, rawWater, production, locatorConsumption, blending };
  }, [
    hasPlants, isLoading, error, wellReadings, productReadings, roReadings, locReadings, blendRows,
    productExcludedPlants, directProductMeterIds, permeateIsProductionPlants, trainPlantMap,
    trainUnitTypeMap, directLocatorIds,
  ]);

  return {
    totals, isLoading, error, chartRange, chartFrom, chartTo, startKey, endKey,
  };
}

// ── Bridge math ───────────────────────────────────────────────────────────
const fmtTotal = (v: number) => `${Math.round(v).toLocaleString()} m\u00b3`;
const fmtDelta = (v: number) =>
  `${v >= 0 ? '+' : '\u2212'}${Math.round(Math.abs(v)).toLocaleString()} m\u00b3`;

// Deltas are derived, not looked up — treatmentLoss and nrwLoss can come out
// negative on real data (a correction, an extra input source, a meter-timing
// mismatch), and the bar should render as a gain rather than assume a sign.
export function buildBridgeRows(totals: WaterBalanceTotals): BridgeRow[] {
  const treatmentLoss = totals.rawWater - totals.production;
  const distributionInput = totals.production + totals.blending;
  const nrwLoss = distributionInput - totals.locatorConsumption;

  const deltas: { label: string; amount: number; color: string }[] = [
    { label: 'Treatment loss', amount: -treatmentLoss, color: C_RECOVERY },
    { label: 'Blending', amount: totals.blending, color: C_BLEND_VOLUME },
    { label: 'Distribution / NRW', amount: -nrwLoss, color: C_NRW },
  ];

  const rows: BridgeRow[] = [{
    name: 'Raw water in',
    base: 0,
    height: totals.rawWater,
    fill: C_RAWWATER,
    deltaLabel: fmtTotal(totals.rawWater),
    kind: 'start',
  }];

  let cumulative = totals.rawWater;
  for (const d of deltas) {
    const next = cumulative + d.amount;
    rows.push({
      name: d.label,
      base: Math.min(cumulative, next),
      height: Math.abs(d.amount),
      fill: d.color,
      deltaLabel: fmtDelta(d.amount),
      kind: 'delta',
    });
    cumulative = next;
  }

  // cumulative now equals totals.locatorConsumption exactly, by construction
  // (nrwLoss was defined in terms of it) — using it here rather than the raw
  // field keeps the bars telescoping with zero drift.
  rows.push({
    name: 'Locator consumption',
    base: 0,
    height: cumulative,
    fill: C_CONSUMPTION,
    deltaLabel: fmtTotal(cumulative),
    kind: 'end',
  });

  return rows;
}

function BridgeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row: BridgeRow | undefined = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 10,
      fontSize: 11,
      padding: '6px 10px',
    }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ color: row.fill }}>{row.deltaLabel}</div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────
export function WaterBalanceBridgeCard({
  plantIds, title = 'Water balance',
}: {
  plantIds: string[];
  title?: string;
}) {
  const {
    totals, isLoading, error, chartRange, chartFrom, chartTo, startKey, endKey,
  } = useWaterBalancePeriodTotals(plantIds);
  const rows = useMemo(() => (totals ? buildBridgeRows(totals) : []), [totals]);

  // Same "last Nd for presets, real dates for CUSTOM" label ComplianceRadarCard uses.
  const isCustomRange = chartRange === 'CUSTOM';
  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);
  const rangeLabel = isCustomRange
    ? (startKey === endKey
        ? format(parseISO(startKey), 'MMM d')
        : `${format(parseISO(startKey), 'MMM d')}–${format(parseISO(endKey), 'MMM d')}`)
    : `last ${days}d`;

  return (
    <Card className="p-3" data-testid="water-balance-bridge">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className="text-2xs text-muted-foreground">{rangeLabel}</span>
      </div>

      {isLoading ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      ) : error ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-danger">
          Couldn&apos;t load water balance data.
        </div>
      ) : !totals?.hasAnyData ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          No readings for this range.
        </div>
      ) : (
        <>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fontWeight: 500 }}
                  stroke="hsl(var(--muted-foreground))"
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                  width={40}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<BridgeTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }} />
                <Bar dataKey="base" stackId="bridge" isAnimationActive={false}>
                  {/* Recharts (2.15.4) ignores a `fill` prop set directly on a
                      stacked <Bar> that has no <Cell> children — it falls
                      back to the same color the sibling stacked Bar's Cells
                      use for that row, instead of actually painting
                      transparent. The math was always correct (this segment
                      really was floating at the right offset) but with both
                      segments rendered in the same solid color, every bar
                      LOOKED like one solid block from 0 — indistinguishable
                      from a non-floating bar. Giving this Bar its own
                      transparent Cells (matched 1:1 with `rows`, same as the
                      Bar below) is what actually makes it invisible. */}
                  {rows.map((r) => <Cell key={r.name} fill="transparent" />)}
                </Bar>
                <Bar dataKey="height" stackId="bridge" radius={[3, 3, 3, 3]} isAnimationActive={false}>
                  {rows.map((r) => <Cell key={r.name} fill={r.fill} />)}
                  <LabelList
                    dataKey="deltaLabel"
                    position="top"
                    style={{ fontSize: 10, fontWeight: 600 }}
                    fill="hsl(var(--muted-foreground))"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ModernChartLegend items={[
            { color: C_RAWWATER, label: 'Raw water in', shape: 'bar' },
            { color: C_RECOVERY, label: 'Treatment loss', shape: 'bar' },
            { color: C_BLEND_VOLUME, label: 'Blending', shape: 'bar' },
            { color: C_NRW, label: 'Distribution / NRW', shape: 'bar' },
            { color: C_CONSUMPTION, label: 'Locator consumption', shape: 'bar' },
          ]}
          />
        </>
      )}
    </Card>
  );
}
