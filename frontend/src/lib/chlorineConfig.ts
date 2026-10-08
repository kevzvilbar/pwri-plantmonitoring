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

