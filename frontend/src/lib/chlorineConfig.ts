/**
 * lib/chlorineConfig.ts — Free Chlorine Residual constants, gap detection,
 * and compliance classification rules (PNSDW standards).
 *
 * Requirements:
 * - Compliance Band: 0.3 mg/L (Min) to 1.5 mg/L (Max)
 * - Suspect Outliers: > 3.0 mg/L (2x upper limit) flagged for review and excluded from stats
 * - Missing Data Gaps:
 *     - Operator Dashboard: > 2 hours (120 minutes)
 *     - Management Summary: > 4 hours (240 minutes)
 */

export interface ChlorineConfig {
  unit: string;
  min_limit: number;
  max_limit: number;
  suspect_threshold: number;
  gap_threshold_minutes: {
    operator: number;
    management: number;
  };
}

export const CHLORINE_CONFIG: ChlorineConfig = {
  unit: 'mg/L',
  min_limit: 0.3,
  max_limit: 1.5,
  suspect_threshold: 3.0,
  gap_threshold_minutes: {
    operator: 120, // 2 hours
    management: 240, // 4 hours
  },
};

/**
 * A reading at or below this value means "effectively no residual" (dosing failure,
 * or a placeholder entry). It is still a real, compliance-relevant reading and stays
 * in the stats, but the UI flags it as critical and shows averages with and without it.
 */
export const NO_RESIDUAL_MG_L = 0.05;

export type ChlorineReadingStatus = 'in_range' | 'below_min' | 'above_max' | 'suspect' | 'missing';

export interface RawChlorinePoint {
  id?: string;
  train_id: string;
  train_name?: string;
  reading_datetime: string;
  chlorine_residual_mg_l: number | null;
  verified?: boolean;
}

export interface ClassifiedChlorinePoint extends RawChlorinePoint {
  status: ChlorineReadingStatus;
  isSuspect: boolean;
  isExcludedFromStats: boolean;
}

export interface ChlorineGap {
  train_id: string;
  train_name: string;
  start_iso: string;
  end_iso: string;
  start_ts: number;
  end_ts: number;
  duration_minutes: number;
  duration_hours: number;
}

export interface ChlorineStats {
  totalCount: number;
  validCount: number;
  inRangeCount: number;
  belowMinCount: number;
  aboveMaxCount: number;
  suspectCount: number;
  compliancePct: number | null;
  avgResidual: number | null;
  minValid: number | null;
  maxValid: number | null;
}

/**
 * Classifies a single chlorine residual reading against PNSDW limits and suspect thresholds.
 */
export function classifyChlorineReading(
  value: number | null | undefined,
  config: ChlorineConfig = CHLORINE_CONFIG,
): ChlorineReadingStatus {
  if (value == null || isNaN(value)) return 'missing';
  if (value > config.suspect_threshold) return 'suspect';
  if (value < config.min_limit) return 'below_min';
  if (value > config.max_limit) return 'above_max';
  return 'in_range';
}

/**
 * Detects consecutive missing reading gaps spanning more than the threshold.
 */
export function detectChlorineGaps(
  readings: RawChlorinePoint[],
  thresholdMinutes: number,
  trainNameMap?: Map<string, string>,
): ChlorineGap[] {
  if (!readings || readings.length === 0) return [];

  // Group readings by train
  const byTrain = new Map<string, RawChlorinePoint[]>();
  for (const r of readings) {
    if (!r.train_id) continue;
    const list = byTrain.get(r.train_id) ?? [];
    list.push(r);
    byTrain.set(r.train_id, list);
  }

  const gaps: ChlorineGap[] = [];

  byTrain.forEach((trainReadings, trainId) => {
    // Sort chronologically
    const sorted = [...trainReadings].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );

    const trainName = trainNameMap?.get(trainId) || sorted[0]?.train_name || `Train ${trainId.slice(-4)}`;

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      const prevTs = new Date(prev.reading_datetime).getTime();
      const currTs = new Date(curr.reading_datetime).getTime();
      const diffMinutes = (currTs - prevTs) / (1000 * 60);

      // A gap exists if the elapsed time exceeds the threshold and/or intermediate readings are null/missing
      if (diffMinutes > thresholdMinutes) {
        gaps.push({
          train_id: trainId,
          train_name: trainName,
          start_iso: prev.reading_datetime,
          end_iso: curr.reading_datetime,
          start_ts: prevTs,
          end_ts: currTs,
          duration_minutes: Math.round(diffMinutes),
          duration_hours: +(diffMinutes / 60).toFixed(1),
        });
      }
    }
  });

  return gaps.sort((a, b) => a.start_ts - b.start_ts);
}

export interface ChlorineGapSummary {
  count: number;
  longestMinutes: number;
  longestHours: number;
  longestTrainName: string | null;
}

/** Count + longest gap, for KPI chips (so gaps are visible without the readings view). */
export function summarizeChlorineGaps(gaps: ChlorineGap[]): ChlorineGapSummary {
  let longest: ChlorineGap | null = null;
  for (const g of gaps) if (!longest || g.duration_minutes > longest.duration_minutes) longest = g;
  return {
    count: gaps.length,
    longestMinutes: longest?.duration_minutes ?? 0,
    longestHours: longest ? +(longest.duration_minutes / 60).toFixed(1) : 0,
    longestTrainName: longest?.train_name ?? null,
  };
}

export interface LatestTrainReading {
  train_id: string;
  train_name: string;
  value: number;
  iso: string;
  ts: number;
  verified: boolean;
  status: ChlorineReadingStatus;
  /** Minutes this train's latest valid reading trails the newest valid reading of any train. */
  behindMinutes: number;
  /** A newer reading that is an unverified suspect (> suspect_threshold), awaiting review. */
  newerSuspect: { value: number; iso: string } | null;
}

/**
 * Latest valid reading per train within the points given ("latest in the loaded range", not live).
 * Unverified suspects are never reported as the latest value; a newer one is attached as
 * `newerSuspect` so the UI can say so instead of silently skipping it.
 */
export function latestChlorineByTrain(
  points: RawChlorinePoint[],
  config: ChlorineConfig = CHLORINE_CONFIG,
): LatestTrainReading[] {
  const byTrain = new Map<string, { ts: number; p: RawChlorinePoint; value: number }[]>();
  for (const p of points) {
    const v = p.chlorine_residual_mg_l;
    if (!p.train_id || v == null || !Number.isFinite(v)) continue;
    const ts = new Date(p.reading_datetime).getTime();
    if (Number.isNaN(ts)) continue;
    const list = byTrain.get(p.train_id) ?? [];
    list.push({ ts, p, value: v });
    byTrain.set(p.train_id, list);
  }

  const out: Omit<LatestTrainReading, 'behindMinutes'>[] = [];
  byTrain.forEach((list, trainId) => {
    list.sort((a, b) => a.ts - b.ts);
    const isUnverifiedSuspect = (x: { p: RawChlorinePoint; value: number }) =>
      classifyChlorineReading(x.value, config) === 'suspect' && !x.p.verified;
    let latest: (typeof list)[number] | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (!isUnverifiedSuspect(list[i])) { latest = list[i]; break; }
    }
    if (!latest) return;
    const newer = [...list].reverse().find((x) => x.ts > latest!.ts && isUnverifiedSuspect(x)) ?? null;
    out.push({
      train_id: trainId,
      train_name: latest.p.train_name || `Train ${trainId.slice(-4)}`,
      value: latest.value,
      iso: latest.p.reading_datetime,
      ts: latest.ts,
      verified: latest.p.verified === true,
      status: classifyChlorineReading(latest.value, config),
      newerSuspect: newer ? { value: newer.value, iso: newer.p.reading_datetime } : null,
    });
  });

  const newest = out.reduce((m, r) => Math.max(m, r.ts), 0);
  return out
    .map((r) => ({ ...r, behindMinutes: Math.round((newest - r.ts) / 60000) }))
    .sort((a, b) => a.train_name.localeCompare(b.train_name));
}

// ── Hourly, per train ──────────────────────────────────────────────────────

export const HOURLY_SEG_SEP = '::';
const HOUR_MS = 3_600_000;

export interface HourlyChlorineSeries {
  /** Recharts rows, one per hour that has data for any train. Keys: `ts`, `${train}::${segment}`, `val:${train}`, `n:${train}`. */
  rows: Record<string, number>[];
  /** One Line per (train, continuous segment). A new segment starts after a gap longer than gapMinutes. */
  series: { key: string; trainId: string }[];
}

/**
 * Hourly average per train (never combined across trains). Hour buckets are absolute
 * (UTC hour boundaries == Plant-time boundaries, Manila is UTC+8). Unverified suspect readings
 * (> suspect_threshold) and missing values are excluded, same as every other chlorine average.
 * Lines break across gaps longer than `gapMinutes`.
 */
export function buildHourlyChlorineByTrain(
  points: RawChlorinePoint[],
  gapMinutes: number = CHLORINE_CONFIG.gap_threshold_minutes.operator,
  config: ChlorineConfig = CHLORINE_CONFIG,
): HourlyChlorineSeries {
  const acc = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const p of points) {
    const v = p.chlorine_residual_mg_l;
    if (!p.train_id || v == null || !Number.isFinite(v)) continue;
    if (classifyChlorineReading(v, config) === 'suspect' && !p.verified) continue;
    const t = new Date(p.reading_datetime).getTime();
    if (Number.isNaN(t)) continue;
    const slot = Math.floor(t / HOUR_MS) * HOUR_MS;
    const perTrain = acc.get(p.train_id) ?? new Map<number, { sum: number; n: number }>();
    const cur = perTrain.get(slot) ?? { sum: 0, n: 0 };
    perTrain.set(slot, { sum: cur.sum + v, n: cur.n + 1 });
    acc.set(p.train_id, perTrain);
  }

  const rowMap = new Map<number, Record<string, number>>();
  const series: { key: string; trainId: string }[] = [];
  acc.forEach((slots, trainId) => {
    const sorted = Array.from(slots.entries()).sort((a, b) => a[0] - b[0]);
    let seg = 0;
    let prev: number | null = null;
    sorted.forEach(([slot, { sum, n }]) => {
      if (prev != null && (slot - prev) / 60_000 > gapMinutes) seg += 1;
      prev = slot;
      const avg = +(sum / n).toFixed(2);
      const row = rowMap.get(slot) ?? { ts: slot };
      row[`${trainId}${HOURLY_SEG_SEP}${seg}`] = avg;
      row[`val:${trainId}`] = avg;
      row[`n:${trainId}`] = n;
      rowMap.set(slot, row);
    });
    for (let i = 0; i <= seg; i++) series.push({ key: `${trainId}${HOURLY_SEG_SEP}${i}`, trainId });
  });

  return { rows: Array.from(rowMap.values()).sort((a, b) => a.ts - b.ts), series };
}

/**
 * Computes compliance metrics and averages, strictly excluding unverified suspect readings.
 */
export function computeChlorineStats(
  readings: RawChlorinePoint[],
  config: ChlorineConfig = CHLORINE_CONFIG,
): ChlorineStats {
  let totalCount = 0;
  let inRangeCount = 0;
  let belowMinCount = 0;
  let aboveMaxCount = 0;
  let suspectCount = 0;
  let sumValid = 0;
  let countValid = 0;
  let minValid: number | null = null;
  let maxValid: number | null = null;

  for (const r of readings) {
    const val = r.chlorine_residual_mg_l;
    if (val == null || isNaN(val)) continue;

    totalCount++;
    const status = classifyChlorineReading(val, config);

    if (status === 'suspect' && !r.verified) {
      suspectCount++;
      // Excluded from standard stats until verified
      continue;
    }

    countValid++;
    sumValid += val;

    if (minValid === null || val < minValid) minValid = val;
    if (maxValid === null || val > maxValid) maxValid = val;

    if (status === 'in_range') inRangeCount++;
    else if (status === 'below_min') belowMinCount++;
    else if (status === 'above_max' || (status === 'suspect' && r.verified)) aboveMaxCount++;
  }

  const compliancePct = countValid > 0 ? +((inRangeCount / countValid) * 100).toFixed(1) : null;
  const avgResidual = countValid > 0 ? +(sumValid / countValid).toFixed(2) : null;

  return {
    totalCount,
    validCount: countValid,
    inRangeCount,
    belowMinCount,
    aboveMaxCount,
    suspectCount,
    compliancePct,
    avgResidual,
    minValid: minValid !== null ? +minValid.toFixed(2) : null,
    maxValid: maxValid !== null ? +maxValid.toFixed(2) : null,
  };
}


// ── Daily averages ─────────────────────────────────────────────────────────

export interface DailyChlorineAvg {
  /** yyyy-MM-dd in Plant time (Asia/Manila) */
  dateKey: string;
  /** Noon of that Plant-time day, epoch ms (stable x position for charts) */
  ts: number;
  /** Mean of all valid readings across the selected trains; null = no valid reading that day */
  overall: number | null;
  overallCount: number;
  /** Lowest / highest valid reading that day (null = no valid reading). A daily mean can hide these. */
  min: number | null;
  max: number | null;
  /** Individual valid readings below the min / above the max limit that day. */
  belowCount: number;
  aboveCount: number;
  /** Readings at or below NO_RESIDUAL_MG_L (a subset of belowCount). */
  noResidualCount: number;
  /** Mean with no-residual readings left out; equals `overall` when there are none. */
  overallExclNoResidual: number | null;
  perTrain: Record<string, { avg: number; count: number }>;
}

const DAY_KEY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
});
const DAY_MS = 86_400_000;
const dayTs = (dateKey: string) => Date.parse(`${dateKey}T12:00:00+08:00`);

/**
 * Per-day averages by Plant calendar day. Unverified suspect readings (> suspect_threshold)
 * and missing values are excluded. Days with no valid reading are still returned
 * (overall = null) so charts can break the line and show "no data" instead of bridging.
 */
export function computeDailyChlorineAverages(
  points: RawChlorinePoint[],
  config: ChlorineConfig = CHLORINE_CONFIG,
): DailyChlorineAvg[] {
  interface DayAcc {
    sum: number; n: number;
    sumNr: number; nNr: number;
    min: number; max: number;
    below: number; above: number; noRes: number;
    trains: Map<string, { sum: number; n: number }>;
  }
  const acc = new Map<string, DayAcc>();
  for (const p of points) {
    const v = p.chlorine_residual_mg_l;
    if (v == null || !Number.isFinite(v)) continue;
    if (classifyChlorineReading(v, config) === 'suspect' && !p.verified) continue;
    const t = new Date(p.reading_datetime);
    if (Number.isNaN(t.getTime())) continue;
    const dk = DAY_KEY_FMT.format(t);
    const d: DayAcc = acc.get(dk) ?? {
      sum: 0, n: 0, sumNr: 0, nNr: 0, min: Infinity, max: -Infinity, below: 0, above: 0, noRes: 0, trains: new Map(),
    };
    d.sum += v;
    d.n += 1;
    d.min = Math.min(d.min, v);
    d.max = Math.max(d.max, v);
    if (v <= NO_RESIDUAL_MG_L) d.noRes += 1;
    else { d.sumNr += v; d.nNr += 1; }
    if (v < config.min_limit) d.below += 1;
    else if (v > config.max_limit) d.above += 1;
    const tr = d.trains.get(p.train_id) ?? { sum: 0, n: 0 };
    tr.sum += v;
    tr.n += 1;
    d.trains.set(p.train_id, tr);
    acc.set(dk, d);
  }
  if (acc.size === 0) return [];

  const keys = Array.from(acc.keys()).sort();
  const first = dayTs(keys[0]);
  const last = dayTs(keys[keys.length - 1]);
  const out: DailyChlorineAvg[] = [];
  for (let ts = first; ts <= last; ts += DAY_MS) {
    const dk = DAY_KEY_FMT.format(new Date(ts));
    const d = acc.get(dk);
    const perTrain: DailyChlorineAvg['perTrain'] = {};
    d?.trains.forEach((v, id) => { perTrain[id] = { avg: +(v.sum / v.n).toFixed(2), count: v.n }; });
    out.push({
      dateKey: dk,
      ts: dayTs(dk),
      overall: d ? +(d.sum / d.n).toFixed(2) : null,
      overallCount: d?.n ?? 0,
      min: d ? +d.min.toFixed(2) : null,
      max: d ? +d.max.toFixed(2) : null,
      belowCount: d?.below ?? 0,
      aboveCount: d?.above ?? 0,
      noResidualCount: d?.noRes ?? 0,
      overallExclNoResidual: d && d.nNr > 0 ? +(d.sumNr / d.nNr).toFixed(2) : null,
      perTrain,
    });
  }
  return out;
}
