// Extracted from DataAnalysis.tsx (Phase 1 of pwri-improvement-plan.md).
// The client-side reset-anomaly + OLS regression correction algorithm that
// decides what counts as a "corrected" value in the Data Analysis & Review
// page. Previously private to that page file; moved here (and its pieces
// exported) so it can be unit tested and reused independent of the page's
// ~2,500 lines of UI. See regressionCorrection.test.ts (moved alongside this
// file from DataAnalysis.test.ts) for coverage, including a characterization
// test documenting a real limitation found while writing those tests: a
// sustained baseline change (not a single mis-keyed value) cascades into
// every subsequent row also being flagged, since RawReading here doesn't
// carry an is_meter_replacement-equivalent marker the way readingGuards.ts's
// live entry path does.
//
// NOTE: ROW_LIMIT stayed behind in DataAnalysis.tsx — it's a data-fetching
// concern (how many rows the page queries from Supabase), not part of the
// algorithm itself, even though it was declared in the same original block.

export type NormStatus = 'normal' | 'erroneous' | 'normalized' | 'retracted';

export interface RawReading {
  id: string;
  reading_datetime: string;
  plant_id?: string;
  norm_status?: NormStatus;
  [key: string]: unknown;
}

export interface CorrectionRow {
  reading_id: string;
  reading_datetime: string;
  original_value: number | null;
  corrected_value: number | null;
  z_score: number | null;
  is_outlier: boolean;
  note: string;
}

// ── Anomaly Detection + OLS Regression (client-side) ──────────────────────────
//
// Strategy (two-pass):
//   Pass 1 — Meter Reset / Mis-entry Detection
//     Scans consecutive delta changes.  If |delta| > RESET_THRESHOLD the reading
//     is flagged as a "reset anomaly".  The corrected value is interpolated from
//     the median of up to STABLE_WINDOW stable deltas on both sides of the spike.
//
//   Pass 2 — OLS Residual Outlier Detection
//     Runs OLS on the cleaned (non-reset) values.  Readings whose residual
//     Z-score exceeds Z_THRESHOLD are flagged as statistical outliers and
//     corrected to the regression projection.
//
// Both passes produce CorrectionRow entries; reset anomalies take priority.

// RESET_THRESHOLD is column-dependent: meter/volume columns can have large absolute
// values, but rate/quality columns (TDS, pH, recovery %) have values in the tens.
// Using a single fixed threshold would never fire for rate columns.
const STABLE_WINDOW    = 5;   // look ±N stable rows for median delta
const MIN_ROWS         = 5;   // minimum rows required for OLS

/** Rate / quality columns that carry small absolute values (not cumulative meters). */
export const RATE_COLUMNS = new Set([
  'permeate_tds', 'permeate_ph', 'turbidity_ntu', 'dp_psi',
  'recovery_pct', 'daily_consumption_kwh', 'daily_solar_kwh', 'daily_grid_kwh',
  'daily_volume',
]);

/** Return the |delta| above which a consecutive change is treated as a reset/mis-entry. */
export function getResetThreshold(column: string): number {
  return RATE_COLUMNS.has(column) ? 500 : 1_000_000;
}

/**
 * Z-score threshold for OLS residual outlier detection.
 * Larger datasets have more natural variance; tighten the cutoff on small sets
 * so we don't miss obvious spikes, and relax it on large sets to reduce false positives.
 */
export function getZThreshold(n: number): number {
  if (n < 20)  return 2.0;
  if (n < 100) return 2.5;
  return 3.0;
}

export interface OLSResult {
  corrections: CorrectionRow[];
  stats: { r_squared: number | null; slope: number | null; intercept: number | null };
  resetCount: number;
}

/** Median of a numeric array. */
export function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function runOLS(readings: RawReading[], column: string): OLSResult {
  // ── Collect numeric pairs (dayOffset, value) ──────────────────────────────
  // x-axis = days since the first valid reading's timestamp (fractional days for
  // sub-daily tables like ro_train_readings).  This ensures the regression
  // treats a 3-day gap as 3x further apart than a 1-day gap, not as one row.
  type Pair = { rowPos: number; dayOffset: number; val: number };
  const pairs: Pair[] = [];

  // Anchor: epoch of the first row with a parseable datetime
  let t0ms: number | null = null;
  readings.forEach(row => {
    if (t0ms === null && row.reading_datetime) {
      const ms = new Date(String(row.reading_datetime)).getTime();
      if (!isNaN(ms)) t0ms = ms;
    }
  });
  const MS_PER_DAY = 86_400_000;

  readings.forEach((row, i) => {
    const raw = row[column];
    if (raw == null || isNaN(Number(raw))) return;
    const ms = new Date(String(row.reading_datetime)).getTime();
    if (isNaN(ms)) return;
    const dayOffset = t0ms !== null ? (ms - t0ms) / MS_PER_DAY : i;
    pairs.push({ rowPos: i, dayOffset, val: Number(raw) });
  });

  if (pairs.length < MIN_ROWS) {
    return {
      corrections: readings.map(row => ({
        reading_id:       String(row.id),
        reading_datetime: String(row.reading_datetime),
        original_value:   row[column] != null ? Number(row[column]) : null,
        corrected_value:  null,
        z_score:          null,
        is_outlier:       false,
        note:             'Insufficient data for analysis',
      })),
      stats: { r_squared: null, slope: null, intercept: null },
      resetCount: 0,
    };
  }

  // Build O(1) rowPos → pairs-index map up front (fixes #6 — eliminates O(n²) indexOf).
  const pairsIdxMap = new Map<number, number>(); // rowPos → pairs index
  pairs.forEach((p, pi) => pairsIdxMap.set(p.rowPos, pi));

  // ── Pass 1: Meter Reset / Mis-entry Detection ─────────────────────────────
  // Compute deltas using the *effective* (possibly corrected) previous value so
  // a corrected reset doesn't cascade and double-flag the next reading (fix #7).
  const RESET_THRESHOLD = getResetThreshold(column);

  const effectiveVals: number[] = pairs.map(p => p.val); // will be updated as resets are found
  const dayGaps: number[]       = pairs.map((p, i) =>
    i === 0 ? 1 : Math.max(p.dayOffset - pairs[i - 1].dayOffset, 1 / 1440),
  );

  // Map: pairs-index → corrected value (reset anomalies only — NOT OLS outliers).
  // Keeping these separate from OLS outliers eliminates the negative-index hack (fix #1).
  const resetCorrectedIdx = new Set<number>();
  const resetCorrections  = new Map<number, number>(); // pairs idx → corrected value

  pairs.forEach((_p, i) => {
    if (i === 0) return;
    const rawDelta = pairs[i].val - effectiveVals[i - 1]; // use effective prev (fix #7)
    if (Math.abs(rawDelta) <= RESET_THRESHOLD) return;

    // Collect stable per-day rates from nearby readings
    const stableRates: number[] = [];
    for (let k = i - 1; k >= Math.max(0, i - STABLE_WINDOW); k--) {
      const kDelta = pairs[k].val - (k > 0 ? effectiveVals[k - 1] : pairs[k].val);
      if (Math.abs(kDelta) <= RESET_THRESHOLD && k > 0) {
        stableRates.push(kDelta / dayGaps[k]);
      }
    }
    for (let k = i + 1; k <= Math.min(pairs.length - 1, i + STABLE_WINDOW); k++) {
      const kDelta = pairs[k].val - pairs[k - 1].val;
      if (Math.abs(kDelta) <= RESET_THRESHOLD) {
        stableRates.push(kDelta / dayGaps[k]);
      }
    }

    const normalRate    = stableRates.length > 0 ? median(stableRates) : 0;
    const expectedDelta = normalRate * dayGaps[i];
    const corrected     = parseFloat((effectiveVals[i - 1] + expectedDelta).toFixed(4));

    resetCorrections.set(i, corrected);
    resetCorrectedIdx.add(i);
    effectiveVals[i] = corrected; // fix #7: next row uses corrected value as baseline
  });

  const resetCount = resetCorrections.size;

  // ── Pass 2: OLS on cleaned (non-reset) values using dayOffset as x ────────
  // Single computation — results stored directly into olsZScores / olsPreds (fix #2).
  const cleanPairs = pairs.filter((_, i) => !resetCorrectedIdx.has(i));
  const n   = cleanPairs.length;
  const xs  = cleanPairs.map(p => p.dayOffset);
  const ys  = cleanPairs.map(p => p.val);

  let slope = 0, intercept = 0, rSquared: number | null = null;

  // Maps populated once from the single OLS run (fix #2).
  const olsZScores = new Map<number, number>(); // pairsIdx → z-score
  const olsPreds   = new Map<number, number>(); // pairsIdx → predicted value
  // Set of pairs indices flagged as OLS outliers — disjoint from resetCorrectedIdx (fix #1).
  const olsOutlierIdx = new Set<number>();

  if (n >= MIN_ROWS) {
    const sumX  = xs.reduce((a, b) => a + b, 0);
    const sumY  = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
    const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    slope     = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    intercept = (sumY - slope * sumX) / n;

    const yPred     = xs.map(x => slope * x + intercept);
    const residuals = ys.map((y, i) => y - yPred[i]);
    const meanY     = sumY / n;
    const ssTot     = ys.reduce((acc, y) => acc + (y - meanY) ** 2, 0);
    const ssRes     = residuals.reduce((acc, r) => acc + r * r, 0);
    rSquared        = ssTot > 0 ? 1 - ssRes / ssTot : null;

    const meanRes   = residuals.reduce((a, b) => a + b, 0) / n;
    const stdRes    = Math.sqrt(residuals.reduce((acc, r) => acc + (r - meanRes) ** 2, 0) / n) || 0;
    const Z_THRESHOLD = getZThreshold(n); // dataset-size-aware cutoff (fix #4)

    // Populate olsZScores / olsPreds using pairsIdxMap (O(1) lookup — fix #6).
    cleanPairs.forEach((p, ci) => {
      const pi = pairsIdxMap.get(p.rowPos);
      if (pi === undefined) return;
      const z    = stdRes > 0 ? residuals[ci] / stdRes : 0;
      const pred = yPred[ci];
      olsZScores.set(pi, z);
      olsPreds.set(pi, pred);
      if (Math.abs(z) > Z_THRESHOLD) {
        olsOutlierIdx.add(pi); // track outliers in a separate set (fix #1)
      }
    });
  }

  // ── Build final CorrectionRow array ──────────────────────────────────────
  const corrections: CorrectionRow[] = readings.map((row, i) => {
    const rid  = String(row.id);
    const rdt  = String(row.reading_datetime);
    const pi   = pairsIdxMap.get(i); // O(1) lookup (fix #6)
    const orig = row[column] != null ? Number(row[column]) : null;

    if (pi === undefined || orig === null) {
      return {
        reading_id: rid, reading_datetime: rdt,
        original_value: orig, corrected_value: null,
        z_score: null, is_outlier: false,
        note: 'Missing value — skipped',
      };
    }

    // Reset anomaly takes priority — checked against its own set (fix #1).
    if (resetCorrectedIdx.has(pi)) {
      const corrected = resetCorrections.get(pi)!;
      return {
        reading_id: rid, reading_datetime: rdt,
        original_value: orig, corrected_value: corrected,
        z_score: null, is_outlier: true,
        note: `reset anomaly correction (spike Δ=${(orig - (pairs[pi - 1]?.val ?? orig)).toFixed(0)} over ${dayGaps[pi].toFixed(2)}d, corrected to time-normalised median rate)`,
      };
    }

    const z    = olsZScores.get(pi) ?? null;
    const pred = olsPreds.get(pi)   ?? null;
    const isOlsOutlier = olsOutlierIdx.has(pi); // checked against separate set (fix #1)

    if (isOlsOutlier && pred != null) {
      const direction = z! > 0 ? 'high' : 'low';
      return {
        reading_id: rid, reading_datetime: rdt,
        original_value: orig, corrected_value: parseFloat(pred.toFixed(4)),
        z_score: parseFloat(z!.toFixed(4)), is_outlier: true,
        note: `statistical outlier (z=${z!.toFixed(2)}, ${direction}); regression-corrected`,
      };
    }

    return {
      reading_id: rid, reading_datetime: rdt,
      original_value: orig, corrected_value: null,
      z_score: z != null ? parseFloat(z.toFixed(4)) : null,
      is_outlier: false,
      note: 'within normal range',
    };
  });

  return {
    corrections,
    stats: {
      r_squared: rSquared != null ? parseFloat(rSquared.toFixed(6)) : null,
      slope:     parseFloat(slope.toFixed(6)),
      intercept: parseFloat(intercept.toFixed(6)),
    },
    resetCount,
  };
}
