/**
 * lib/gapDetection.ts — scans readings for date gaps and produces
 * interpolated fill rows.
 *
 * Implements:
 *   1. Even Δ distribution for bounded gaps <= 5 days between real readings.
 *   2. Regression + average-flow-rate curve for longer gaps (6-14 days).
 *   3. Support for remarks exemption (dates with logged gap reasons are skipped).
 *   4. Reset / rollover / replacement awareness.
 *   5. Guard against forward projection without an anchor.
 */

import { fmtIsoDate } from '@/lib/format';
import { RATE_COLUMNS, type RawReading, type CorrectionRow } from '@/lib/regressionCorrection';

/** Maximum number of days in a bounded gap that automated sweep/preview will backfill */
export const MAX_GAP_BACKFILL_DAYS = 14;

/** Gaps at or below this length use even delta split; longer gaps use regression + flow-rate */
export const EVEN_SPLIT_THRESHOLD_DAYS = 5;

/** For each source table: which FK column identifies the sub-entity
 *  (well / locator / meter / train) readings belong to, so gaps are never
 *  detected/interpolated across different entities. power_readings has none
 *  (plant-level only). */
export type EntityFkLookup = (sourceTable: string) => string | null;

// Sentinel prefix used to distinguish gap-fill pseudo-rows from real corrections.
export const GAP_FILL_PREFIX = '__gap__';

export interface GapFillMeta {
  entity_fk_col: string | null;
  entity_fk_val: string | null;
  plant_id:      string | null;
  from_date:     string;
  from_value:    number;
  to_date:       string;
  to_value:      number;
  method?:       'even_split' | 'forward_fill' | 'regression_flowrate';
}

export interface DetectGapsOptions {
  /** Dates (YYYY-MM-DD) that have logged remarks/gap reasons and must NOT be filled */
  exemptDateKeys?: Set<string>;
  /** Maximum number of missing days to auto-fill (default: 14) */
  maxGapDays?: number;
}

/**
 * Calculates equal daily increments across a short bounded gap (<= 5 days).
 * E.g., from 9020.6 to 9043.6 (delta = 23) across 2 missing days:
 * total steps = 2 + 1 = 3
 * daily step = 23 / 3 = 7.6667
 * returns [9028.27, 9035.93]
 */
export function calculateEvenSplitValues(
  fromVal: number,
  toVal: number,
  gapDays: number,
  decimalPlaces: number = 2,
): number[] {
  if (gapDays <= 0) return [];
  const delta = toVal - fromVal;
  const step = delta / (gapDays + 1);
  const result: number[] = [];
  for (let d = 1; d <= gapDays; d++) {
    result.push(parseFloat((fromVal + step * d).toFixed(decimalPlaces)));
  }
  return result;
}

/**
 * Calculates a smooth, rate-aware trajectory across longer gaps (6-14 days)
 * by blending the pre-gap operating flow rate with the boundary anchor.
 *
 * Formula:
 *   u = d / (N + 1)
 *   D_pre = historicalDailyRate * (N + 1) clamped to [0.2 * Δ, 1.8 * Δ]
 *   V(u) = fromVal + u * D_pre + u^2 * (Δ - D_pre)
 */
export function calculateRegressionFlowRateValues(
  fromVal: number,
  toVal: number,
  gapDays: number,
  historicalDailyRate: number | null,
  decimalPlaces: number = 2,
): number[] {
  if (gapDays <= 0) return [];
  const delta = toVal - fromVal;
  if (delta < 0 || historicalDailyRate == null || historicalDailyRate <= 0) {
    return calculateEvenSplitValues(fromVal, toVal, gapDays, decimalPlaces);
  }

  const totalSteps = gapDays + 1;
  const rawDpre = historicalDailyRate * totalSteps;
  // Monotonicity clamp: ensure the initial slope doesn't overshoot
  const dPre = Math.max(delta * 0.2, Math.min(delta * 1.8, rawDpre));
  const curvature = delta - dPre;

  const result: number[] = [];
  for (let d = 1; d <= gapDays; d++) {
    const u = d / totalSteps;
    const val = fromVal + u * dPre + u * u * curvature;
    result.push(parseFloat(val.toFixed(decimalPlaces)));
  }
  return result;
}

/**
 * Scans readings (sorted ascending) for date gaps > 1 day within each
 * entity group (well / locator / meter / train). For each missing day produces
 * a CorrectionRow with:
 *   • reading_id       → `__gap__:{entityFkVal}:{YYYY-MM-DD}`
 *   • original_value   → null  (the source-table row does not yet exist)
 *   • corrected_value  → for cumulative meter/volume columns: linear or flow-rate interpolation
 *                        between the two boundary values; for rate/quality columns:
 *                        forward-fill from the preceding reading
 *   • note             → "[gap-fill] " + JSON-encoded GapFillMeta
 */
export function detectGaps(
  readings: RawReading[],
  column: string,
  sourceTable: string,
  getEntityFkColumn: EntityFkLookup,
  options?: DetectGapsOptions,
): CorrectionRow[] {
  const entityFkCol = getEntityFkColumn(sourceTable);
  const exemptDates = options?.exemptDateKeys ?? new Set<string>();
  const maxGapDays  = options?.maxGapDays ?? MAX_GAP_BACKFILL_DAYS;

  // Group by entity FK so we never interpolate across different wells / locators / etc.
  const groups = new Map<string, RawReading[]>();
  readings.forEach(row => {
    const key = entityFkCol ? String(row[entityFkCol] ?? '__none__') : '__all__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  });

  const fills: CorrectionRow[] = [];

  groups.forEach((rows, groupKey) => {
    // rows already sorted ascending by reading_datetime
    for (let i = 0; i < rows.length - 1; i++) {
      const rowA = rows[i];
      const rowB = rows[i + 1];

      // Reset / rollover handling: if rowB is marked as replacement/rollover, don't interpolate across reset
      if (rowB.is_meter_replacement || rowB.is_meter_rollover) continue;

      const valA = rowA[column] != null ? Number(rowA[column]) : null;
      const valB = rowB[column] != null ? Number(rowB[column]) : null;
      if (valA == null || valB == null) continue;

      // Negative delta without rollover flag should not be interpolated
      const isRateCol = RATE_COLUMNS.has(column);
      if (!isRateCol && valB < valA) continue;

      const dateStrA = fmtIsoDate(rowA.reading_datetime);
      const dateStrB = fmtIsoDate(rowB.reading_datetime);
      const msA      = new Date(dateStrA).getTime();
      const msB      = new Date(dateStrB).getTime();
      const daysDiff = Math.round((msB - msA) / 86_400_000);

      if (daysDiff <= 1) continue; // consecutive — no gap
      const gapDays = daysDiff - 1;
      if (gapDays > maxGapDays) continue; // exceeds allowed auto-gap threshold

      // Compute trailing historical daily rate (scanning up to 7 readings within 14 days prior to rowA, matching SQL)
      let histRate: number | null = null;
      if (i > 0) {
        const windowStartMs = msA - 14 * 86_400_000;
        let oldestPrecedingRow: RawReading | null = null;
        let count = 0;
        for (let j = i - 1; j >= 0 && count < 7; j--) {
          const r = rows[j];
          const rDateMs = new Date(fmtIsoDate(r.reading_datetime)).getTime();
          if (rDateMs < windowStartMs) break;
          const rVal = r[column] != null ? Number(r[column]) : null;
          if (rVal != null) {
            oldestPrecedingRow = r;
            count++;
          }
        }

        if (oldestPrecedingRow) {
          const oldestVal = oldestPrecedingRow[column] != null ? Number(oldestPrecedingRow[column]) : null;
          if (oldestVal != null && valA > oldestVal) {
            const oldestMs = new Date(fmtIsoDate(oldestPrecedingRow.reading_datetime)).getTime();
            const histDays = Math.max(1, Math.round((msA - oldestMs) / 86_400_000));
            histRate = (valA - oldestVal) / histDays;
          }
        }
      }

      const method: 'forward_fill' | 'even_split' | 'regression_flowrate' = isRateCol
        ? 'forward_fill'
        : gapDays <= EVEN_SPLIT_THRESHOLD_DAYS || histRate == null
        ? 'even_split'
        : 'regression_flowrate';

      const interpolatedValues = isRateCol
        ? Array(gapDays).fill(parseFloat(valA.toFixed(4)))
        : method === 'regression_flowrate'
        ? calculateRegressionFlowRateValues(valA, valB, gapDays, histRate, 2)
        : calculateEvenSplitValues(valA, valB, gapDays, 2);

      const meta: GapFillMeta = {
        entity_fk_col: entityFkCol,
        entity_fk_val: groupKey === '__all__' || groupKey === '__none__' ? null : groupKey,
        plant_id:      rowA.plant_id ? String(rowA.plant_id) : null,
        from_date:     dateStrA,
        from_value:    valA,
        to_date:       dateStrB,
        to_value:      valB,
        method,
      };

      for (let d = 1; d <= gapDays; d++) {
        const missingMs      = msA + d * 86_400_000;
        const missingDateStr = new Date(missingMs).toISOString().slice(0, 10);

        // Remarks exemption: skip dates that have logged gap reasons
        const exemptKey = `${groupKey}|${missingDateStr}`;
        if (exemptDates.has(missingDateStr) || exemptDates.has(exemptKey)) {
          continue;
        }

        const interpolated = interpolatedValues[d - 1];

        fills.push({
          reading_id:       `${GAP_FILL_PREFIX}:${groupKey}:${missingDateStr}`,
          reading_datetime: missingDateStr + 'T12:00:00',
          original_value:   null,
          corrected_value:  interpolated,
          z_score:          null,
          is_outlier:       false,
          note:             `[gap-fill] ${JSON.stringify(meta)}`,
        });
      }
    }
  });

  return fills;
}
