/**
 * DataAnalysis.tsx  — Data Analysis & Review Page
 * ─────────────────────────────────────────────────
 * Centralised hub for raw-data review and regression-based normalization.
 *
 * Access:
 *   Admin / Data Analyst → full edit + regression rights
 *   Manager              → read-only (no edit / no run-regression)
 *   Others               → access denied
 *
 * Layout:
 *   Left  → Raw Data Table (read-only display; editable only via the Edit modal)
 *   Right → Regression Results Table (corrected_value + notes)
 *
 * Workflow:
 *   1. Select source table + column + optional plant + date range
 *   2. Run Regression  → OLS fit runs client-side, result stored in Supabase
 *   3. Review the regression table
 *   4. Apply (writes corrected values + reading_normalizations rows)
 *      or Retract if already applied
 *   5. All edits are logged; dashboard picks up ⚠️ / 🔄 / ⏪ symbols
 *
 * Backend: 100% Supabase — no Python backend required.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import {
  FlaskConical, Play, CheckCircle2, Undo2, Pencil, ShieldAlert,
  TrendingUp, Database, AlertTriangle, RefreshCw, Clock, Eye,
  ChevronDown, ChevronUp, Info, Zap, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCE_TABLES: Record<string, string[]> = {
  well_readings:          ['daily_volume', 'current_reading', 'previous_reading', 'power_meter_reading'],
  locator_readings:       ['daily_volume', 'current_reading', 'previous_reading'],
  product_meter_readings: ['daily_volume', 'current_reading', 'previous_reading'],
  ro_train_readings:      ['permeate_tds', 'permeate_ph', 'turbidity_ntu', 'dp_psi', 'recovery_pct', 'permeate_meter', 'feed_meter', 'reject_meter'],
  power_readings:         ['daily_consumption_kwh', 'meter_reading_kwh', 'daily_solar_kwh', 'daily_grid_kwh'],
};

/** Tables that do not have a norm_status column — skip it in SELECT. */
const TABLES_WITHOUT_NORM_STATUS = new Set(['power_readings']);

/** All tables show full datetime (YYYY-MM-DD HH:mm). */
const TABLES_WITH_TIME = new Set(Object.keys(SOURCE_TABLES));

/** Format a reading_datetime string based on whether the table uses time. */
function fmtDatetime(raw: string, showTime: boolean): { date: string; time?: string } {
  const s = raw.replace('T', ' ').replace('Z', '');
  if (!showTime) return { date: s.slice(0, 10) };
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

const TABLE_LABELS: Record<string, string> = {
  well_readings:          'Well Readings',
  locator_readings:       'Locator Readings',
  product_meter_readings: 'Product Meter Readings',
  ro_train_readings:      'RO Train Readings',
  power_readings:         'Grid & Solar Readings',
};

/** For each source table: which Supabase lookup table + FK column on the readings row.
 *  power_readings is plant-level only (no sub-entity FK); it is intentionally absent here.
 *  Instead, a "Source" filter (Solar / Grid) is provided via POWER_SOURCE_FILTER. */
const ENTITY_CONFIG: Record<string, {
  lookupTable: string;
  fkColumn: string;
  selectCols: string;
  labelFn: (row: Record<string, unknown>) => string;
  filterLabel: string;
}> = {
  well_readings: {
    lookupTable: 'wells',
    fkColumn:    'well_id',
    selectCols:  'id, name, plant_id, status',
    labelFn:     r => String(r.name ?? r.id),
    filterLabel: 'Well',
  },
  locator_readings: {
    lookupTable: 'locators',
    fkColumn:    'locator_id',
    selectCols:  'id, name, plant_id, status',
    labelFn:     r => String(r.name ?? r.id),
    filterLabel: 'Locator',
  },
  ro_train_readings: {
    lookupTable: 'ro_trains',
    fkColumn:    'train_id',
    selectCols:  'id, name, train_number, plant_id, status',
    labelFn:     r => r.name ? String(r.name) : `Train ${r.train_number}`,
    filterLabel: 'RO Train',
  },
  product_meter_readings: {
    lookupTable: 'product_meters',
    fkColumn:    'meter_id',
    selectCols:  'id, name, plant_id',
    labelFn:     r => String(r.name ?? r.id),
    filterLabel: 'Meter',
  },
};

/** power_readings has no sub-entity FK — it is plant-level.
 *  We provide a "Source" pseudo-filter so users can isolate Solar vs Grid columns. */
const POWER_SOURCE_OPTIONS = [
  { value: 'all',   label: 'All Sources' },
  { value: 'solar', label: 'Solar',       columns: ['daily_solar_kwh'] },
  { value: 'grid',  label: 'Grid',        columns: ['daily_grid_kwh'] },
  { value: 'total', label: 'Total / Meter', columns: ['daily_consumption_kwh', 'meter_reading_kwh'] },
];

// ── Types ──────────────────────────────────────────────────────────────────────

type NormStatus = 'normal' | 'erroneous' | 'normalized' | 'retracted';

interface RawReading {
  id: string;
  reading_datetime: string;
  plant_id?: string;
  norm_status?: NormStatus;
  [key: string]: unknown;
}

interface CorrectionRow {
  reading_id: string;
  reading_datetime: string;
  original_value: number | null;
  corrected_value: number | null;
  z_score: number | null;
  is_outlier: boolean;
  note: string;
}

interface RegressionResult {
  result_id: string;
  source_table: string;
  column_name: string;
  plant_id: string | null;
  row_count: number;
  truncated: boolean;
  outlier_count: number;
  r_squared: number | null;
  slope: number | null;
  intercept: number | null;
  corrections: CorrectionRow[];
  status: 'pending' | 'applied' | 'retracted';
  created_at: string;
}

interface Plant { id: string; name: string; }
interface EntityOption { id: string; label: string; }

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
const ROW_LIMIT         = 2000; // max rows fetched per regression run — see D5 fix

/** Rate / quality columns that carry small absolute values (not cumulative meters). */
const RATE_COLUMNS = new Set([
  'permeate_tds', 'permeate_ph', 'turbidity_ntu', 'dp_psi',
  'recovery_pct', 'daily_consumption_kwh', 'daily_solar_kwh', 'daily_grid_kwh',
  'daily_volume',
]);

/** Return the |delta| above which a consecutive change is treated as a reset/mis-entry. */
function getResetThreshold(column: string): number {
  return RATE_COLUMNS.has(column) ? 500 : 1_000_000;
}

/**
 * Z-score threshold for OLS residual outlier detection.
 * Larger datasets have more natural variance; tighten the cutoff on small sets
 * so we don't miss obvious spikes, and relax it on large sets to reduce false positives.
 */
function getZThreshold(n: number): number {
  if (n < 20)  return 2.0;
  if (n < 100) return 2.5;
  return 3.0;
}

interface OLSResult {
  corrections: CorrectionRow[];
  stats: { r_squared: number | null; slope: number | null; intercept: number | null };
  resetCount: number;
}

/** Median of a numeric array. */
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function runOLS(readings: RawReading[], column: string): OLSResult {
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

// ── Gap Detection + Linear Interpolation ──────────────────────────────────────
//
// Sentinel prefix used to distinguish gap-fill pseudo-rows from real corrections.
// Gap fills are stored inside the same `corrections` JSONB array so no extra DB
// column / migration is required.  Any consumer that only wants real outlier rows
// must filter out entries whose reading_id starts with this prefix.
const GAP_FILL_PREFIX = '__gap__';

interface GapFillMeta {
  entity_fk_col: string | null;
  entity_fk_val: string | null;
  plant_id:      string | null;
  from_date:     string;
  from_value:    number;
  to_date:       string;
  to_value:      number;
}

/**
 * Scans readings (sorted ascending) for date gaps > 1 day within each
 * entity group (well / locator / meter / train).  For each missing day produces
 * a CorrectionRow with:
 *   • reading_id       → `__gap__:{entityFkVal}:{YYYY-MM-DD}`
 *   • original_value   → null  (the source-table row does not yet exist)
 *   • corrected_value  → for cumulative meter/volume columns: linear interpolation
 *                        between the two boundary values; for rate/quality columns:
 *                        forward-fill from the preceding reading (fix #5)
 *   • note             → "[gap-fill] " + JSON-encoded GapFillMeta
 */
function detectGaps(readings: RawReading[], column: string, sourceTable: string): CorrectionRow[] {
  const entityCfg   = ENTITY_CONFIG[sourceTable];
  const entityFkCol = entityCfg?.fkColumn ?? null;

  // Group by entity FK so we never interpolate across different wells / locators / etc.
  const groups = new Map<string, RawReading[]>();
  readings.forEach(row => {
    const key = entityFkCol ? String(row[entityFkCol] ?? '__none__') : '__all__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  });

  const fills: CorrectionRow[] = [];

  groups.forEach((rows, groupKey) => {
    // rows already sorted ascending by reading_datetime (regression query uses ascending order)
    for (let i = 0; i < rows.length - 1; i++) {
      const rowA = rows[i];
      const rowB = rows[i + 1];

      const valA = rowA[column] != null ? Number(rowA[column]) : null;
      const valB = rowB[column] != null ? Number(rowB[column]) : null;
      if (valA == null || valB == null) continue;

      const dateStrA = String(rowA.reading_datetime).slice(0, 10);
      const dateStrB = String(rowB.reading_datetime).slice(0, 10);
      const msA      = new Date(dateStrA).getTime();
      const msB      = new Date(dateStrB).getTime();
      const daysDiff = Math.round((msB - msA) / 86_400_000);

      if (daysDiff <= 1) continue; // consecutive — no gap

      const meta: GapFillMeta = {
        entity_fk_col: entityFkCol,
        entity_fk_val: groupKey === '__all__' || groupKey === '__none__' ? null : groupKey,
        plant_id:      rowA.plant_id ? String(rowA.plant_id) : null,
        from_date:     dateStrA,
        from_value:    valA,
        to_date:       dateStrB,
        to_value:      valB,
      };

      // For cumulative meter/volume columns, linear interpolation is correct
      // (the meter was ticking the whole time). For rate/quality columns
      // (TDS, pH, recovery %), repeating the last known value is more defensible
      // than fabricating a slope between two point measurements (fix #5).
      const isRateCol = RATE_COLUMNS.has(column);

      for (let d = 1; d < daysDiff; d++) {
        const missingMs       = msA + d * 86_400_000;
        const missingDateStr  = new Date(missingMs).toISOString().slice(0, 10);
        const interpolated    = isRateCol
          ? parseFloat(valA.toFixed(4))                             // forward-fill
          : parseFloat((valA + (valB - valA) * (d / daysDiff)).toFixed(4)); // linear interp

        fills.push({
          reading_id:       `${GAP_FILL_PREFIX}:${groupKey}:${missingDateStr}`,
          reading_datetime: missingDateStr + 'T00:00:00',
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

// ── recalculateTrainDeltas ────────────────────────────────────────────────────
//
// Recomputes permeate_meter_delta for EVERY reading of a given RO train in
// strict chronological order.  Must be called any time the permeate_meter
// baseline changes:
//
//   • DataAnalysis applies a permeate_meter correction (handleApply below)
//   • is_meter_replacement is toggled on/off  (TrainOperatorLogModal, Plants.tsx)
//   • A new reading is inserted between existing ones  (ROTrains.tsx submit —
//     add a call there too; hook point is clearly marked in that file)
//
// Rules applied in sequence per row:
//   is_meter_replacement = true  → delta = 0; baseline STILL advances so the
//                                   next row computes correctly from the new meter
//   Normal row, prev available   → delta = max(0, current − prev)
//   First row / meter is null    → delta = null  (no predecessor yet)
//
// Only rows whose computed delta differs from the stored value are written to DB,
// keeping network traffic minimal.
async function recalculateTrainDeltas(trainId: string): Promise<void> {
  try {
    const { data: rows } = await (supabase.from('ro_train_readings_clean' as any) as any)
      .select('id, permeate_meter, permeate_meter_delta, is_meter_replacement')
      .eq('train_id', trainId)
      .order('reading_datetime', { ascending: true });

    if (!rows?.length) return;

    let prevMeter: number | null = null;

    for (const row of rows as any[]) {
      const isRepl   = !!row.is_meter_replacement;
      const curMeter = row.permeate_meter != null ? +row.permeate_meter : null;
      const stored   = row.permeate_meter_delta != null ? +row.permeate_meter_delta : null;

      let newDelta: number | null;
      if (isRepl) {
        newDelta = 0;                                            // replacement: zero contribution
      } else if (prevMeter != null && curMeter != null) {
        newDelta = Math.max(0, curMeter - prevMeter);
      } else {
        newDelta = null;                                         // no predecessor
      }

      // Advance baseline regardless of replacement flag so the next normal row
      // computes its delta correctly from the replacement meter value.
      if (curMeter != null) prevMeter = curMeter;

      // Skip DB write when value hasn't changed
      const needsUpdate = newDelta !== stored;
      if (needsUpdate) {
        await (supabase.from('ro_train_readings_clean' as any) as any)
          .update({ permeate_meter_delta: newDelta })
          .eq('id', row.id);
      }
    }
  } catch {
    // Non-critical — proceed without full cascade
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function NormBadge({ status }: { status?: NormStatus }) {
  if (!status || status === 'normal') return null;
  const cfg: Record<string, { emoji: string; cls: string }> = {
    erroneous:  { emoji: '⚠️', cls: 'border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/30' },
    normalized: { emoji: '🔄', cls: 'border-teal-400  text-teal-700  bg-teal-50  dark:bg-teal-950/30'  },
    retracted:  { emoji: '⏪', cls: 'border-border    text-muted-foreground bg-muted'                    },
  };
  const c = cfg[status];
  if (!c) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border', c.cls)}>
      {c.emoji} {status}
    </span>
  );
}

function StatusBadge({ status }: { status: RegressionResult['status'] }) {
  const cfg = {
    pending:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    applied:   { label: 'Applied',   cls: 'bg-teal-100  text-teal-800  border-teal-300'  },
    retracted: { label: 'Retracted', cls: 'bg-muted     text-muted-foreground border-border' },
  }[status];
  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border', cfg.cls)}>
      {cfg.label}
    </span>
  );
}

// ── Paired-column tables: current_reading ↔ previous_reading ─────────────────
const PAIRED_COL_TABLES = new Set(['well_readings', 'locator_readings', 'product_meter_readings']);

// ── Edit Raw Value Dialog ──────────────────────────────────────────────────────

interface EditRawDialogProps {
  open: boolean;
  onClose: () => void;
  reading: RawReading | null;
  column: string;
  onSuccess: () => void;
}

function EditRawDialog({ open, onClose, reading, column, onSuccess }: EditRawDialogProps) {
  const { session, isAdmin, roles } = useAuth();
  const [newValue,       setNewValue]       = useState('');
  const [pairedOldValue, setPairedOldValue] = useState('');   // existing DB value (read-only display)
  const [pairedNewValue, setPairedNewValue] = useState('');   // value being edited
  const [note,           setNote]           = useState('');
  const [saving,         setSaving]         = useState(false);
  const [loadingPaired,  setLoadingPaired]  = useState(false);

  const srcTable  = (reading?._sourceTable as string) ?? '';
  const isPaired  = (column === 'current_reading' || column === 'previous_reading')
                    && PAIRED_COL_TABLES.has(srcTable);
  const pairedCol = column === 'current_reading' ? 'previous_reading' : 'current_reading';

  const oldValue = reading ? (reading[column] as number | null) : null;

  // Fetch the paired column value from the same row when dialog opens
  useEffect(() => {
    if (!open || !reading) return;
    setNewValue('');
    setNote('');
    setPairedOldValue('');
    setPairedNewValue('');
    if (!isPaired) return;

    setLoadingPaired(true);
    (supabase.from(srcTable as never) as any)
      .select(`id, ${pairedCol}`)
      .eq('id', reading.id)
      .maybeSingle()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        const pv = data?.[pairedCol] as number | null;
        const pvStr = pv != null ? String(pv) : '';
        setPairedOldValue(pvStr);   // lock in the existing DB value for display
        setPairedNewValue(pvStr);   // pre-fill the editable field with the same value
        setLoadingPaired(false);
      })
      .catch(() => setLoadingPaired(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reading?.id]);

  // Auto-compute daily_volume = current_reading – previous_reading
  const computedDelta = (() => {
    if (!isPaired) return null;
    const curr = column === 'current_reading'
      ? parseFloat(newValue  || String(oldValue ?? ''))
      : parseFloat(pairedNewValue);
    const prev = column === 'previous_reading'
      ? parseFloat(newValue  || String(oldValue ?? ''))
      : parseFloat(pairedNewValue);
    if (isNaN(curr) || isNaN(prev)) return null;
    return curr - prev;
  })();

  const handleSave = async () => {
    if (!reading) return;
    const parsed = parseFloat(newValue);
    if (isNaN(parsed)) { toast.error('Enter a valid number'); return; }
    const pairedParsed = isPaired ? parseFloat(pairedNewValue) : NaN;

    setSaving(true);
    try {
      // Build update payload — include paired column when both are being saved
      const updatePayload: Record<string, number> = { [column]: parsed };
      if (isPaired && !isNaN(pairedParsed)) updatePayload[pairedCol] = pairedParsed;

      // 1. Update source table (both columns in one call if paired)
      const { error: updateErr } = await (supabase
        .from(srcTable as never) as any)
        .update(updatePayload)
        .eq('id', reading.id);
      if (updateErr) throw new Error(updateErr.message);

      // 2. Log to audit table — one entry per changed column
      const userRole = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');
      const auditRows: Record<string, unknown>[] = [{
        source_table: srcTable,
        source_id:    reading.id,
        column_name:  column,
        old_value:    oldValue,
        new_value:    parsed,
        edited_by:    session?.user?.id ?? null,
        edited_role:  userRole,
        edited_at:    new Date().toISOString(),
        note:         note || '',
      }];
      if (isPaired && !isNaN(pairedParsed)) {
        auditRows.push({
          source_table: srcTable,
          source_id:    reading.id,
          column_name:  pairedCol,
          old_value:    pairedOldValue !== '' ? parseFloat(pairedOldValue) : null,
          new_value:    pairedParsed,
          edited_by:    session?.user?.id ?? null,
          edited_role:  userRole,
          edited_at:    new Date().toISOString(),
          note:         note ? `[paired] ${note}` : `[paired edit with ${column}]`,
        });
      }
      await supabase.from('raw_edit_log').insert(auditRows as any);

      toast.success(isPaired ? 'Both values updated and logged' : 'Value updated and logged');
      onSuccess();
      onClose();
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit Raw Value
            {isPaired && (
              <Badge variant="outline" className="text-[10px] ml-1 border-teal-400 text-teal-700">
                Paired Edit
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-xs text-muted-foreground">
            {isPaired ? (
              <>Editing pair: <span className="font-mono font-semibold">{column}</span> &amp; <span className="font-mono font-semibold">{pairedCol}</span></>
            ) : (
              <>Column: <span className="font-mono font-semibold">{column}</span></>
            )}
            <br />
            Reading: <span className="font-mono">{reading?.reading_datetime?.slice(0, 10)}</span>
          </div>

          {/* Primary column */}
          <div>
            <Label className="text-xs font-semibold">{column}</Label>
            <div className="flex gap-2 mt-1 items-center">
              <div className="w-1/2">
                <p className="text-[10px] text-muted-foreground mb-0.5">Current</p>
                <Input value={oldValue ?? '—'} disabled className="font-mono text-sm bg-muted/40 h-8" />
              </div>
              <div className="w-1/2">
                <p className="text-[10px] text-muted-foreground mb-0.5">New value <span className="text-danger">*</span></p>
                <Input
                  className="font-mono text-sm h-8"
                  placeholder="e.g. 123.45"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          </div>

          {/* Paired column */}
          {isPaired && (
            <div className="border-t pt-3">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                {pairedCol}
                <span className="text-[10px] font-normal text-muted-foreground">(linked — editable)</span>
                {loadingPaired && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
              </Label>
              <div className="flex gap-2 mt-1 items-center">
                <div className="w-1/2">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Current</p>
                  <Input value={loadingPaired ? 'Loading…' : (pairedOldValue || '—')} disabled className="font-mono text-sm bg-muted/40 h-8" />
                </div>
                <div className="w-1/2">
                  <p className="text-[10px] text-muted-foreground mb-0.5">New value</p>
                  <Input
                    className="font-mono text-sm h-8"
                    placeholder="optional"
                    value={pairedNewValue}
                    onChange={e => setPairedNewValue(e.target.value)}
                    disabled={loadingPaired}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Auto-computed daily_volume indicator */}
          {isPaired && computedDelta != null && (
            <div className="rounded bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 px-3 py-1.5 flex items-center justify-between text-xs">
              <span className="text-teal-700 dark:text-teal-300 font-medium">Computed daily_volume</span>
              <span className={cn('font-mono font-semibold', computedDelta < 0 ? 'text-danger' : 'text-teal-700 dark:text-teal-300')}>
                {computedDelta >= 0 ? '+' : ''}{computedDelta.toFixed(3)}
              </span>
            </div>
          )}

          <div>
            <Label className="text-xs">Reason / note</Label>
            <Input className="mt-1 text-sm" placeholder="Optional" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="rounded bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
            <Info className="inline h-3 w-3 mr-1" />
            {isPaired
              ? 'Both columns are saved together and each change is logged in the audit trail.'
              : 'All edits are logged in the audit trail and cannot be deleted.'}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !newValue}>
            {saving ? 'Saving…' : isPaired ? 'Save pair' : 'Save edit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Linear Regression Mini-Chart ───────────────────────────────────────────────

function LinearRegressionChart({
  corrections,
  slope,
  intercept,
  rSquared,
}: {
  corrections: CorrectionRow[];
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
}) {
  const valid = corrections.filter(c => c.original_value != null);
  if (valid.length < 3 || slope == null || intercept == null) return null;

  const W = 480, H = 108, PX = 8, PY = 10;

  const ys      = valid.map(c => c.original_value!);
  const corrYs  = valid.filter(c => c.corrected_value != null).map(c => c.corrected_value!);
  const allVals = [...ys, ...corrYs,
    slope * 0 + intercept,
    slope * (valid.length - 1) + intercept,
  ];
  const minY   = Math.min(...allVals);
  const maxY   = Math.max(...allVals);
  const rangeY = maxY - minY || 1;
  const n      = valid.length;

  const toX = (i: number) => PX + (i / Math.max(n - 1, 1)) * (W - 2 * PX);
  const toY = (v: number) => PY + (1 - (v - minY) / rangeY) * (H - 2 * PY);

  const regY0 = slope * 0 + intercept;
  const regYN = slope * (n - 1) + intercept;

  return (
    <div className="rounded border bg-card overflow-hidden">
      <div className="text-[10px] text-muted-foreground px-3 pt-2 pb-0 font-semibold uppercase tracking-wide flex items-center justify-between">
        <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-primary" /> Linear Regression Fit</span>
        {rSquared != null && (
          <span className="font-mono text-[10px]">R² = <span className="text-primary font-bold">{rSquared.toFixed(4)}</span></span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full" style={{ height: 90 }}>
        {/* Gridlines */}
        {[0.25, 0.5, 0.75].map(t => (
          <line key={t}
            x1={PX} y1={PY + t * (H - 2 * PY)}
            x2={W - PX} y2={PY + t * (H - 2 * PY)}
            stroke="currentColor" strokeWidth={0.4} opacity={0.12}
          />
        ))}
        {/* OLS regression line */}
        <line
          x1={toX(0)} y1={toY(regY0)}
          x2={toX(n - 1)} y2={toY(regYN)}
          stroke="hsl(var(--primary))" strokeWidth={1.8}
          strokeDasharray="6 3" opacity={0.85}
        />
        {/* Normal data points */}
        {valid.map((c, i) =>
          !c.is_outlier ? (
            <circle key={c.reading_id}
              cx={toX(i)} cy={toY(c.original_value!)}
              r={2} fill="currentColor" opacity={0.35}
            />
          ) : null
        )}
        {/* Outlier + correction pairs */}
        {valid.map((c, i) =>
          c.is_outlier ? (
            <g key={c.reading_id}>
              {c.corrected_value != null && (
                <line
                  x1={toX(i)} y1={toY(c.original_value!)}
                  x2={toX(i)} y2={toY(c.corrected_value)}
                  stroke="#ef4444" strokeWidth={1} opacity={0.4} strokeDasharray="2 1"
                />
              )}
              <circle cx={toX(i)} cy={toY(c.original_value!)} r={4} fill="#ef4444" opacity={0.85} />
              {c.corrected_value != null && (
                <circle cx={toX(i)} cy={toY(c.corrected_value)} r={3.5} fill="rgb(20 184 166)" stroke="white" strokeWidth={1.2} />
              )}
            </g>
          ) : null
        )}
      </svg>
      <div className="flex items-center gap-4 px-3 pb-2 text-[10px] text-muted-foreground border-t mt-0 pt-1.5">
        <span className="flex items-center gap-1.5">
          <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeDasharray="5 3"/></svg>
          OLS line (slope={slope.toFixed(3)}/day)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-red-500 opacity-85" /> Outlier
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{background:'rgb(20 184 166)'}} /> Corrected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-current opacity-35" /> Normal
        </span>
      </div>
    </div>
  );
}

// ── Regression Results Detail ──────────────────────────────────────────────────

function RegressionDetail({
  result, canEdit, onRefresh,
}: { result: RegressionResult; canEdit: boolean; onRefresh: () => void }) {
  const { session, isAdmin, roles } = useAuth();
  const [applying, setApplying]     = useState(false);
  const [retracting, setRetracting] = useState(false);
  const [expanded, setExpanded]     = useState(false);
  const [applyingOne, setApplyingOne]           = useState<string | null>(null);
  const [individuallyApplied, setIndividuallyApplied] = useState<Set<string>>(new Set());
  const [insertingGaps, setInsertingGaps] = useState(false);
  const [gapsInserted,  setGapsInserted]  = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // Separate gap-fill pseudo-rows from real outlier corrections
  const gapFillRows = result.corrections.filter(c => c.reading_id.startsWith(GAP_FILL_PREFIX));
  const outliers    = result.corrections.filter(c => c.is_outlier && !c.reading_id.startsWith(GAP_FILL_PREFIX));

  const userRole = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');

  // ── Entity & plant name lookups (no DB schema changes needed) ─────────────
  const entityCfgRD = ENTITY_CONFIG[result.source_table];

  // Try to pull entity FK from gap fill meta first (already encoded, free)
  const gapMeta: GapFillMeta | null = (() => {
    if (!gapFillRows.length) return null;
    try { return JSON.parse(gapFillRows[0].note.replace('[gap-fill] ', '')); } catch { return null; }
  })();

  // Fallback: reading_id of the first real (non-gap) correction row
  const firstRealCorrId = result.corrections.find(
    c => !c.reading_id.startsWith(GAP_FILL_PREFIX),
  )?.reading_id ?? null;

  /** Resolves to the display name of the entity (well / locator / meter / train) */
  const { data: entityName } = useQuery({
    queryKey: ['reg-entity-name', result.result_id, result.source_table],
    queryFn: async (): Promise<string | null> => {
      if (!entityCfgRD) return null;

      // 1. Try gap meta first (fastest — already in memory)
      let fkVal = gapMeta?.entity_fk_val ?? null;

      // 2. Fall back to fetching the FK from the source row
      if (!fkVal && firstRealCorrId) {
        const { data } = await (supabase.from(result.source_table as never) as any)
          .select(entityCfgRD.fkColumn)
          .eq('id', firstRealCorrId)
          .maybeSingle();
        fkVal = data?.[entityCfgRD.fkColumn] ? String(data[entityCfgRD.fkColumn]) : null;
      }

      if (!fkVal) return null;

      const { data: entityRow } = await (supabase.from(entityCfgRD.lookupTable as never) as any)
        .select(entityCfgRD.selectCols)
        .eq('id', fkVal)
        .maybeSingle();

      return entityRow ? entityCfgRD.labelFn(entityRow as Record<string, unknown>) : null;
    },
    enabled: !!entityCfgRD,
    staleTime: 300_000,
  });

  /** Plant display name */
  const { data: plantName } = useQuery({
    queryKey: ['reg-plant-name', result.plant_id],
    queryFn: async (): Promise<string | null> => {
      if (!result.plant_id) return null;
      const { data } = await supabase
        .from('plants')
        .select('id, name')
        .eq('id', result.plant_id)
        .maybeSingle();
      return data?.name ? String(data.name) : null;
    },
    enabled: !!result.plant_id,
    staleTime: 300_000,
  });

  /** Map of entity FK → display name for gap fill rows (may span multiple entities) */
  const { data: gapEntityNames } = useQuery({
    queryKey: ['reg-gap-entity-names', result.result_id, result.source_table],
    queryFn: async (): Promise<Record<string, string>> => {
      if (!entityCfgRD || !gapFillRows.length) return {};

      // Collect unique FK values from gap fill meta
      const fkVals = new Set<string>();
      gapFillRows.forEach(g => {
        try {
          const m: GapFillMeta = JSON.parse(g.note.replace('[gap-fill] ', ''));
          if (m.entity_fk_val) fkVals.add(m.entity_fk_val);
        } catch { /* skip */ }
      });

      if (!fkVals.size) return {};

      const { data: rows } = await (supabase.from(entityCfgRD.lookupTable as never) as any)
        .select(entityCfgRD.selectCols)
        .in('id', [...fkVals]);

      const map: Record<string, string> = {};
      (rows ?? []).forEach((r: Record<string, unknown>) => {
        map[String(r.id)] = entityCfgRD.labelFn(r);
      });
      return map;
    },
    enabled: !!entityCfgRD && gapFillRows.length > 0,
    staleTime: 300_000,
  });

  // ── Insert gap-fill rows into the source table ─────────────────────────────
  const handleInsertGaps = async () => {
    if (!gapFillRows.length) return;
    setInsertingGaps(true);
    try {
      const rows = gapFillRows.map(g => {
        const rawMeta = g.note.replace('[gap-fill] ', '');
        const meta: GapFillMeta = JSON.parse(rawMeta);
        const row: Record<string, unknown> = {
          reading_datetime: g.reading_datetime,
          [result.column_name]: g.corrected_value,
        };
        if (meta.plant_id) row.plant_id = meta.plant_id;
        if (meta.entity_fk_col && meta.entity_fk_val) {
          row[meta.entity_fk_col] = meta.entity_fk_val;
        }
        if (!TABLES_WITHOUT_NORM_STATUS.has(result.source_table)) {
          row.norm_status = 'normal';
        }
        return row;
      });

      const { data: inserted, error: insertErr } = await (supabase.from(result.source_table as never) as any)
        .insert(rows)
        .select('id');
      if (insertErr) throw new Error(insertErr.message);

      // Log each inserted row to reading_normalizations
      if (inserted?.length) {
        const normRows = (inserted as { id: string }[]).map((ins, idx) => ({
          source_table:   result.source_table,
          source_id:      ins.id,
          action:         'gap-fill',
          original_value: null,
          adjusted_value: gapFillRows[idx]?.corrected_value ?? null,
          note:           `Gap-fill interpolated (result_id=${result.result_id})`,
          performed_by:   session?.user?.id ?? null,
          performed_role: userRole,
          retractable:    false,
        }));
        await (supabase.from('reading_normalizations' as never) as any).insert(normRows);
      }

      setGapsInserted(true);
      toast.success(`${gapFillRows.length} missing date(s) inserted`);
      onRefresh();
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Insert gaps failed');
    } finally {
      setInsertingGaps(false);
    }
  };

  // ── Apply a single correction row ──────────────────────────────────────────
  const handleApplyOne = async (correction: CorrectionRow) => {
    if (result.status === 'retracted') return;
    if (individuallyApplied.has(correction.reading_id)) return;
    setApplyingOne(correction.reading_id);
    try {
      const hasNormStatus = !TABLES_WITHOUT_NORM_STATUS.has(result.source_table);
      const updatePayload: Record<string, unknown> = { [result.column_name]: correction.corrected_value };
      if (hasNormStatus) updatePayload.norm_status = 'normalized';

      await (supabase.from(result.source_table as never) as any)
        .update(updatePayload)
        .eq('id', correction.reading_id);

      await (supabase.from('reading_normalizations' as never) as any).insert({
        source_table:   result.source_table,
        source_id:      correction.reading_id,
        action:         'normalize',
        original_value: correction.original_value,
        adjusted_value: correction.corrected_value,
        note:           correction.note || `Individual regression correction (result_id=${result.result_id})`,
        performed_by:   session?.user?.id ?? null,
        performed_role: userRole,
        retractable:    true,
      });

      setIndividuallyApplied(prev => new Set([...prev, correction.reading_id]));
      toast.success('Correction applied');
      onRefresh();
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Apply failed');
    } finally {
      setApplyingOne(null);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      // Fetch full row (corrections may be truncated in list view)
      const { data: row, error: fetchErr } = await supabase
        .from('regression_results')
        .select('*')
        .eq('id', result.result_id)
        .maybeSingle();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? 'Result not found');
      if (row.status !== 'pending') throw new Error(`Result is '${row.status}' — can only apply pending results`);

      // RACE-CONDITION FIX (D6): the status check above reads a snapshot that
      // can go stale if two admins click Apply at nearly the same time — both
      // would pass the check and both would apply corrections, doubling the
      // reading_normalizations audit rows and re-writing already-corrected
      // values. Claim the result with a conditional UPDATE (only succeeds if
      // status is still 'pending') before doing any other writes, so exactly
      // one caller proceeds even under concurrent clicks.
      const { data: claimed, error: claimErr } = await supabase
        .from('regression_results')
        .update({ status: 'applied' })
        .eq('id', result.result_id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (claimErr) throw new Error(claimErr.message);
      if (!claimed) throw new Error('This result was already applied or retracted by someone else — refresh and try again.');

      const toApply: CorrectionRow[] = ((row.corrections ?? []) as unknown as CorrectionRow[]).filter(
        (c: CorrectionRow) => c.is_outlier && c.corrected_value != null,
      );

      // Update norm_status AND write the corrected column value to the source row.
      // Previously only norm_status was set, leaving the raw (bad) value in place so
      // Dashboard / TrendChart continued to read it and show spikes.
      const hasNormStatus = !TABLES_WITHOUT_NORM_STATUS.has(row.source_table);

      // For ro_train_readings.permeate_meter corrections: collect all affected train IDs
      // so we can run a full cascade recalculation once all writes are done.
      const trainsToRecalculate = new Set<string>();

      for (const c of toApply) {
        const updatePayload: Record<string, unknown> = {
          [row.column_name]: c.corrected_value,
        };
        if (hasNormStatus) updatePayload.norm_status = 'normalized';

        await (supabase.from(row.source_table as never) as any)
          .update(updatePayload)
          .eq('id', c.reading_id);

        // Queue affected train for full delta cascade after all values are written
        if (row.source_table === 'ro_train_readings' && row.column_name === 'permeate_meter') {
          try {
            const { data: thisRow } = await (supabase.from('ro_train_readings_clean' as any) as any)
              .select('train_id')
              .eq('id', c.reading_id)
              .maybeSingle();
            if (thisRow?.train_id) trainsToRecalculate.add(String(thisRow.train_id));
          } catch { /* non-critical */ }
        }
      }

      // Full cascade delta recalculation for every affected train.
      // This handles is_meter_replacement rows (delta=0), insertions in the middle,
      // and any chain of rows whose baseline shifted due to the correction.
      for (const tid of trainsToRecalculate) {
        await recalculateTrainDeltas(tid);
      }

      // Insert reading_normalizations rows
      if (toApply.length > 0) {
        const normRows = toApply.map((c: CorrectionRow) => ({
          source_table:   row.source_table,
          source_id:      c.reading_id,
          action:         'normalize',
          original_value: c.original_value,
          adjusted_value: c.corrected_value,
          note:           c.note || `Regression correction (result_id=${result.result_id})`,
          performed_by:   session?.user?.id ?? null,
          performed_role: userRole,
          retractable:    true,
        }));
        await (supabase.from('reading_normalizations' as never) as any).insert(normRows);
      }

      // Status was already flipped to 'applied' by the atomic claim above —
      // no further status write needed here.

      toast.success(`Applied ${toApply.length} correction(s)`);
      onRefresh();
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const handleRetract = async () => {
    setRetracting(true);
    try {
      const { data: row, error: fetchErr } = await supabase
        .from('regression_results')
        .select('*')
        .eq('id', result.result_id)
        .maybeSingle();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? 'Result not found');
      if (row.status !== 'applied') throw new Error(`Result is '${row.status}' — can only retract applied results`);

      // RACE-CONDITION FIX (D6): same compare-and-swap pattern as handleApply
      // — claim the result before doing any other writes so two concurrent
      // retract clicks can't both proceed.
      const { data: claimed, error: claimErr } = await supabase
        .from('regression_results')
        .update({ status: 'retracted' })
        .eq('id', result.result_id)
        .eq('status', 'applied')
        .select('id')
        .maybeSingle();
      if (claimErr) throw new Error(claimErr.message);
      if (!claimed) throw new Error('This result was already retracted or is no longer applied — refresh and try again.');

      const toRetract: CorrectionRow[] = ((row.corrections ?? []) as unknown as CorrectionRow[]).filter(
        (c: CorrectionRow) => c.is_outlier,
      );

      // DATA-INTEGRITY FIX (D2): retract previously only flipped norm_status
      // to 'retracted' and left the regression-corrected value permanently
      // in the source row — "retracted" implied reversibility that never
      // actually happened. Now restore original_value back onto the source
      // column, matching what was actually captured at correction time.
      const hasNormStatusR = !TABLES_WITHOUT_NORM_STATUS.has(row.source_table);
      for (const c of toRetract) {
        const restorePayload: Record<string, unknown> = {};
        if (c.original_value != null) restorePayload[row.column_name] = c.original_value;
        if (hasNormStatusR) restorePayload.norm_status = 'retracted';
        if (Object.keys(restorePayload).length === 0) continue;
        await (supabase.from(row.source_table as never) as any)
          .update(restorePayload)
          .eq('id', c.reading_id);
      }

      if (toRetract.length > 0) {
        const normRows = toRetract.map((c: CorrectionRow) => ({
          source_table:   row.source_table,
          source_id:      c.reading_id,
          action:         'retract',
          original_value: c.original_value,
          adjusted_value: null,
          note:           `Retracted regression correction (result_id=${result.result_id})`,
          performed_by:   session?.user?.id ?? null,
          performed_role: userRole,
          retractable:    false,
        }));
        await (supabase.from('reading_normalizations' as never) as any).insert(normRows);
      }

      // Status was already flipped to 'retracted' by the atomic claim above.

      toast.success(`Retracted ${toRetract.length} correction(s)`);
      onRefresh();
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Retract failed');
    } finally {
      setRetracting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex flex-col min-w-0 gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <TrendingUp className="h-4 w-4 text-primary shrink-0" />
            <span className="font-medium text-sm truncate">
              {TABLE_LABELS[result.source_table] ?? result.source_table} ·{' '}
              <span className="font-mono">{result.column_name}</span>
            </span>
            <StatusBadge status={result.status} />
          </div>
          {/* Plant + entity name subtitle */}
          {(plantName || entityName) && (
            <div className="flex items-center gap-1.5 pl-6 text-[11px] text-muted-foreground">
              {plantName && (
                <span className="inline-flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  {plantName}
                </span>
              )}
              {plantName && entityName && <span className="opacity-40">·</span>}
              {entityName && (
                <span className="font-medium text-foreground/70">{entityName}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && result.status === 'pending' && outliers.length > 0 && (
            <Button size="sm" onClick={handleApply} disabled={applying} className="h-7 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {applying ? 'Applying…' : `Apply (${outliers.length})`}
            </Button>
          )}
          {canEdit && gapFillRows.length > 0 && !gapsInserted && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleInsertGaps}
              disabled={insertingGaps}
              className="h-7 text-xs border-blue-400 text-blue-700 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              <Zap className="h-3 w-3 mr-1" />
              {insertingGaps ? 'Inserting…' : `Insert gaps (${gapFillRows.length})`}
            </Button>
          )}
          {gapsInserted && (
            <span className="inline-flex items-center gap-1 text-[11px] text-blue-600 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" /> Gaps inserted
            </span>
          )}
          {canEdit && result.status === 'applied' && (
            <Button size="sm" variant="outline" onClick={handleRetract} disabled={retracting} className="h-7 text-xs">
              <Undo2 className="h-3 w-3 mr-1" />
              {retracting ? 'Retracting…' : 'Retract'}
            </Button>
          )}
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 bg-destructive/10 border border-destructive/30 rounded-md px-2 py-1">
              <span className="text-[11px] text-destructive font-medium whitespace-nowrap">Delete?</span>
              <button
                className="text-[11px] font-semibold text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await supabase.from('regression_results').delete().eq('id', result.result_id);
                    onRefresh();
                  } catch {
                    setDeleting(false);
                    setConfirmDelete(false);
                  }
                }}
              >
                {deleting ? 'Deleting…' : 'Yes'}
              </button>
              <span className="text-muted-foreground/50 text-[11px]">·</span>
              <button
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setConfirmDelete(false)}
              >
                No
              </button>
            </div>
          ) : (
            <button
              className="text-muted-foreground hover:text-destructive transition-colors"
              title="Delete this regression result"
              onClick={() => setConfirmDelete(true)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-6 divide-x text-center px-0 py-2 border-b">
        {(() => {
          const resetCount = outliers.filter(c => c.note?.includes('reset anomaly')).length;
          const olsCount   = outliers.length - resetCount;
          return [
            { label: 'Rows',    value: result.row_count, color: result.truncated ? 'text-amber-600' : '' },
            { label: 'Resets',  value: resetCount,         color: resetCount  > 0 ? 'text-orange-600' : '' },
            { label: 'OLS',     value: olsCount,           color: olsCount    > 0 ? 'text-amber-600'  : '' },
            { label: 'Gaps',    value: gapFillRows.length, color: gapFillRows.length > 0 ? 'text-blue-600' : '' },
            { label: 'R²',      value: result.r_squared != null ? result.r_squared.toFixed(4) : '—', color: '' },
            { label: 'Run at',  value: result.created_at ? format(parseISO(result.created_at), 'MMM d HH:mm') : '—', color: '' },
          ];
        })().map(s => (
          <div key={s.label} className="px-3 py-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
            <div className={cn('font-mono text-sm font-semibold', s.color)}>{s.value}</div>
          </div>
        ))}
      </div>
      {result.truncated && (
        <div className="px-4 py-2 text-xs bg-amber-50 text-amber-800 border-b flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          This date range has more readings than the analysis row cap — only the earliest {result.row_count.toLocaleString()} rows were analyzed. Narrow the date range to cover the rest.
        </div>
      )}

      {/* Linear regression chart — always visible */}
      {result.slope != null && result.corrections.length > 0 && (
        <div className="px-3 py-2 border-b">
          <LinearRegressionChart
            corrections={result.corrections}
            slope={result.slope}
            intercept={result.intercept}
            rSquared={result.r_squared}
          />
        </div>
      )}

      {/* Corrections table (collapsible) */}
      {expanded && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Original</TableHead>
                <TableHead className="text-right">Corrected</TableHead>
                <TableHead className="text-right">Z-score</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Note</TableHead>
                {canEdit && result.status !== 'retracted' && (
                  <TableHead className="text-center w-24">Apply</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...outliers].sort((a, b) => b.reading_datetime.localeCompare(a.reading_datetime)).map(c => {
                const isReset    = c.note?.includes('reset anomaly');
                const isApplied  = individuallyApplied.has(c.reading_id) || result.status === 'applied';
                const isApplying = applyingOne === c.reading_id;
                return (
                  <TableRow key={c.reading_id} className={cn('text-xs', isReset && 'bg-orange-50/60 dark:bg-orange-950/20')}>
                    <TableCell className="font-mono">{c.reading_datetime?.slice(0, 16).replace('T', ' ')}</TableCell>
                    <TableCell className="text-right font-mono text-danger">
                      {c.original_value?.toFixed(2) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-teal-600">
                      {c.corrected_value?.toFixed(2) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.z_score != null ? (
                        <span className={Math.abs(c.z_score) > 3 ? 'text-danger font-bold' : ''}>
                          {c.z_score.toFixed(2)}
                        </span>
                      ) : <span className="text-muted-foreground text-[10px]">n/a</span>}
                    </TableCell>
                    <TableCell>
                      {isReset ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300">
                          <Zap className="h-2.5 w-2.5" /> Reset
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-amber-100 text-amber-800 border-amber-300">
                          OLS
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate" title={c.note}>{c.note}</TableCell>
                    {canEdit && result.status !== 'retracted' && (
                      <TableCell className="text-center">
                        {isApplied ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-teal-600">
                            <CheckCircle2 className="h-3 w-3" /> Applied
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2 border-teal-400 text-teal-700 hover:bg-teal-50"
                            disabled={isApplying || !!applyingOne}
                            onClick={() => handleApplyOne(c)}
                          >
                            {isApplying ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Apply'}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {outliers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit && result.status !== 'retracted' ? 7 : 6} className="text-center text-xs text-muted-foreground py-4">
                    No anomalies detected in this run.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Gap Fills table (collapsible, shown when gaps exist) */}
      {expanded && gapFillRows.length > 0 && (
        <div className="border-t">
          <div className="px-4 py-2 bg-blue-50/60 dark:bg-blue-950/20 border-b flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
              Missing Dates — Linear Interpolation ({gapFillRows.length} row{gapFillRows.length !== 1 ? 's' : ''})
            </span>
            <span className="text-[10px] text-blue-600/70 dark:text-blue-500">
              Click "Insert gaps" in the header to write these into the source table.
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead>Missing Date</TableHead>
                  {entityCfgRD && <TableHead>{entityCfgRD.filterLabel}</TableHead>}
                  <TableHead className="text-right">Interpolated Value</TableHead>
                  <TableHead>Boundary From</TableHead>
                  <TableHead>Boundary To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gapFillRows.map(g => {
                  let meta: GapFillMeta | null = null;
                  try { meta = JSON.parse(g.note.replace('[gap-fill] ', '')); } catch { /* skip */ }
                  const entityLabel = meta?.entity_fk_val
                    ? (gapEntityNames?.[meta.entity_fk_val] ?? meta.entity_fk_val)
                    : null;
                  return (
                    <TableRow key={g.reading_id} className="text-xs bg-blue-50/30 dark:bg-blue-950/10">
                      <TableCell className="font-mono">{g.reading_datetime?.slice(0, 10)}</TableCell>
                      {entityCfgRD && (
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {entityLabel ?? <span className="opacity-40">—</span>}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono text-blue-700 dark:text-blue-400 font-semibold">
                        {g.corrected_value?.toFixed(3) ?? '—'}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground font-mono">
                        {meta ? `${meta.from_date} = ${meta.from_value}` : '—'}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground font-mono">
                        {meta ? `${meta.to_date} = ${meta.to_value}` : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Raw Data Table ─────────────────────────────────────────────────────────────

function RawDataTable({
  sourceTable, column, plantId, entityId, dateFrom, dateTo, canEdit, onEdit,
}: {
  sourceTable: string; column: string; plantId: string; entityId: string; dateFrom: string; dateTo: string;
  canEdit: boolean;
  onEdit: (reading: RawReading) => void;
}) {
  const entityCfgRT = ENTITY_CONFIG[sourceTable];
  const { data: entityRows } = useQuery({
    queryKey: ['entity-name-lookup', sourceTable],
    queryFn: async () => {
      if (!entityCfgRT) return [];
      const { data, error } = await (supabase.from(entityCfgRT.lookupTable as never) as any)
        .select(entityCfgRT.selectCols)
        .order('name');
      if (error) console.warn('[entity-name-lookup] error for', entityCfgRT.lookupTable, error.message);
      return (data ?? []) as Record<string, unknown>[];
    },
    enabled: !!entityCfgRT,
    staleTime: 60_000,
  });
  const entityLookup: Record<string, string> = Object.fromEntries(
    (entityRows ?? []).map(r => [String(r.id), entityCfgRT ? entityCfgRT.labelFn(r) : String(r.id)])
  );

  const hasNormStatus = !TABLES_WITHOUT_NORM_STATUS.has(sourceTable);

  // When viewing current_reading or previous_reading, show both columns together
  const isPairedColRT = (column === 'current_reading' || column === 'previous_reading')
    && PAIRED_COL_TABLES.has(sourceTable);
  const pairedColRT = column === 'current_reading' ? 'previous_reading' : 'current_reading';

  const { data, isLoading } = useQuery({
    queryKey: ['raw-readings', sourceTable, column, plantId, entityId, dateFrom, dateTo],
    queryFn: async () => {
      const entityCfg = ENTITY_CONFIG[sourceTable];
      const selectCols = [
        'id',
        'reading_datetime',
        column,
        isPairedColRT ? pairedColRT : null,
        hasNormStatus ? 'norm_status' : null,
        'plant_id',
        entityCfg ? entityCfg.fkColumn : null,
      ].filter(Boolean).join(',');

      let q = supabase.from(sourceTable.replace('well_readings','well_readings_clean').replace('locator_readings','locator_readings_clean') as any)
        .select(selectCols)
        .order('reading_datetime', { ascending: false })
        .limit(200);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      if (entityCfg && entityId && entityId !== 'all') q = q.eq(entityCfg.fkColumn as never, entityId);
      if (dateFrom) q = q.gte('reading_datetime', dateFrom);
      if (dateTo)   q = q.lte('reading_datetime', dateTo + 'T23:59:59');
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data || []).map((r: any) => ({ ...r, _sourceTable: sourceTable })) as RawReading[];
    },
    enabled: !!sourceTable && !!column,
  });

  // Delta: group rows by entity FK so we never diff across different trains/wells/etc.
  const deltaMap = new Map<string, number | null>();
  if (data) {
    const entityFk = ENTITY_CONFIG[sourceTable]?.fkColumn;
    if (entityFk) {
      const groups = new Map<string, RawReading[]>();
      data.forEach(row => {
        const key = String(row[entityFk] ?? '__none__');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      });
      groups.forEach(rows => {
        rows.forEach((row, i) => {
          const curr = row[column] as number | null;
          const prev = i + 1 < rows.length ? (rows[i + 1][column] as number | null) : null;
          deltaMap.set(row.id, curr != null && prev != null ? curr - prev : null);
        });
      });
    } else {
      data.forEach((row, i) => {
        const curr = row[column] as number | null;
        const prev = i + 1 < data.length ? (data[i + 1][column] as number | null) : null;
        deltaMap.set(row.id, curr != null && prev != null ? curr - prev : null);
      });
    }
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading raw data…</div>;
  if (!data?.length) return <div className="py-8 text-center text-sm text-muted-foreground">No readings found for this selection.</div>;

  const showTime = TABLES_WITH_TIME.has(sourceTable);

  return (
    <div className="overflow-auto max-h-[560px] rounded border">
      <Table className="text-[11px]">
        <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
          <TableRow className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <TableHead className={cn('whitespace-nowrap', showTime ? 'w-[118px]' : 'w-[88px]')}>
              {showTime ? 'Date & Time' : 'Date'}
            </TableHead>
            {ENTITY_CONFIG[sourceTable] && <TableHead className="whitespace-nowrap">{ENTITY_CONFIG[sourceTable].filterLabel}</TableHead>}
            {/* When in paired mode show current_reading then previous_reading side by side */}
            {isPairedColRT ? (
              <>
                <TableHead className="text-right whitespace-nowrap">current_reading</TableHead>
                <TableHead className="text-right whitespace-nowrap">previous_reading</TableHead>
              </>
            ) : (
              <TableHead className="text-right whitespace-nowrap">{column}</TableHead>
            )}
            <TableHead className="text-right whitespace-nowrap">Δ Delta</TableHead>
            {hasNormStatus && <TableHead className="whitespace-nowrap">Status</TableHead>}
            {canEdit && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(row => {
            const delta = deltaMap.get(row.id) ?? null;
            const { date, time } = fmtDatetime(String(row.reading_datetime || ''), showTime);
            return (
              <TableRow key={row.id} className={cn(hasNormStatus && row.norm_status === 'erroneous' && 'bg-amber-50/60 dark:bg-amber-950/20')}>
                <TableCell className="font-mono whitespace-nowrap py-1.5">
                  {showTime ? (
                    <span className="flex flex-col leading-tight">
                      <span className="text-[11px]">{date}</span>
                      <span className="text-[10px] text-muted-foreground">{time}</span>
                    </span>
                  ) : (
                    <span className="text-[11px]">{date}</span>
                  )}
                </TableCell>
                {ENTITY_CONFIG[sourceTable] && (
                  <TableCell className="text-[11px] text-muted-foreground font-mono py-1.5">
                    {entityLookup[row[ENTITY_CONFIG[sourceTable].fkColumn] as string] ?? <span className="text-muted-foreground/50">—</span>}
                  </TableCell>
                )}
                {/* Paired columns — current_reading then previous_reading */}
                {isPairedColRT ? (
                  <>
                    <TableCell className="text-right font-mono text-[11px] py-1.5">
                      {row['current_reading'] != null ? Number(row['current_reading']).toFixed(3) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] py-1.5 text-muted-foreground">
                      {row['previous_reading'] != null ? Number(row['previous_reading']).toFixed(3) : <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                  </>
                ) : (
                  <TableCell className="text-right font-mono text-[11px] py-1.5">
                    {row[column] != null ? Number(row[column]).toFixed(3) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                )}
                <TableCell className="text-right font-mono text-[11px] py-1.5">
                  {delta != null ? (
                    <span className={cn(
                      delta > 0  && 'text-teal-600',
                      delta < 0  && 'text-danger',
                      delta === 0 && 'text-muted-foreground',
                    )}>
                      {delta > 0 ? '+' : ''}{delta.toFixed(3)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                {hasNormStatus && <TableCell className="py-1.5"><NormBadge status={row.norm_status} /></TableCell>}
                {canEdit && (
                  <TableCell className="py-1.5">
                    <button
                      className="text-muted-foreground hover:text-primary transition-colors"
                      title="Edit raw value"
                      onClick={() => onEdit(row)}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Audit Log Tab — reads raw_edit_log via Supabase ────────────────────────────

function AuditLogTab({ sourceTable }: { sourceTable: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['raw-edit-log', sourceTable],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('raw_edit_log')
        .select('*')
        .eq('source_table', sourceTable)
        .order('edited_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return { log: (data ?? []) as Array<Record<string, unknown>> };
    },
    enabled: !!sourceTable,
    retry: false,
    throwOnError: false,
  });

  const rows = data?.log ?? [];

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading audit log…</div>;
  if (isError)   return (
    <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Audit log unavailable — run the <code className="font-mono">20260515_supabase_only_and_data_analysis.sql</code> migration in Supabase to create the <code className="font-mono">raw_edit_log</code> table.
    </div>
  );
  if (!rows.length) return <div className="py-8 text-center text-sm text-muted-foreground">No edits recorded yet.</div>;

  return (
    <div className="overflow-auto max-h-[400px] rounded border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow className="text-[11px]">
            <TableHead>Edited at</TableHead>
            <TableHead>Column</TableHead>
            <TableHead className="text-right">Old</TableHead>
            <TableHead className="text-right">New</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} className="text-xs">
              <TableCell className="font-mono">{String(r.edited_at ?? '').slice(0, 16)}</TableCell>
              <TableCell className="font-mono">{String(r.column_name ?? '')}</TableCell>
              <TableCell className="text-right font-mono text-danger">{r.old_value != null ? Number(r.old_value).toFixed(3) : '—'}</TableCell>
              <TableCell className="text-right font-mono text-teal-600">{r.new_value != null ? Number(r.new_value).toFixed(3) : '—'}</TableCell>
              <TableCell><Badge variant="outline" className="text-[10px]">{String(r.edited_role ?? '')}</Badge></TableCell>
              <TableCell className="text-muted-foreground max-w-[180px] truncate">{String(r.note ?? '')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Normalization Audit Tab ────────────────────────────────────────────────────

function NormalizationAuditTab({ sourceTable }: { sourceTable: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['norm-audit', sourceTable],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_normalizations')
        .select('*')
        .eq('source_table', sourceTable)
        .order('performed_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!sourceTable,
  });

  const rows = data ?? [];

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!rows.length) return <div className="py-8 text-center text-sm text-muted-foreground">No normalization records for this table.</div>;

  const actionCfg = {
    tag:       { emoji: '⚠️', cls: 'text-amber-700  bg-amber-50  border-amber-300  dark:bg-amber-950/30 dark:text-amber-300' },
    normalize: { emoji: '🔄', cls: 'text-teal-700   bg-teal-50   border-teal-300   dark:bg-teal-950/30  dark:text-teal-300'  },
    retract:   { emoji: '⏪', cls: 'text-muted-foreground bg-muted border-border' },
  } as const;

  return (
    <div className="overflow-auto max-h-[400px] rounded border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow className="text-[11px]">
            <TableHead>Date</TableHead>
            <TableHead>Action</TableHead>
            <TableHead className="text-right">Original</TableHead>
            <TableHead className="text-right">Adjusted</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r: Record<string, unknown>) => {
            const cfg = actionCfg[r.action as keyof typeof actionCfg] ?? actionCfg.retract;
            return (
              <TableRow key={r.id as string} className="text-xs">
                <TableCell className="font-mono">{String(r.performed_at ?? '').slice(0, 16)}</TableCell>
                <TableCell>
                  <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border', cfg.cls)}>
                    {cfg.emoji} {r.action as string}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-danger">
                  {r.original_value != null ? Number(r.original_value).toFixed(3) : '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-teal-600">
                  {r.adjusted_value != null ? Number(r.adjusted_value).toFixed(3) : '—'}
                </TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{String(r.performed_role ?? '')}</Badge></TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate">{String(r.note ?? '')}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DataAnalysis() {
  const { isAdmin, isDataAnalyst, isManager, session, roles } = useAuth();
  const qc = useQueryClient();

  // ── Universal plant selection — initialize from global store ─────────────
  const selectedPlantId    = useAppStore(s => s.selectedPlantId);
  const setSelectedPlantId = useAppStore(s => s.setSelectedPlantId);

  // ── Persisted filter state — survives navigation away and back ───────────
  // Each filter value is read from sessionStorage on mount and written on change.
  const SS_KEY = 'da:filters';
  const loadFilters = () => {
    try {
      const raw = sessionStorage.getItem(SS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };
  const saveFilters = useCallback((patch: Record<string, string>) => {
    try {
      const prev = loadFilters();
      sessionStorage.setItem(SS_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch { /* quota */ }
  }, []);

  const saved = useRef(loadFilters());

  const [sourceTable, _setSourceTable] = useState<string>(saved.current.sourceTable ?? 'well_readings');
  const [column, _setColumn]           = useState<string>(saved.current.column       ?? 'daily_volume');
  const [plantId, _setPlantId]         = useState<string>(saved.current.plantId      ?? (selectedPlantId ?? 'all'));
  const [entityId, _setEntityId]       = useState<string>(saved.current.entityId     ?? 'all');
  const [powerSource, _setPowerSource] = useState<string>(saved.current.powerSource  ?? 'all');
  const [dateFrom, _setDateFrom]       = useState<string>(saved.current.dateFrom     ?? '');
  const [dateTo, _setDateTo]           = useState<string>(saved.current.dateTo       ?? '');

  const setSourceTable = (v: string) => { _setSourceTable(v); saveFilters({ sourceTable: v }); };
  const setColumn      = (v: string) => { _setColumn(v);      saveFilters({ column: v });      };
  const setPlantId     = (v: string) => { _setPlantId(v);     saveFilters({ plantId: v });     };
  const setEntityId    = (v: string) => { _setEntityId(v);    saveFilters({ entityId: v });    };
  const setPowerSource = (v: string) => { _setPowerSource(v); saveFilters({ powerSource: v }); };
  const setDateFrom    = (v: string) => { _setDateFrom(v);    saveFilters({ dateFrom: v });    };
  const setDateTo      = (v: string) => { _setDateTo(v);      saveFilters({ dateTo: v });      };

  // Keep local plantId in sync ONLY when user changes plant in the top bar
  // and has NOT already chosen a plant on this page (avoid overwriting their selection)
  const lastGlobalPlant = useRef(selectedPlantId);
  useEffect(() => {
    if (selectedPlantId !== lastGlobalPlant.current) {
      lastGlobalPlant.current = selectedPlantId;
      // Only sync if the page's plantId still matches the old global value
      // i.e. the user hasn't independently changed it here
      setPlantId(selectedPlantId ?? 'all');
      setEntityId('all');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlantId]);

  // Edit dialog
  const [editReading, setEditReading] = useState<RawReading | null>(null);

  // Regression state
  const [running, setRunning] = useState(false);

  const canEdit = isAdmin || isDataAnalyst;
  const canView = canEdit || isManager;

  // Plants list
  const { data: plantsData } = useQuery({
    queryKey: ['plants-list'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id,name').order('name');
      return (data ?? []) as Plant[];
    },
  });
  const plants = plantsData ?? [];

  // Entity drill-down options
  const entityCfgMain = ENTITY_CONFIG[sourceTable];
  const { data: entityOptionsData, isFetching: entityFetching } = useQuery({
    queryKey: ['entity-options-main', sourceTable, plantId],
    queryFn: async () => {
      if (!entityCfgMain) return [];
      let q = (supabase.from(entityCfgMain.lookupTable as never) as any)
        .select(entityCfgMain.selectCols)
        .order('name');
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      q = q.eq('status', 'Active');
      const { data, error } = await q;
      if (error) {
        let fbq = (supabase.from(entityCfgMain.lookupTable as never) as any)
          .select(entityCfgMain.selectCols)
          .order('name');
        if (plantId && plantId !== 'all') fbq = fbq.eq('plant_id', plantId);
        const { data: fallback } = await fbq;
        return (fallback ?? []) as Record<string, unknown>[];
      }
      return (data ?? []) as Record<string, unknown>[];
    },
    enabled: !!entityCfgMain,
    staleTime: 30_000,
  });
  const entityOptions: EntityOption[] = (entityOptionsData ?? []).map(r => ({
    id:    String(r.id),
    label: entityCfgMain ? entityCfgMain.labelFn(r) : String(r.id),
  }));

  // ── Regression results — fetched directly from Supabase ──────────────────
  const { data: resultsData, refetch: refetchResults, isError: resultsError } = useQuery({
    queryKey: ['regression-results', sourceTable, plantId, entityId],
    queryFn: async () => {
      let q = supabase.from('regression_results')
        .select('*')
        .eq('source_table', sourceTable)
        .order('created_at', { ascending: false })
        .limit(20);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      // Map DB `id` → `result_id`; compute outlier_count from corrections JSONB
      const results: RegressionResult[] = (data ?? []).map((r: Record<string, unknown>) => {
        const corrections = (r.corrections ?? []) as CorrectionRow[];
        return {
          result_id:     String(r.id),
          source_table:  String(r.source_table),
          column_name:   String(r.column_name),
          plant_id:      r.plant_id ? String(r.plant_id) : null,
          row_count:     Number(r.row_count ?? 0),
          truncated:     Boolean(r.truncated),
          outlier_count: corrections.filter(c => c.is_outlier).length,
          r_squared:     r.r_squared != null ? Number(r.r_squared) : null,
          slope:         r.slope     != null ? Number(r.slope)     : null,
          intercept:     r.intercept != null ? Number(r.intercept) : null,
          corrections,
          status:        (r.status as RegressionResult['status']) ?? 'pending',
          created_at:    String(r.created_at ?? ''),
        };
      });
      return { results };
    },
    enabled: canView,
    staleTime: 15_000,
    retry: false,
    throwOnError: false,
  });
  const regressionResults = resultsData?.results ?? [];

  // When source table changes, reset column and entity
  const handleTableChange = (t: string) => {
    setSourceTable(t);
    setColumn(SOURCE_TABLES[t]?.[0] ?? '');
    setEntityId('all');
    setPowerSource('all');
  };

  // When plant changes here, also update the global store so other pages stay in sync
  const handlePlantChange = (p: string) => {
    setPlantId(p);
    setEntityId('all');
    setSelectedPlantId(p === 'all' ? null : p);
  };

  // ── Run Regression — OLS computed client-side, result saved to Supabase ──
  const handleRunRegression = async () => {
    if (!sourceTable || !column) { toast.error('Select a table and column first'); return; }
    setRunning(true);
    try {
      const entityCfg = ENTITY_CONFIG[sourceTable];
      const hasNorm   = !TABLES_WITHOUT_NORM_STATUS.has(sourceTable);
      const selectCols = [
        'id', 'reading_datetime', column,
        hasNorm ? 'norm_status' : null,
        'plant_id',
        entityCfg ? entityCfg.fkColumn : null,
        // Fetch is_meter_replacement for ro_train_readings so regression can warn when
        // it encounters rows whose delta is overridden to 0 by that flag.
        (sourceTable === 'ro_train_readings') ? 'is_meter_replacement' : null,
      ].filter(Boolean).join(',');

      let q = supabase
        .from(sourceTable.replace('well_readings','well_readings_clean').replace('locator_readings','locator_readings_clean') as any)
        .select(selectCols)
        .order('reading_datetime', { ascending: true })
        .limit(ROW_LIMIT + 1);
      if (plantId && plantId !== 'all') q = q.eq('plant_id', plantId);
      if (entityCfg && entityId && entityId !== 'all') q = q.eq(entityCfg.fkColumn as never, entityId);
      if (dateFrom) q = q.gte('reading_datetime', dateFrom);
      if (dateTo)   q = q.lte('reading_datetime', dateTo + 'T23:59:59');

      const { data: fetchedRows, error: readErr } = await q;
      if (readErr) throw new Error(readErr.message);

      // DATA-INTEGRITY FIX: the date range can contain more rows than the
      // regression cap — previously this was applied silently, so a
      // multi-year dataset would run on an arbitrary chronological slice
      // with no indication to the analyst. Detect it by fetching one row
      // past the cap, trim back to ROW_LIMIT for the actual fit, and
      // surface it in both the toast and the stored result.
      const truncated = (fetchedRows?.length ?? 0) > ROW_LIMIT;
      const readings = truncated ? (fetchedRows as any[]).slice(0, ROW_LIMIT) : fetchedRows;

      const { corrections, stats, resetCount } = runOLS((readings || []) as unknown as RawReading[], column);

      // ── Gap detection — find missing dates and interpolate values ─────────
      const gapFills     = detectGaps((readings || []) as unknown as RawReading[], column, sourceTable);
      const allCorrections = [...corrections, ...gapFills];

      // ── Meter-replacement warning ─────────────────────────────────────────
      // For ro_train_readings.permeate_meter: rows with is_meter_replacement=true
      // have their permeate_meter_delta forced to 0 by an override rule in the
      // operator log.  Correcting permeate_meter via regression fixes the
      // cumulative reading but the delta will STAY at 0 until the replacement
      // flag is unchecked — at which point a full cascade recalculation runs.
      // Surface this as a visible warning in each correction note so the analyst
      // knows the override is active before applying.
      if (sourceTable === 'ro_train_readings') {
        const replIds = new Set(
          ((readings || []) as any[])
            .filter((r: any) => r.is_meter_replacement)
            .map((r: any) => String(r.id)),
        );
        if (replIds.size > 0) {
          corrections.forEach(c => {
            if (replIds.has(c.reading_id)) {
              const warning =
                '⚠️ Meter replacement flag is active on this row — ' +
                'permeate_meter_delta will remain 0 even after correcting the meter value. ' +
                'Uncheck the replacement flag in the Operator Log to trigger a full delta recalculation.';
              c.note = c.note ? `${warning} | ${c.note}` : warning;
            }
          });
        }
      }
      const resultId    = crypto.randomUUID();
      const outlierCount = corrections.filter(c => c.is_outlier).length;
      const userRole    = isAdmin ? 'Admin' : (roles.find(r => r === 'Data Analyst') ?? 'Data Analyst');

      const doc = {
        id:           resultId,
        source_table: sourceTable,
        column_name:  column,
        plant_id:     (plantId && plantId !== 'all') ? plantId : null,
        date_from:    dateFrom || null,
        date_to:      dateTo   || null,
        created_by:   session?.user?.id ?? null,
        created_role: userRole,
        row_count:    (readings || []).length,
        truncated,
        r_squared:    stats.r_squared,
        slope:        stats.slope,
        intercept:    stats.intercept,
        corrections:  allCorrections,
        status:       'pending',
      };

      const { error: insertErr } = await supabase
        .from('regression_results')
        .insert(doc as any);
      if (insertErr) throw new Error(insertErr.message);

      const resetMsg = resetCount > 0 ? `, ${resetCount} reset anomaly fix(es)` : '';
      const olsMsg   = (outlierCount - resetCount) > 0 ? `, ${outlierCount - resetCount} statistical outlier(s)` : '';
      const gapMsg   = gapFills.length > 0 ? `, ${gapFills.length} gap date(s) to fill` : '';
      toast.success(`Analysis complete — ${outlierCount} anomaly(s) found${resetMsg}${olsMsg}${gapMsg}`);
      if (truncated) {
        toast.warning(
          `This date range has more than ${ROW_LIMIT.toLocaleString()} readings — the analysis only covers the earliest ${ROW_LIMIT.toLocaleString()} rows. Narrow the date range to analyze the rest.`,
          { duration: 10000 },
        );
      }
      refetchResults();
      qc.invalidateQueries({ queryKey: ['raw-readings'] });
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Regression failed');
    } finally {
      setRunning(false);
    }
  };

  if (!canView) {
    return (
      <Card className="p-8 text-center space-y-2 max-w-md mx-auto mt-12">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          Data Analysis & Review requires Admin, Data Analyst, or Manager role.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in" data-testid="data-analysis-page">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          Data Analysis & Review
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Centralised regression analysis, raw-value editing, and normalization.
          All other pages are read-only — edits happen here only.
        </p>
      </div>

      {/* Role notice for Manager */}
      {isManager && !canEdit && (
        <div className="flex items-center gap-2 rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          You have read-only access. Admin or Data Analyst role is required to edit or run regression.
        </div>
      )}

      {/* ── Filter bar ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 items-end">
            {/* Source table */}
            <div className="space-y-1">
              <Label className="text-xs">Source table</Label>
              <Select value={sourceTable} onValueChange={handleTableChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TABLE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Column */}
            <div className="space-y-1">
              <Label className="text-xs">Column</Label>
              <Select value={column} onValueChange={setColumn}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(SOURCE_TABLES[sourceTable] ?? []).map(c => (
                    <SelectItem key={c} value={c} className="text-xs font-mono">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Plant — mirrors the universal plant selection from the top bar */}
            <div className="space-y-1">
              <Label className="text-xs">Plant</Label>
              <Select value={plantId} onValueChange={handlePlantChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All plants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs text-muted-foreground">All plants</SelectItem>
                  {plants.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity drill-down — for tables with sub-entities (wells, locators, trains, meters) */}
            {entityCfgMain && (
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  {entityCfgMain.filterLabel}
                  {entityOptions.length > 0 && (
                    <span className="ml-1 rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground font-normal">
                      {entityOptions.length}
                    </span>
                  )}
                </Label>
                <Select
                  value={entityId}
                  onValueChange={setEntityId}
                  disabled={entityFetching && entityOptions.length === 0}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue
                      placeholder={
                        entityFetching
                          ? `Loading ${entityCfgMain.filterLabel}s…`
                          : `All ${entityCfgMain.filterLabel}s`
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs text-muted-foreground">
                      All {entityCfgMain.filterLabel}s
                      {entityOptions.length > 0 && (
                        <span className="ml-1.5 text-[10px] opacity-60">({entityOptions.length})</span>
                      )}
                    </SelectItem>
                    {entityOptions.length === 0 && !entityFetching && (
                      <div className="px-3 py-2 text-[11px] text-muted-foreground italic">
                        No {entityCfgMain.filterLabel.toLowerCase()}s found
                        {plantId !== 'all' ? ' for this plant' : ''}
                      </div>
                    )}
                    {entityOptions.map(opt => (
                      <SelectItem key={opt.id} value={opt.id} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Power Source filter — only for Grid & Solar Readings (plant-level, no sub-entity FK) */}
            {sourceTable === 'power_readings' && (
              <div className="space-y-1">
                <Label className="text-xs">Source</Label>
                <Select value={powerSource} onValueChange={v => {
                  setPowerSource(v);
                  // Auto-select the first matching column when filtering by source
                  const opt = POWER_SOURCE_OPTIONS.find(o => o.value === v);
                  if (opt && 'columns' in opt && opt.columns.length > 0) {
                    setColumn(opt.columns[0]);
                  } else if (v === 'all') {
                    setColumn(SOURCE_TABLES['power_readings'][0]);
                  }
                }}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POWER_SOURCE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date from */}
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" className="h-8 text-xs" value={dateFrom}
                onChange={e => setDateFrom(e.target.value)} />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" className="h-8 text-xs" value={dateTo}
                onChange={e => setDateTo(e.target.value)} />
            </div>

            {/* Run button */}
            {canEdit && (
              <Button onClick={handleRunRegression} disabled={running} className="h-8 text-xs mt-auto">
                {running ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Running…</>
                ) : (
                  <><Play className="h-3.5 w-3.5 mr-1.5" />Run Regression</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Two-table layout ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* LEFT — Raw Data Table (wider) */}
        <Card className="xl:col-span-3">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              Raw Data
              <Badge variant="outline" className="text-[10px] ml-1">Read-only source</Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Latest 200 rows for <span className="font-mono font-medium">{column}</span>.
              {canEdit && ' Click ✏ to edit a value (logged to audit trail).'}
            </p>
          </CardHeader>
          <CardContent className="px-3 pb-4">
            <RawDataTable
              sourceTable={sourceTable}
              column={column}
              plantId={plantId}
              entityId={entityId}
              dateFrom={dateFrom}
              dateTo={dateTo}
              canEdit={canEdit}
              onEdit={r => setEditReading(r)}
            />
          </CardContent>
        </Card>

        {/* RIGHT — Regression / Correction Table (narrower) */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Regression Results
              <Badge variant="outline" className="text-[10px] ml-1">corrected_value + notes</Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Each run shows outlier readings, corrected values (OLS projection), and Z-scores.
              {canEdit && ' Apply to write corrections; Retract to undo.'}
            </p>
          </CardHeader>
          <CardContent className="px-3 pb-4 space-y-3">
            {resultsError && (
              <div className="flex flex-col gap-1.5 rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2.5 text-[11px]">
                <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Regression results table not found
                </div>
                <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                  The <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">regression_results</code> and{' '}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">raw_edit_log</code> tables
                  have not been created in Supabase yet. Run the migration to fix this:
                </p>
                <p className="text-amber-700 dark:text-amber-400 font-mono text-[10px] bg-amber-100 dark:bg-amber-900 px-2 py-1 rounded">
                  supabase/migrations/20260515_supabase_only_and_data_analysis.sql
                </p>
                <p className="text-amber-600 dark:text-amber-500">
                  Go to <strong>Supabase Dashboard → SQL Editor</strong> and run the migration file above.
                </p>
              </div>
            )}
            {!resultsError && regressionResults.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {canEdit
                  ? 'No regression runs yet. Select a column and click "Run Regression".'
                  : 'No regression runs found for this selection.'}
              </div>
            )}
            {regressionResults.map(r => (
              <RegressionDetail
                key={r.result_id}
                result={r}
                canEdit={canEdit}
                onRefresh={() => { refetchResults(); qc.invalidateQueries({ queryKey: ['raw-readings'] }); }}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── Audit / Normalization tabs ── */}
      <Card>
        <Tabs defaultValue="audit">
          <CardHeader className="pb-0 pt-4 px-4">
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="audit" className="text-xs">
                <Clock className="h-3 w-3 mr-1" /> Edit Audit
              </TabsTrigger>
              <TabsTrigger value="normalization" className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" /> Flagged Readings
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent className="pt-3 px-3 pb-4">
            <TabsContent value="audit" className="mt-0">
              <AuditLogTab sourceTable={sourceTable} />
            </TabsContent>
            <TabsContent value="normalization" className="mt-0">
              <NormalizationAuditTab sourceTable={sourceTable} />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>

      {/* Edit raw value dialog */}
      <EditRawDialog
        open={!!editReading}
        onClose={() => setEditReading(null)}
        reading={editReading}
        column={column}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['raw-readings'] })}
      />
    </div>
  );
}
