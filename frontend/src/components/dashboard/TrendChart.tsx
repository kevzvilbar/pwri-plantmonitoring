import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calc } from '@/lib/calculations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ComposedChart, Bar,
} from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';
import {
  ChartMetric, DashboardViewMode, RANGE_DAYS, RangeKey, TREND_Y_LABEL,
} from './types';
import { useAppStore } from '@/store/appStore';

// Renders the per-cluster trend chart slot beneath a cluster's StatCards.
//   • inline   — every chart in the cluster is rendered directly below
//                the cards (full-width, compact height) so the user can
//                just scroll to see all trends.
//   • sections — at most one chart (matching `expandedMetric`) is
//                rendered below the cards. Single-open behaviour: the
//                user clicks a KPI card to fold its chart open here;
//                clicking another KPI auto-closes the previous.
//   • popup    — nothing is rendered here; charts surface only inside
//                the TrendModal opened from the StatCards above.
export function ClusterCharts({
  metrics, viewMode, expandedMetric, plantIds, clusterId,
}: {
  metrics: ChartMetric[];
  viewMode: DashboardViewMode;
  expandedMetric: string | null;
  plantIds: string[];
  clusterId: string;
}) {
  if (viewMode === 'popup') return null;
  if (viewMode === 'inline') {
    return (
      <div className="space-y-2 mt-2" data-testid={`cluster-inline-charts-${clusterId}`}>
        {metrics.map((m) => (
          <InlineTrendChart key={m.metric} metric={m.metric} title={m.title} plantIds={plantIds} compact />
        ))}
      </div>
    );
  }
  // sections — render the expanded chart only if it belongs to this cluster
  if (viewMode === 'sections' && expandedMetric) {
    const m = metrics.find((x) => x.metric === expandedMetric);
    if (!m) return null;
    return (
      <div className="mt-2" data-testid={`cluster-section-chart-${m.metric}`}>
        <InlineTrendChart metric={m.metric} title={m.title} plantIds={plantIds} />
      </div>
    );
  }
  return null;
}

// Card-wrapped trend chart used both for `inline` (compact height,
// stacked beneath each cluster) and `sections` (regular height,
// single open at a time). Title and range buttons share the same row
// so the chart area is maximised, especially on mobile.
export function InlineTrendChart({
  metric, title, plantIds, compact = false,
}: {
  metric: string;
  title: string;
  plantIds: string[];
  compact?: boolean;
}) {
  return (
    <Card className="p-3" data-testid={`inline-trend-${metric}`}>
      <TrendChart metric={metric} title={title} plantIds={plantIds} compact={compact} />
    </Card>
  );
}

// Modal-wrapped trend chart used in `popup` view mode. Thin Dialog
// shell — the chart logic itself lives entirely in <TrendChart> below.
export function TrendModal({
  open, onClose, metric, title, plantIds,
}: {
  open: boolean;
  onClose: () => void;
  metric: string;
  title: string;
  plantIds: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Pick a date range to inspect the {title.toLowerCase()} time series for the selected plants.
          </DialogDescription>
        </DialogHeader>
        <TrendChart metric={metric} plantIds={plantIds} />
      </DialogContent>
    </Dialog>
  );
}

// Reusable trend chart used both inside the popup TrendModal and as
// an inline/section panel embedded directly on the dashboard. Owns
// its own range state, supabase queries, and chart rendering. The
// `compact` prop swaps in a shorter chart height for the inline view
// where multiple charts stack vertically and we want to keep the
// page from getting absurdly tall. When `title` is provided the
// component renders it on the same row as the range buttons so the
// chart area is maximised on mobile.
export function TrendChart({
  metric, plantIds, compact = false, title,
}: {
  metric: string;
  plantIds: string[];
  compact?: boolean;
  title?: string;
}) {
  // All charts share a single range selection via the global store so
  // that picking 14D on one chart instantly syncs every other chart.
  const range = useAppStore((s) => s.chartRange);
  const from = useAppStore((s) => s.chartFrom);
  const to = useAppStore((s) => s.chartTo);
  const setRange = useAppStore((s) => s.setChartRange);
  const setChartCustomDates = useAppStore((s) => s.setChartCustomDates);
  const handleFromChange = (v: string) => setChartCustomDates(v, to);
  const handleToChange = (v: string) => setChartCustomDates(from, v);
  // Toggle for the inline data summary table
  const [showSummary, setShowSummary] = useState(false);

  // Stable date-bounded ISO strings so react-query can cache properly.
  const { startISO, endISO, startKey, endKey } = useMemo(() => {
    if (range === 'CUSTOM') {
      const s = new Date(`${from}T00:00:00`);
      const e = new Date(`${to}T23:59:59`);
      return {
        startISO: s.toISOString(), endISO: e.toISOString(),
        startKey: from, endKey: to,
      };
    }
    const days = RANGE_DAYS[range];
    const end = new Date();
    const start = startOfDay(subDays(end, days));
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      startKey: format(start, 'yyyy-MM-dd'),
      endKey: format(end, 'yyyy-MM-dd'),
    };
  }, [range, from, to]);

  const needsWellReadings = metric === 'nrw' || metric === 'rawwater' || metric === 'pv';
  const needsProductMeterReadings = metric === 'production' || metric === 'nrw' || metric === 'pv';
  const needsLocReadings = metric === 'production' || metric === 'nrw';
  const needsRoReadings = metric === 'recovery' || metric === 'tds';
  const needsPowerReadings = metric === 'pv';
  const needsCostReadings = metric === 'productionCost';

  // ── Entity name lookups — fetched once per plant selection ─────────────────
  // Used to build human-friendly meter-replacement tooltip messages like
  // "Well 4 Raw Meter was Replaced" or "McDonalds Product Meter was Replaced".
  const { data: wellNames } = useQuery({
    queryKey: ['entity-names-wells', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((w: any) => map.set(w.id, w.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsWellReadings,
  });

  const { data: locatorNames } = useQuery({
    queryKey: ['entity-names-locators', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((l: any) => map.set(l.id, l.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  const { data: productMeterNames } = useQuery({
    queryKey: ['entity-names-product-meters', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as never) as any)
        .select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((m: any) => map.set(m.id, m.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
  });

  // Plant names are used for power meter replacement messages (one power meter per plant).
  const { data: plantNames } = useQuery({
    queryKey: ['entity-names-plants', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').in('id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((p: any) => map.set(p.id, p.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsPowerReadings,
  });

  const supaSelect = async <T,>(table: string, cols: string) => {
    // Supabase JS v2 narrows `from(table)` to a literal-string union
    // pulled from the generated types. Our caller passes a string
    // variable resolved at runtime, so we need a cast to bypass the
    // (otherwise correct) compile-time check. The helper is used only
    // with table names known to exist (locator_readings,
    // well_readings, ro_train_readings, power_readings) — all
    // validated by the unit tests below.
    const { data, error } = await supabase.from(table as never).select(cols)
      .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as T[]) ?? [];
  };

  const { data: locReadings, isFetching: fetchingLoc, error: errLoc } = useQuery({
    queryKey: ['trend-loc', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>('locator_readings', 'locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id'),
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  // Product meter readings — the treated-water output meters installed on
  // the product line. These are the authoritative source for Production volume,
  // distinct from well (raw water) meters and locator (distribution) meters.
  // The table is not in the generated Supabase types so we cast as `never`.
  const { data: productReadings, isFetching: fetchingProduct, error: errProduct } = useQuery({
    queryKey: ['trend-product', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      // Try with is_meter_replacement first; fall back gracefully if column
      // doesn't exist in this deployment (field will be undefined → false).
      const { data, error } = await (supabase.from('product_meter_readings' as never) as any)
        .select('meter_id,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id')
        .in('plant_id', plantIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      if (error) {
        if (error.message?.includes('is_meter_replacement')) {
          const { data: d2, error: e2 } = await (supabase.from('product_meter_readings' as never) as any)
            .select('current_reading,previous_reading,reading_datetime,plant_id')
            .in('plant_id', plantIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO);
          if (e2) throw new Error(`product_meter_readings: ${e2.message}`);
          return (d2 as any[]) ?? [];
        }
        throw new Error(`product_meter_readings: ${error.message}`);
      }
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
  });

  // ── Well readings — fetch with well_id so deltas are scoped per well ────────
  // Operations.tsx saves well readings with well_id + plant_id but never
  // writes daily_volume. Raw Water must therefore be computed as the sum of
  // (current_reading − previous_reading) per well per day, excluding rows
  // flagged is_meter_replacement and the first reading after a replacement.
  // Fetching well_id here (instead of relying on plant_id alone) lets
  // computeEntityDeltas group correctly by individual meter rather than by
  // plant, preventing cross-well subtraction that produced the -4,853,089 bug.
  const { data: wellReadings, isFetching: fetchingWell, error: errWell } = useQuery({
    queryKey: ['trend-well', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>(
      'well_readings',
      'well_id,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id',
    ),
    enabled: plantIds.length > 0 && needsWellReadings,
  });

  const { data: roReadings, isFetching: fetchingRo, error: errRo } = useQuery({
    queryKey: ['trend-ro', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>('ro_train_readings', 'recovery_pct,permeate_tds,reading_datetime'),
    enabled: plantIds.length > 0 && needsRoReadings,
  });
  const { data: powerReadings, isFetching: fetchingPower, error: errPower } = useQuery({
    queryKey: ['trend-power', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>('power_readings', 'daily_consumption_kwh,meter_reading_kwh,reading_datetime,is_meter_replacement,plant_id'),
    enabled: plantIds.length > 0 && needsPowerReadings,
  });

  // Production-cost rows use a date column (`cost_date`) rather than a
  // datetime, so the generic `supaSelect` helper (which filters on
  // `reading_datetime`) doesn't fit. Inline this single query instead.
  // `production_m3` is pulled so we can compute weighted ₱/m³ across
  // multi-plant selections (a simple average of per-plant `cost_per_m3`
  // would mis-weight a plant that produced 10× the volume).
  const { data: costReadings, isFetching: fetchingCost, error: errCost } = useQuery({
    queryKey: ['trend-cost', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('production_costs')
        .select('cost_date,power_cost,chem_cost,total_cost,production_m3')
        .in('plant_id', plantIds)
        .gte('cost_date', startKey)
        .lte('cost_date', endKey);
      if (error) throw new Error(`production_costs: ${error.message}`);
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsCostReadings,
  });

  const isFetching = fetchingLoc || fetchingWell || fetchingRo || fetchingPower || fetchingCost || fetchingProduct;
  const queryError = (errLoc || errWell || errRo || errPower || errCost || errProduct) as Error | null;

  const chartData = useMemo(() => {
    const byDay = new Map<string, any>();
    const ensure = (d: string, sortKey: number) =>
      byDay.get(d) ?? byDay.set(d, {
        date: d, sortKey,
        production: 0, consumption: 0, rawwater: 0,
        recovery: 0, recoverySamples: 0,
        tds: 0, tdsSamples: 0, kwh: 0,
        powerCost: 0, chemCost: 0, totalCost: 0,
        costProduction: 0,
        // _raw* fields accumulate the true unclamped deltas so the tooltip
        // can show the real value even when the chart plots 0 (clamped).
        // null means "no negative delta seen" → tooltip shows normal value.
        _rawProduction: null as number | null,
        _rawConsumption: null as number | null,
        _rawRawwater: null as number | null,
        _rawKwh: null as number | null,
        // _meterReplacements: list of human-readable entity names replaced on this day.
        // e.g. ["Well 4 Raw Meter", "McDonalds Product Meter"]
        _meterReplacements: [] as string[],
      }).get(d);

    // ── Unified meter-replacement-aware delta helper ────────────────────────
    // Used for ALL meter types: wells, locators, product meters, power.
    //
    // entityKeyField: the column that uniquely identifies an individual meter.
    //   • well_readings          → 'well_id'
    //   • locator_readings       → 'locator_id'
    //   • product_meter_readings → 'meter_id'
    //   • power_readings         → 'plant_id'  (one power meter per plant)
    //
    // Keying by the individual meter ID (not plant_id) prevents readings from
    // different meters at the same plant bleeding into each other's diff —
    // the root cause of the -4,853,089 / +885,406 spikes seen in Raw Water.
    //
    // dailyVolumeField: if the table stores a pre-computed daily volume column
    // (e.g. locator_readings.daily_volume), use it directly when present.
    // Wells and product meters don't have this column so pass null.
    //
    // Meter-replacement handling (matches Operations.tsx display logic):
    //   • REPL row (is_meter_replacement = true):
    //       delta = 0, new baseline = current_reading, flag entity as "afterRepl"
    //   • First non-REPL row after a REPL:
    //       delta = 0 (new meter has no valid predecessor yet), clear flag
    //   • All subsequent rows:
    //       delta = current_reading − last seen current_reading for that entity
    //
    // rawDelta is null when there is no predecessor (first reading in window,
    // or first after replacement) so the tooltip doesn't false-flag those as
    // negative readings.
    function computeEntityDeltas(
      readings: any[],
      entityKeyField: string,
      dailyVolumeField: string | null,
    ): { r: any; delta: number; rawDelta: number | null; isMeterReplacement: boolean }[] {
      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );

      const lastReading = new Map<string, number>(); // entityKey → last current_reading
      const afterRepl   = new Set<string>();          // entities whose next row is zeroed

      return sorted.map((r) => {
        const entityKey = r[entityKeyField] ?? r.plant_id ?? '__';
        const isMR      = !!r.is_meter_replacement;

        if (isMR) {
          lastReading.set(entityKey, +r.current_reading);
          afterRepl.add(entityKey);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
        }

        if (afterRepl.has(entityKey)) {
          lastReading.set(entityKey, +r.current_reading);
          afterRepl.delete(entityKey);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: false };
        }

        if (dailyVolumeField && r[dailyVolumeField] != null) {
          const rawDelta = +r[dailyVolumeField];
          const delta    = Math.max(0, rawDelta);
          lastReading.set(entityKey, +r.current_reading);
          return { r, delta, rawDelta, isMeterReplacement: false };
        }

        if (!lastReading.has(entityKey)) {
          lastReading.set(entityKey, +r.current_reading);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: false };
        }

        const rawDelta = +r.current_reading - lastReading.get(entityKey)!;
        const delta    = Math.max(0, rawDelta);
        lastReading.set(entityKey, +r.current_reading);
        return { r, delta, rawDelta, isMeterReplacement: false };
      });
    }

    // Helper: accumulate raw delta into a _raw field only when it's negative.
    // Keeps null when all readings are non-negative (tooltip shows normal value).
    const accumulateRaw = (row: any, field: string, rawDelta: number | null) => {
      if (rawDelta === null) return;
      if (rawDelta < 0) {
        row[field] = (row[field] ?? 0) + rawDelta;
      }
    };

    // ── Raw Water = sum of per-well (current − previous) deltas ────────────
    // Uses computeEntityDeltas keyed by well_id for correct per-well scoping.


    computeEntityDeltas(wellReadings ?? [], 'well_id', null).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.rawwater += delta;
      accumulateRaw(row, '_rawRawwater', rawDelta);
      if (isMeterReplacement) {
        const entityName = wellNames?.get(r.well_id) ?? r.well_id ?? 'Well';
        const label = `${entityName} Raw Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    // Production = sum of product meter (treated-water output) deltas.
    computeEntityDeltas(productReadings ?? [], 'meter_id', null).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.production += delta;
      accumulateRaw(row, '_rawProduction', rawDelta);
      if (isMeterReplacement) {
        const entityName = productMeterNames?.get(r.meter_id) ?? r.meter_id ?? 'Product Meter';
        const label = `${entityName} Product Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    // Consumption = sum of locator (distribution/endpoint) meter deltas.
    computeEntityDeltas(locReadings ?? [], 'locator_id', 'daily_volume').forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.consumption += delta;
      accumulateRaw(row, '_rawConsumption', rawDelta);
      if (isMeterReplacement) {
        const entityName = locatorNames?.get(r.locator_id) ?? r.locator_id ?? 'Locator';
        const label = `${entityName} Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    (roReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      if (r.recovery_pct != null) { row.recovery += +r.recovery_pct; row.recoverySamples += 1; }
      if (r.permeate_tds != null) { row.tds += +r.permeate_tds; row.tdsSamples += 1; }
    });

    // Power = sequential delta of meter_reading_kwh, exactly like locator.
    computeEntityDeltas(
      (powerReadings ?? []).map((r: any) => ({
        ...r,
        current_reading: r.meter_reading_kwh ?? r.daily_consumption_kwh ?? 0,
      })),
      'plant_id',
      'daily_consumption_kwh',
    ).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.kwh += delta;
      accumulateRaw(row, '_rawKwh', rawDelta);
      if (isMeterReplacement) {
        const entityName = plantNames?.get(r.plant_id) ?? r.plant_id ?? 'Plant';
        const label = `${entityName} Power Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    (costReadings ?? []).forEach((r: any) => {
      const dt = new Date(`${r.cost_date}T00:00:00`);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      const power = +(r.power_cost ?? 0);
      const chem = +(r.chem_cost ?? 0);
      row.powerCost += power;
      row.chemCost += chem;
      row.totalCost += r.total_cost != null ? +r.total_cost : power + chem;
      row.costProduction += +(r.production_m3 ?? 0);
    });

    return Array.from(byDay.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _s, recoverySamples, tdsSamples, costProduction, ...d }) => ({
        ...d,
        recovery: recoverySamples ? +(d.recovery / recoverySamples).toFixed(1) : null,
        tds: tdsSamples ? Math.round(d.tds / tdsSamples) : null,
        nrw: calc.nrw(d.production, d.consumption),
        unitCost: costProduction > 0 ? +(d.totalCost / costProduction).toFixed(2) : null,
        // _meterReplacements is already in ...d — preserved here for the tooltip
      }));
  }, [locReadings, wellReadings, productReadings, roReadings, powerReadings, costReadings,
      wellNames, locatorNames, productMeterNames, plantNames]);

  // ── Per-day negative-value index ────────────────────────────────────────
  // Built from the _raw* fields stored in chartData. Each entry lists only
  // the fields that are actually plotted for this metric and had a negative
  // raw delta on that date. The tooltip uses this to show the true value
  // (e.g. -900.3) even though the chart bar/line shows 0 (clamped).
  const negativeByDate = useMemo<Map<string, { label: string; rawValue: number; chartValue: number }[]>>(() => {
    const map = new Map<string, { label: string; rawValue: number; chartValue: number }[]>();

    // Mapping: metric → which _raw field to check, its display label, and the
    // corresponding plotted (clamped) field name.
    const checks: Record<string, Array<{ rawField: string; chartField: string; label: string }>> = {
      production:     [
        { rawField: '_rawProduction',  chartField: 'production',  label: 'Production (m³)' },
        { rawField: '_rawConsumption', chartField: 'consumption', label: 'Consumption (m³)' },
      ],
      nrw:            [
        { rawField: '_rawProduction',  chartField: 'production',  label: 'Production (m³)' },
        { rawField: '_rawConsumption', chartField: 'consumption', label: 'Consumption (m³)' },
        // nrw is derived — flag it when the computed value is negative
        { rawField: 'nrw',             chartField: 'nrw',         label: 'NRW %' },
      ],
      rawwater:       [{ rawField: '_rawRawwater', chartField: 'rawwater', label: 'Raw Water (m³)' }],
      pv:             [
        { rawField: '_rawProduction', chartField: 'production', label: 'Production (m³)' },
        { rawField: '_rawKwh',        chartField: 'kwh',        label: 'Power (kWh)' },
      ],
      // recovery, tds, productionCost values come straight from the DB —
      // no clamping — so rawField === chartField (negative = truly negative).
      recovery:       [{ rawField: 'recovery',  chartField: 'recovery',  label: 'Recovery (%)' }],
      tds:            [{ rawField: 'tds',        chartField: 'tds',       label: 'Permeate TDS (ppm)' }],
      productionCost: [
        { rawField: 'powerCost', chartField: 'powerCost', label: 'Power (₱)' },
        { rawField: 'chemCost',  chartField: 'chemCost',  label: 'Chemical (₱)' },
        { rawField: 'totalCost', chartField: 'totalCost', label: 'Total (₱)' },
      ],
    };

    const fields = checks[metric] ?? [];

    for (const row of chartData) {
      for (const { rawField, chartField, label } of fields) {
        const raw = row[rawField];
        // For _raw* fields: null means no negative delta → skip.
        // For direct fields (recovery, tds, costs, nrw): check if < 0.
        const isNegative = rawField.startsWith('_raw')
          ? raw !== null && raw < 0
          : raw != null && +raw < 0;

        if (!isNegative) continue;

        const entry = { label, rawValue: +raw, chartValue: +(row[chartField] ?? 0) };
        const existing = map.get(row.date);
        if (existing) existing.push(entry);
        else map.set(row.date, [entry]);
      }
    }

    return map;
  }, [chartData, metric]);

  // Custom tooltip — same look as Recharts default but:
  //  • Shows the true raw (unclamped) value for any field that was clamped to 0
  //  • When the zero was caused by a meter replacement, shows "🔧 [Name] was Replaced"
  //    instead of the generic "⚠️ Negative reading" warning
  //  • If both a replacement AND a genuine negative exist on the same day, shows both
  const NegativeAwareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const warnings = negativeByDate.get(label as string) ?? [];

    // Meter replacements for this date — from chartData row
    const chartRow = chartData.find((d) => d.date === label);
    const replacements: string[] = chartRow?._meterReplacements ?? [];

    // Build a quick lookup from dataKey → rawValue for affected fields
    const rawOverride = new Map(warnings.map((w) => {
      // Match label back to dataKey by finding the payload entry with the same name
      const entry = payload.find((p: any) => p.name === w.label);
      return [entry?.dataKey, w.rawValue];
    }));

    // Warnings that are NOT covered by a meter replacement (genuine negatives)
    // A warning is "covered" if the value is 0 on the chart (i.e. clamped) AND
    // there are replacements on this day — the zero was caused by the replacement.
    const genuineNegatives = replacements.length > 0
      ? warnings.filter((w) => {
          const entry = payload.find((p: any) => p.name === w.label);
          const chartVal = entry?.value ?? 0;
          // If the chart shows 0, the replacement explains it — not a genuine negative
          return chartVal !== 0;
        })
      : warnings;

    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8,
        fontSize: 11,
        padding: '8px 10px',
        minWidth: 148,
        maxWidth: 300,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}>
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
        {payload.map((entry: any) => {
          const override = rawOverride.get(entry.dataKey);
          // On replacement days the chart plots 0 (adjusted/offset value).
          // Show 0 — which IS the correct adjusted reading — not the raw negative.
          const displayValue = (override !== undefined && replacements.length === 0)
            ? override
            : entry.value;
          const isNegative = displayValue != null && displayValue < 0;
          return (
            <p key={entry.dataKey} style={{
              margin: '1px 0',
              color: entry.color ?? entry.stroke,
            }}>
              {entry.name}:{' '}
              <span style={isNegative ? { fontWeight: 600 } : undefined}>
                {displayValue != null ? displayValue.toLocaleString() : '—'}
              </span>
              {/* Only show "chart: 0" hint when value was clamped AND it's a genuine negative */}
              {override !== undefined && replacements.length === 0 && (
                <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 3 }}>(chart: 0)</span>
              )}
            </p>
          );
        })}

        {/* ── Meter replacement notice — replaces negative-reading warning ── */}
        {replacements.length > 0 && (
          <div style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: '1px solid hsl(var(--border))',
          }}>
            {replacements.map((name) => (
              <div key={name} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 5,
                color: '#92400e',
                marginBottom: 2,
              }}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>🔧</span>
                <span style={{ fontSize: 10, lineHeight: 1.4 }}>
                  <strong>{name} was Replaced</strong>
                  {' '}
                  <span style={{ opacity: 0.75 }}>(value adjusted to 0)</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Genuine negative readings (not explained by a replacement) ── */}
        {genuineNegatives.length > 0 && (
          <div style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 5,
            color: '#92400e',
          }}>
            <span style={{ fontSize: 12, lineHeight: 1 }}>⚠️</span>
            <span style={{ fontSize: 10, lineHeight: 1.4 }}>
              <strong>Negative reading:</strong>{' '}
              {genuineNegatives.map((w) => w.label).join(', ')}
            </span>
          </div>
        )}
      </div>
    );
  };

  const chartHeight = compact ? 'h-[200px]' : 'h-[340px]';

  // Format large numbers as 1.2K / 3.4M on the Y-axis so the axis
  // label doesn't eat into the chart area on narrow mobile screens.
  const formatYAxis = (value: number) => {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(value);
  };

  return (
    <>
      {/* Title, range buttons, and Data Summary tab on one compact row */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {title && (
          <span className="text-sm font-semibold mr-1 shrink-0">{title}</span>
        )}
        {/* Range pills — compact size */}
        <div className="flex flex-wrap items-center gap-0.5">
          {(['7D', '14D', '30D', '60D', '90D'] as RangeKey[]).map((r) => (
            <button key={r}
              onClick={() => setRange(r)}
              data-testid={`trend-range-${metric}-${r}`}
              className={[
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none',
                range === r
                  ? 'bg-teal-700 text-white'
                  : 'bg-muted text-muted-foreground hover:text-foreground border border-border',
              ].join(' ')}
            >{r}</button>
          ))}
          <button
            onClick={() => setRange('CUSTOM')}
            data-testid={`trend-range-${metric}-CUSTOM`}
            className={[
              'h-5 px-1.5 rounded text-[10px] font-medium transition-colors leading-none',
              range === 'CUSTOM'
                ? 'bg-teal-700 text-white'
                : 'bg-muted text-muted-foreground hover:text-foreground border border-border',
            ].join(' ')}
          >Custom</button>
          {range === 'CUSTOM' && (
            <div className="flex items-center gap-1 mt-1 w-full sm:w-auto sm:mt-0">
              <Input
                type="date"
                value={from}
                onChange={(e) => handleFromChange(e.target.value)}
                className="h-6 w-[110px] text-[10px] px-1.5"
                data-testid={`trend-from-${metric}`}
              />
              <span className="text-[10px] text-muted-foreground shrink-0">→</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => handleToChange(e.target.value)}
                className="h-6 w-[110px] text-[10px] px-1.5"
                data-testid={`trend-to-${metric}`}
              />
            </div>
          )}
          {isFetching && (
            <span className="text-[10px] text-muted-foreground ml-1">Loading…</span>
          )}
        </div>

        {/* Data Summary — opens a popup dialog (non-retractable) */}
        <button
          onClick={() => setShowSummary(true)}
          className="ml-auto h-5 px-2 rounded text-[10px] font-medium transition-colors leading-none shrink-0 border bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 border-border"
          title="Open data summary table"
        >
          Data Summary
        </button>
      </div>

      {/* ── Data Summary Popup Dialog ────────────────────────────────────── */}
      <Dialog open={showSummary} onOpenChange={(v) => { if (!v) setShowSummary(false); }}>
        <DialogContent className="max-w-[92vw] w-full max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden" data-testid={`dsm-popup-${metric}`}>
          <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              Data Summary — {title ?? metric}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Tabular data summary for the {title ?? metric} chart over the selected range.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No data in selected range.</div>
            ) : (
          <div className="overflow-x-auto overflow-y-auto h-full">
            <table className="w-full text-[10px] border-collapse">
              <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-border sticky left-0 bg-muted/90">
                    Date
                  </th>
                  {(metric === 'production' || metric === 'nrw') && (
                    <>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Production (m³)</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Consumption (m³)</th>
                    </>
                  )}
                  {metric === 'nrw' && (
                    <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">NRW (%)</th>
                  )}
                  {metric === 'rawwater' && (
                    <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Raw Water (m³)</th>
                  )}
                  {metric === 'recovery' && (
                    <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Recovery (%)</th>
                  )}
                  {metric === 'tds' && (
                    <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Permeate TDS (ppm)</th>
                  )}
                  {metric === 'pv' && (
                    <>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Production (m³)</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Power (kWh)</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">PV Ratio</th>
                    </>
                  )}
                  {metric === 'productionCost' && (
                    <>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Power (₱)</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Chemical (₱)</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">Total (₱)</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border">₱/m³</th>
                    </>
                  )}
                </tr>
                {/* Totals / averages row */}
                <tr className="bg-teal-50/60 dark:bg-teal-950/20">
                  <td className="px-2 py-1 font-semibold text-teal-700 dark:text-teal-300 whitespace-nowrap sticky left-0 bg-teal-50/60 dark:bg-teal-950/20">
                    TOTAL / AVG
                  </td>
                  {(metric === 'production' || metric === 'nrw') && (
                    <>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        {chartData.reduce((s, d) => s + (d.production ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        {chartData.reduce((s, d) => s + (d.consumption ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </td>
                    </>
                  )}
                  {metric === 'nrw' && (
                    <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                      {(() => {
                        const vals = chartData.filter(d => d.nrw != null);
                        return vals.length ? (vals.reduce((s, d) => s + d.nrw, 0) / vals.length).toFixed(1) + '%' : '—';
                      })()}
                    </td>
                  )}
                  {metric === 'rawwater' && (
                    <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                      {chartData.reduce((s, d) => s + (d.rawwater ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                  )}
                  {metric === 'recovery' && (
                    <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                      {(() => {
                        const vals = chartData.filter(d => d.recovery != null);
                        return vals.length ? (vals.reduce((s, d) => s + d.recovery, 0) / vals.length).toFixed(1) + '%' : '—';
                      })()}
                    </td>
                  )}
                  {metric === 'tds' && (
                    <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                      {(() => {
                        const vals = chartData.filter(d => d.tds != null);
                        return vals.length ? Math.round(vals.reduce((s, d) => s + d.tds, 0) / vals.length) + ' ppm' : '—';
                      })()}
                    </td>
                  )}
                  {metric === 'pv' && (
                    <>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        {chartData.reduce((s, d) => s + (d.production ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        {chartData.reduce((s, d) => s + (d.kwh ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        {(() => {
                          const totP = chartData.reduce((s, d) => s + (d.production ?? 0), 0);
                          const totK = chartData.reduce((s, d) => s + (d.kwh ?? 0), 0);
                          return totP > 0 ? (totK / totP).toFixed(2) : '—';
                        })()}
                      </td>
                    </>
                  )}
                  {metric === 'productionCost' && (
                    <>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        ₱{chartData.reduce((s, d) => s + (d.powerCost ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        ₱{chartData.reduce((s, d) => s + (d.chemCost ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        ₱{chartData.reduce((s, d) => s + (d.totalCost ?? 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold font-mono-num text-teal-700 dark:text-teal-300">
                        {(() => {
                          const vals = chartData.filter(d => d.unitCost != null);
                          return vals.length ? '₱' + (vals.reduce((s, d) => s + d.unitCost, 0) / vals.length).toFixed(2) : '—';
                        })()}
                      </td>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {[...chartData].reverse().map((d, i) => (
                  <tr key={d.date} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                    <td className={[
                      'px-2 py-1 whitespace-nowrap font-medium text-muted-foreground sticky left-0',
                      i % 2 === 0 ? 'bg-background' : 'bg-muted/20',
                    ].join(' ')}>
                      {d.date}
                    </td>
                    {(metric === 'production' || metric === 'nrw') && (
                      <>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.production != null ? d.production.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.consumption != null ? d.consumption.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                        </td>
                      </>
                    )}
                    {metric === 'nrw' && (
                      <td className={['px-2 py-1 text-right font-mono-num tabular-nums font-medium',
                        d.nrw != null && d.nrw > 20 ? 'text-rose-600 dark:text-rose-400' : '',
                      ].join(' ')}>
                        {d.nrw != null ? d.nrw + '%' : '—'}
                      </td>
                    )}
                    {metric === 'rawwater' && (
                      <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                        {d.rawwater != null ? d.rawwater.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                      </td>
                    )}
                    {metric === 'recovery' && (
                      <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                        {d.recovery != null ? d.recovery + '%' : '—'}
                      </td>
                    )}
                    {metric === 'tds' && (
                      <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                        {d.tds != null ? d.tds + ' ppm' : '—'}
                      </td>
                    )}
                    {metric === 'pv' && (
                      <>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.production != null ? d.production.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.kwh != null ? d.kwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.production > 0 ? (d.kwh / d.production).toFixed(2) : '—'}
                        </td>
                      </>
                    )}
                    {metric === 'productionCost' && (
                      <>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.powerCost != null ? '₱' + d.powerCost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.chemCost != null ? '₱' + d.chemCost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.totalCost != null ? '₱' + d.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right font-mono-num tabular-nums">
                          {d.unitCost != null ? '₱' + d.unitCost : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className={`${chartHeight} w-full relative`} data-testid={`trend-chart-${metric}`}>
        {queryError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-rose-300 bg-rose-50/95 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/80 dark:border-rose-900 dark:text-rose-300 shadow-sm pointer-events-auto max-w-md text-center">
              <div className="font-semibold mb-0.5">Couldn't load trend data</div>
              <div className="text-[11px] opacity-80">{queryError.message}</div>
            </div>
          </div>
        )}
        {!queryError && !isFetching && chartData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="rounded-md border border-border/60 bg-card/80 backdrop-blur-sm px-3 py-2 text-xs text-muted-foreground text-center pointer-events-auto max-w-md shadow-sm">
              <div className="font-medium text-foreground">No data in selected range</div>
              <div className="text-[11px] mt-0.5">
                Try a wider range, switch plant, or log readings for {metric === 'nrw' ? 'wells & locators' : metric === 'pv' ? 'wells & power' : metric === 'tds' || metric === 'recovery' ? 'RO trains' : metric === 'productionCost' ? 'power + chemicals (production_costs rollup)' : 'wells'}.
              </div>
            </div>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          {metric === 'nrw' ? (
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis yAxisId="vol" tick={{ fontSize: 10 }} stroke="hsl(var(--chart-1))" tickFormatter={formatYAxis} width={36} label={{ value: 'm³', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--warn))" width={28} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="vol" dataKey="production" fill="hsl(var(--chart-1))" name="Production (m³)" />
              <Bar yAxisId="vol" dataKey="consumption" fill="hsl(var(--chart-2))" name="Consumption (m³)" />
              <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke="hsl(var(--warn))" strokeWidth={2.5} dot={{ r: 3 }} name="NRW %" />
            </ComposedChart>
          ) : metric === 'productionCost' ? (
            // Two-axis composed chart: absolute ₱ amounts on the left,
            // ₱/m³ unit cost on the right. Unit cost lives in a different
            // magnitude bucket (single-digit ₱/m³ vs thousands of ₱) so
            // sharing one axis would either flatten the unit-cost line or
            // crush the totals. Dashed stroke flags it as a derived ratio.
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis yAxisId="amt" tick={{ fontSize: 10 }} stroke="hsl(var(--accent))" tickFormatter={formatYAxis} width={36} label={{ value: '₱', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <YAxis yAxisId="unit" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--warn))" width={28} tickFormatter={(v) => `₱${v}`} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="amt" type="monotone" dataKey="totalCost" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 2 }} name="Total (₱)" />
              <Line yAxisId="amt" type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (₱)" />
              <Line yAxisId="amt" type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2} dot={false} name="Chemical (₱)" />
              <Line yAxisId="unit" type="monotone" dataKey="unitCost" stroke="hsl(var(--warn))" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} name="₱/m³" connectNulls />
            </ComposedChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={36} label={{ value: TREND_Y_LABEL[metric] ?? '', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
              <Tooltip content={<NegativeAwareTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {metric === 'production' && (<>
                <Line type="monotone" dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Production (m³)" />
                <Line type="monotone" dataKey="consumption" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} name="Consumption (m³)" />
              </>)}
              {metric === 'rawwater' && (
                <Line type="monotone" dataKey="rawwater" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Raw Water (m³)" />
              )}
              {metric === 'recovery' && (
                <Line type="monotone" dataKey="recovery" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={{ r: 2 }} name="Recovery (%)" />
              )}
              {metric === 'tds' && (
                <Line type="monotone" dataKey="tds" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="Permeate TDS (ppm)" />
              )}
              {metric === 'pv' && (<>
                <Line type="monotone" dataKey="production" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Production (m³)" />
                <Line type="monotone" dataKey="kwh" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (kWh)" />
              </>)}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </>
  );
}
