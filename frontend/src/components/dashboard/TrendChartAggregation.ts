// TrendChartAggregation.ts
// Shared week/month bucketing for the Daily / Weekly / Monthly granularity
// control on TrendChart.tsx. Two entry points, one per data shape:
//
//   • rollupTotalRows  — rolls up chartData's daily "Total" rows (production,
//     consumption, rawwater, kwh, solarKwh, recovery, tds, cost, nrw) into
//     weekly or monthly buckets. Feeds the same AreaChart/ComposedChart
//     branches that already render chartData at Daily — see totalChartData
//     in TrendChart.tsx.
//
//   • rollupEntityRows — rolls up an entity-breakdown pivot (production/nrw
//     by-locator or by-source) into weekly or monthly buckets. Replaces the
//     old hardcoded month-only `buildMonthRows` closure that used to live
//     inline in drillupData — weekly falls out of this for free, and it's
//     the same grouping shape either granularity, just a different bucket
//     key function.
//
// Aggregation rule: volumes (m³, kWh) SUM across the bucket — that's just
// "how much happened this week/month". Rates (%, ppm, ₱/m³) AVERAGE the
// daily values that exist, unweighted, for now — see the note on
// AVG_FIELDS below. NRW is a special case: it's recomputed from the
// bucket's *summed* production/consumption rather than averaged, because
// averaging a percentage across days with very different volumes gives a
// different (and less correct) number than the ratio of the summed
// volumes — e.g. one huge production day and six near-zero days should
// weight the huge day's NRW% heavily, not treat all seven days equally.
//
// Entity-pivot values (rollupEntityRows) are always volumes, so they
// always sum — there's no rate case on that path.

import { format, startOfISOWeek, getDaysInMonth } from 'date-fns';
import { calc } from '@/lib/calculations';

export type Granularity = 'daily' | 'weekly' | 'monthly';

/** Sortable bucket key for a given calendar day (yyyy-MM-dd) + granularity. */
export function bucketKeyForGranularity(dateKey: string, granularity: Granularity): string {
  if (granularity === 'daily') return dateKey;
  const d = new Date(dateKey + 'T00:00:00');
  if (granularity === 'weekly') return format(startOfISOWeek(d), 'yyyy-MM-dd');
  return dateKey.slice(0, 7) + '-01'; // monthly — matches the old drillupData convention
}

/** Display label for a bucket key. Daily/weekly share "MMM d" (weekly = week-start date); monthly is "MMM yyyy". */
export function formatBucketLabel(bucketKey: string, granularity: Granularity): string {
  const d = new Date(bucketKey + 'T00:00:00');
  return granularity === 'monthly' ? format(d, 'MMM yyyy') : format(d, 'MMM d');
}

/** Full calendar-day length of the bucket a key belongs to — used to flag range-edge partial buckets. */
function fullBucketDays(bucketKey: string, granularity: Granularity): number {
  if (granularity === 'weekly') return 7;
  if (granularity === 'monthly') return getDaysInMonth(new Date(bucketKey + 'T00:00:00'));
  return 1;
}

// Volumes: sum. NRW is handled separately (recomputed from summed production/consumption).
const SUM_FIELDS = ['production', 'consumption', 'rawwater', 'kwh', 'solarKwh'] as const;
// Rates: unweighted daily average for now. Simple and honest, but not
// volume-weighted — a maintenance day with near-zero production still
// counts equally toward the bucket's average TDS/recovery/₱-per-m³ as a
// full-output day. Worth revisiting as volume-weighted if that turns out
// to skew weekly/monthly cost or quality numbers in practice.
const AVG_FIELDS = ['recovery', 'tds', 'powerCost', 'chemCost', 'totalCost'] as const;
const AVG_DECIMALS: Record<string, number> = { recovery: 1, tds: 0, powerCost: 4, chemCost: 4, totalCost: 4 };

/**
 * Rolls up chartData's daily rows into weekly or monthly buckets.
 * No-op passthrough for granularity === 'daily'.
 */
export function rollupTotalRows(dailyRows: any[], granularity: Granularity): any[] {
  if (granularity === 'daily' || dailyRows.length === 0) return dailyRows;

  const buckets = new Map<string, any[]>();
  dailyRows.forEach((row) => {
    const dateKey = format(new Date(row.isoDate), 'yyyy-MM-dd');
    const bucketKey = bucketKeyForGranularity(dateKey, granularity);
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey)!.push(row);
  });

  return Array.from(buckets.keys()).sort().map((bucketKey) => {
    const rows = buckets.get(bucketKey)!;
    const out: Record<string, any> = {
      date: formatBucketLabel(bucketKey, granularity),
      isoDate: new Date(bucketKey + 'T00:00:00').toISOString(),
      _isPartial: rows.length < fullBucketDays(bucketKey, granularity),
      _bucketDays: rows.length,
      // Union (deduped) rather than "last row wins" — a replacement or a
      // permeate-sourced day anywhere in the bucket should still surface.
      _meterReplacements: Array.from(new Set(rows.flatMap((r) => r._meterReplacements ?? []))),
      _permeateSourceNames: Array.from(new Set(rows.flatMap((r) => r._permeateSourceNames ?? []))),
    };

    SUM_FIELDS.forEach((f) => {
      const vals = rows.map((r) => r[f]).filter((v: any) => v != null) as number[];
      out[f] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    });
    AVG_FIELDS.forEach((f) => {
      const vals = rows.map((r) => r[f]).filter((v: any) => v != null) as number[];
      out[f] = vals.length
        ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(AVG_DECIMALS[f])
        : null;
    });
    out.nrw = (out.production != null && out.consumption != null)
      ? calc.nrw(out.production, out.consumption)
      : null;

    return out;
  });
}

/**
 * Rolls up an entity-breakdown pivot into weekly or monthly buckets.
 * `dateKeys` need not cover every calendar day — buckets are keyed off
 * whatever days are actually present, same as the old month-only version
 * this replaces. _isPartial is therefore a heuristic (fewer reading-days
 * present than the bucket's full length), which can also fire for a
 * genuine mid-range data gap, not just a range-edge truncation — same
 * characteristic the old monthly grouping had, just now shared with weekly.
 */
export function rollupEntityRows(
  pivot: Map<string, Map<string, number>>,
  dateKeys: string[],
  entityIds: string[],
  granularity: 'weekly' | 'monthly',
): any[] {
  const byBucket = new Map<string, Map<string, number>>();
  const daysPerBucket = new Map<string, number>();
  dateKeys.forEach((dk) => {
    const bucketKey = bucketKeyForGranularity(dk, granularity);
    if (!byBucket.has(bucketKey)) byBucket.set(bucketKey, new Map());
    daysPerBucket.set(bucketKey, (daysPerBucket.get(bucketKey) ?? 0) + 1);
    entityIds.forEach((id) => {
      const v = pivot.get(dk)?.get(id) ?? 0;
      byBucket.get(bucketKey)!.set(id, (byBucket.get(bucketKey)!.get(id) ?? 0) + v);
    });
  });

  return Array.from(byBucket.keys()).sort().map((bucketKey) => {
    const row: any = {
      date: formatBucketLabel(bucketKey, granularity),
      isoDate: bucketKey,
      _isPartial: (daysPerBucket.get(bucketKey) ?? 0) < fullBucketDays(bucketKey, granularity),
    };
    entityIds.forEach((id) => { row[id] = byBucket.get(bucketKey)!.get(id) ?? null; });
    row._total = entityIds.reduce((s, id) => s + (byBucket.get(bucketKey)!.get(id) ?? 0), 0);
    return row;
  });
}
