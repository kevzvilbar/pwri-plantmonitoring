// ─── Shared trend-bucketing engine ──────────────────────────────────────────
// Foundation piece from the Weekly-granularity improvement plan. Before this
// file existed, TrendChart.tsx had THREE separate useMemo blocks doing
// overlapping pivot/fill/group work:
//   • chartData     — daily rows, one per metric, via a hand-rolled byDay Map
//   • drilldownData — daily rows, one per entity (locator/source), via
//                     buildEntityPivot + fillDateRange
//   • drillupData   — MONTHLY rows, one per entity, via a bespoke
//                     buildMonthRows() closure that re-bucketed the same
//                     per-entity pivot by `dateKey.slice(0, 7)`
//
// That third block is why Weekly didn't exist: adding a third granularity
// meant either writing a FOURTH copy-pasted bucketing block, or (worse)
// teaching drillupData's ad-hoc month-slicing about ISO weeks too.
//
// This module is that shared bucketing layer, written once:
//   • getBucketKey()      — the one place "which week/month does this day
//                            belong to" is decided (ISO Monday-start weeks).
//   • buildTrendRows()     — buckets an array of already-computed DAILY
//                            metric rows (chartData's output) into
//                            daily/weekly/monthly rows.
//   • buildEntityPivotRows() — buckets a dateKey→entityId→value pivot (what
//                            buildEntityPivot in TrendChartPivotShared.tsx
//                            already produces) into daily/weekly/monthly
//                            per-entity rows. This one function now backs
//                            both the old drilldownData (daily) and
//                            drillupData (monthly), plus the new weekly case.
//   • isGranularityUsable() — auto-disables a granularity button when the
//                            active date range is too short for it to show
//                            more than a sliver of a bucket.
//
// ── Why buildTrendRows() takes already-computed daily rows, not raw
//    Supabase readings ────────────────────────────────────────────────────
// The improvement-plan brief sketched this as `buildTrendRows(readings, …)`.
// In practice, "readings" by the time they're chart-ready have already been
// through TrendChart.tsx's computeEntityDeltas() — meter-replacement
// handling, direct-mode locators, CT multipliers, tariff lookups, permeate
// production sourcing, etc. That logic has a real bug-fix history (see the
// comments in TrendChart.tsx's chartData memo: the -4,853,089 bug, the
// -898K consumption spike). Re-deriving it generically here would risk
// silently reintroducing one of those bugs. So this module buckets the
// DAILY OUTPUT of that pipeline (chartData's rows) rather than raw DB rows
// — it owns 100% of the "how do N days become one week/month row" logic,
// while chartData keeps 100% of the "what is Tuesday's number" logic. Weekly
// becomes "free" for every metric that already flows through chartData
// (production, nrw, rawwater, productionCost, pv, kwh) with zero changes to
// that fragile per-day computation.

// ── Aggregation type per field ───────────────────────────────────────────
// This is the single highest-risk item in the whole plan (see brief): get
// this wrong and every weekly/monthly cost or TDS number is quietly
// incorrect. Three kinds of fields exist on a trend row:
//   'sum'          — volumes. m³, kWh. Daily → weekly → monthly by adding.
//   'avg'          — a rate with no natural weight available. Simple mean
//                    of the non-null daily values in the bucket.
//   weighted-avg   — a rate that DOES have a natural weight (e.g. ₱/m³ cost
//                    weighted by that day's m³, or an average TDS reading
//                    weighted by that day's sample count). This is what the
//                    brief means by "average, ideally weighted by volume
//                    where that's meaningful": summing the day's raw ₱ and
//                    dividing by the day's raw m³ gives the same answer as
//                    weighting each day's already-computed ₱/m³ rate by
//                    that day's m³ — so callers pass a `weight` field name
//                    instead of needing to re-plumb raw numerators through.
//   'union'        — string[] fields (meter-replacement labels, permeate
//                    source names). Merged and de-duplicated across the
//                    bucket so a mid-week replacement still surfaces.
export type FieldAgg =
  | 'sum'
  | 'avg'
  | 'union'
  | { type: 'weighted-avg'; weight: string };

export type TrendFieldConfig = Record<string, FieldAgg>;

export type Granularity = 'daily' | 'weekly' | 'monthly';

export interface DailyTrendRow {
  /** Display label, e.g. "Aug 6" — only meaningful at daily granularity. */
  date: string;
  /** Full ISO datetime for the day this row represents. Authoritative for bucketing. */
  isoDate: string;
  [field: string]: unknown;
}

export interface BucketedTrendRow {
  /** Display label appropriate for the requested granularity. */
  date: string;
  /** ISO date of the bucket's start (Monday for weekly, 1st for monthly). */
  isoDate: string;
  /**
   * True when this bucket's calendar span extends outside the fetched date
   * range — e.g. a 30D window rarely lines up on a week/month boundary, so
   * the first/last bucket may only contain 2 of 7 days. Rendered with a
   * lighter fill / dashed edge rather than aggregated as if complete, so
   * operators don't mistake a partial week for a low-volume week.
   */
  _partial: boolean;
  /** Number of daily rows actually rolled into this bucket. */
  _dayCount: number;
  [field: string]: unknown;
}

const DAY_MS = 86_400_000;

function toLocalMidnight(iso: string): Date {
  // chartData rows carry isoDate as a full ISO instant (see the `sortKey`/
  // `isoDate: new Date(sortKey).toISOString()` construction in TrendChart's
  // chartData memo). We only need the calendar date, so re-derive from the
  // LOCAL calendar fields already baked into that instant rather than
  // re-parsing at UTC — this mirrors how the rest of TrendChart formats
  // dates (`format(new Date(r.reading_datetime), 'MMM d')` uses the local
  // timezone throughout).
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Monday of the ISO week containing `d` (local calendar). Exported so
 * one-off callers with their own bucketing loop (e.g. Plant Health's
 * buildPhHealthRows, which pivots ro_train_readings directly rather than
 * going through buildTrendRows) can bucket by week using the exact same
 * Monday-start rule as everywhere else on the dashboard.
 */
export function getIsoWeekStart(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = date.getDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (dow === 0 ? -6 : 1) - dow; // days to walk back to Monday
  date.setDate(date.getDate() + diff);
  return date;
}

function isoWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  return end;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function shortMonthDay(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function monthYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Resolves the bucket a given local-midnight date belongs to for the
 * requested granularity. Returns the bucket's own start/end (for partial
 * detection) plus a stable sort/group key and a display label.
 */
function resolveBucket(localDate: Date, granularity: Granularity): {
  key: string; label: string; start: Date; end: Date;
} {
  if (granularity === 'monthly') {
    const start = monthStart(localDate);
    const end = monthEnd(localDate);
    return { key: fmtISODate(start).slice(0, 7), label: monthYear(start), start, end };
  }
  if (granularity === 'weekly') {
    const start = getIsoWeekStart(localDate);
    const end = isoWeekEnd(start);
    return { key: fmtISODate(start), label: `Wk of ${shortMonthDay(start)}`, start, end };
  }
  // daily
  return {
    key: fmtISODate(localDate),
    label: shortMonthDay(localDate),
    start: localDate,
    end: localDate,
  };
}

/**
 * Daily → weekly is pointless on a 7-day range (at most one partial bucket)
 * and daily → monthly needs roughly two months of history before it shows
 * more than 1-2 bars. These thresholds gate the granularity buttons so the
 * control never hands back a chart with a single bar in it. Tuned to the
 * dashboard's existing range presets (7D/14D/30D/60D/90D/CUSTOM).
 */
const MIN_DAYS_FOR_WEEKLY = 10;
const MIN_DAYS_FOR_MONTHLY = 45;

export function isGranularityUsable(granularity: Granularity, rangeDays: number): boolean {
  if (granularity === 'daily') return true;
  if (granularity === 'weekly') return rangeDays >= MIN_DAYS_FOR_WEEKLY;
  return rangeDays >= MIN_DAYS_FOR_MONTHLY;
}

/** Inclusive day count between two yyyy-MM-dd keys. */
export function rangeDaysBetween(startKey: string, endKey: string): number {
  const s = new Date(`${startKey}T00:00:00`);
  const e = new Date(`${endKey}T00:00:00`);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / DAY_MS) + 1);
}

function isArrayField(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/**
 * Buckets an array of daily trend rows (chartData's shape) into
 * daily/weekly/monthly rows per `fields`. Any field not present in `fields`
 * is dropped from the output — callers re-derive display-only or
 * cross-field values (e.g. NRW% from summed production/consumption) after
 * calling this, since those aren't independently aggregatable.
 */
export function buildTrendRows(
  dailyRows: DailyTrendRow[],
  opts: {
    granularity: Granularity;
    fields: TrendFieldConfig;
    /** yyyy-MM-dd bounds of the fetched range, used for partial-bucket flagging. */
    rangeStartKey?: string;
    rangeEndKey?: string;
  },
): BucketedTrendRow[] {
  const { granularity, fields } = opts;

  if (granularity === 'daily') {
    // Daily is a passthrough — still normalized to the BucketedTrendRow
    // shape so every downstream consumer (chart + tooltip) can treat all
    // three granularities identically.
    return dailyRows.map((r) => ({
      ...r,
      date: r.date,
      isoDate: r.isoDate,
      _partial: false,
      _dayCount: 1,
    }));
  }

  type Bucket = {
    key: string; label: string; start: Date; end: Date;
    sums: Record<string, number>; counts: Record<string, number>;
    weightedSums: Record<string, number>; weightTotals: Record<string, number>;
    unions: Record<string, Set<string>>;
    dayCount: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const row of dailyRows) {
    const local = toLocalMidnight(row.isoDate);
    const { key, label, start, end } = resolveBucket(local, granularity);
    let b = buckets.get(key);
    if (!b) {
      b = {
        key, label, start, end,
        sums: {}, counts: {}, weightedSums: {}, weightTotals: {}, unions: {}, dayCount: 0,
      };
      buckets.set(key, b);
    }
    b.dayCount += 1;

    for (const [field, agg] of Object.entries(fields)) {
      const raw = row[field];
      if (typeof agg === 'object' && agg.type === 'weighted-avg') {
        const val = raw as number | null | undefined;
        const weight = (row[agg.weight] as number | null | undefined) ?? 0;
        if (val != null && Number.isFinite(val) && weight > 0) {
          b.weightedSums[field] = (b.weightedSums[field] ?? 0) + val * weight;
          b.weightTotals[field] = (b.weightTotals[field] ?? 0) + weight;
        }
        continue;
      }
      if (agg === 'union') {
        if (isArrayField(raw)) {
          if (!b.unions[field]) b.unions[field] = new Set();
          raw.forEach((v) => b.unions[field].add(String(v)));
        }
        continue;
      }
      // sum / avg — both accumulate the same way; avg divides by counts[field] at the end.
      const val = raw as number | null | undefined;
      if (val != null && Number.isFinite(val)) {
        b.sums[field] = (b.sums[field] ?? 0) + val;
        b.counts[field] = (b.counts[field] ?? 0) + 1;
      }
    }
  }

  const rangeStart = opts.rangeStartKey ? new Date(`${opts.rangeStartKey}T00:00:00`) : null;
  const rangeEnd = opts.rangeEndKey ? new Date(`${opts.rangeEndKey}T00:00:00`) : null;

  return Array.from(buckets.values())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((b) => {
      const out: BucketedTrendRow = {
        date: b.label,
        isoDate: fmtISODate(b.start),
        _partial: !!(
          (rangeStart && b.start.getTime() < rangeStart.getTime())
          || (rangeEnd && b.end.getTime() > rangeEnd.getTime())
        ),
        _dayCount: b.dayCount,
      };
      for (const [field, agg] of Object.entries(fields)) {
        if (typeof agg === 'object' && agg.type === 'weighted-avg') {
          const total = b.weightTotals[field];
          out[field] = total ? +(b.weightedSums[field] / total).toFixed(4) : null;
        } else if (agg === 'union') {
          out[field] = b.unions[field] ? Array.from(b.unions[field]) : [];
        } else if (agg === 'avg') {
          out[field] = b.counts[field] ? +(b.sums[field] / b.counts[field]).toFixed(2) : null;
        } else {
          // sum
          out[field] = b.counts[field] ? +b.sums[field].toFixed(4) : null;
        }
      }
      return out;
    });
}

// ─── Entity-pivot bucketing (replaces drilldownData + drillupData) ─────────

export interface DrillEntity { id: string; label: string; color: string }

export interface BucketedEntityRow {
  date: string;
  isoDate: string;
  _total: number;
  _partial: boolean;
  [entityId: string]: unknown;
}

/**
 * Buckets a dateKey(yyyy-MM-dd) → entityId → value pivot (as produced by
 * buildEntityPivot in TrendChartPivotShared.tsx) into daily/weekly/monthly
 * rows, one column per visible entity plus a `_total`. This single function
 * is what used to be drilldownData (daily-only, rendered as lines) and
 * drillupData (monthly-only, rendered as bars) — see TrendChart.tsx for how
 * the two call sites collapsed into one `entityRows` memo.
 *
 * `mode` controls how a bucket combines several days for one entity:
 *   'sum'          (default) — volumes: a locator's weekly total = the sum
 *                    of its daily values (production/consumption breakdown).
 *   'weighted-avg' — rates: e.g. RO by-train TDS/Recovery, where each day's
 *                    value is ALREADY a per-train average, not a volume.
 *                    Summing those would be meaningless; this instead takes
 *                    Σ(value×weight)/Σ(weight) using `weightPivot` (typically
 *                    that day's sample count for that entity), falling back
 *                    to an unweighted mean when no weightPivot is given.
 *                    `_total` becomes the same weighted average across ALL
 *                    entities combined — a fleet-wide figure for free.
 */
export function buildEntityPivotRows(
  pivot: Map<string, Map<string, number>>,
  dateKeys: string[],
  entities: DrillEntity[],
  granularity: Granularity,
  rangeStartKey?: string,
  rangeEndKey?: string,
  opts?: {
    mode?: 'sum' | 'weighted-avg';
    weightPivot?: Map<string, Map<string, number>>;
  },
): BucketedEntityRow[] {
  if (dateKeys.length === 0) return [];
  const sortedKeys = [...dateKeys].sort();
  const mode = opts?.mode ?? 'sum';
  const weightPivot = opts?.weightPivot;

  if (granularity === 'daily') {
    // Fill every calendar day in range (not just days with data) so the
    // line/bar doesn't jump across gaps — same behavior drilldownData had.
    const out: BucketedEntityRow[] = [];
    const cur = new Date(`${sortedKeys[0]}T00:00:00`);
    const end = new Date(`${sortedKeys[sortedKeys.length - 1]}T00:00:00`);
    while (cur <= end) {
      const dk = fmtISODate(cur);
      const row: BucketedEntityRow = {
        date: shortMonthDay(cur), isoDate: dk, _total: 0, _partial: false,
      };
      let total = 0;
      let n = 0;
      entities.forEach(({ id }) => {
        const v = pivot.get(dk)?.get(id) ?? null;
        row[id] = v;
        if (v != null) { total += v; n += 1; }
      });
      row._total = mode === 'weighted-avg' ? (n ? +(total / n).toFixed(2) : 0) : total;
      out.push(row);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  type Bucket = {
    key: string; label: string; start: Date; end: Date;
    values: Map<string, number>; // mode='sum': running sum. mode='weighted-avg': running Σ(value×weight)
    weights: Map<string, number>; // mode='weighted-avg' only: running Σ(weight) per entity
    dayCount: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const dk of sortedKeys) {
    const local = new Date(`${dk}T00:00:00`);
    const { key, label, start, end } = resolveBucket(local, granularity);
    let b = buckets.get(key);
    if (!b) { b = { key, label, start, end, values: new Map(), weights: new Map(), dayCount: 0 }; buckets.set(key, b); }
    b.dayCount += 1;
    entities.forEach(({ id }) => {
      const v = pivot.get(dk)?.get(id);
      if (v == null) return;
      if (mode === 'weighted-avg') {
        const w = weightPivot?.get(dk)?.get(id) ?? 1;
        if (w <= 0) return;
        b.values.set(id, (b.values.get(id) ?? 0) + v * w);
        b.weights.set(id, (b.weights.get(id) ?? 0) + w);
      } else {
        b.values.set(id, (b.values.get(id) ?? 0) + v);
      }
    });
  }

  const rangeStart = rangeStartKey ? new Date(`${rangeStartKey}T00:00:00`) : null;
  const rangeEnd = rangeEndKey ? new Date(`${rangeEndKey}T00:00:00`) : null;

  return Array.from(buckets.values())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((b) => {
      const row: BucketedEntityRow = {
        date: b.label,
        isoDate: fmtISODate(b.start),
        _total: 0,
        _partial: !!(
          (rangeStart && b.start.getTime() < rangeStart.getTime())
          || (rangeEnd && b.end.getTime() > rangeEnd.getTime())
        ),
      };
      if (mode === 'weighted-avg') {
        let totalWeightedSum = 0;
        let totalWeight = 0;
        entities.forEach(({ id }) => {
          const w = b.weights.get(id) ?? 0;
          const v = w ? +((b.values.get(id) ?? 0) / w).toFixed(2) : null;
          row[id] = v;
          if (v != null) { totalWeightedSum += (b.values.get(id) ?? 0); totalWeight += w; }
        });
        row._total = totalWeight ? +(totalWeightedSum / totalWeight).toFixed(2) : 0;
        return row;
      }
      let total = 0;
      entities.forEach(({ id }) => {
        const v = b.values.get(id) ?? null;
        row[id] = v;
        if (v != null) total += v;
      });
      row._total = total;
      return row;
    });
}
