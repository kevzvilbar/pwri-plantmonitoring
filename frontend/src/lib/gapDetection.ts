/**
 * lib/gapDetection.ts — scans readings for date gaps and produces
 * interpolated fill rows.
 *
 * Extracted from DataAnalysis.tsx 2026-08-22 (god-component split) — this is
 * a self-contained algorithm with no page/component dependencies, matching
 * where the OLS regression algorithm already lives (regressionCorrection.ts,
 * moved out in an earlier "Phase 1" pass per that module's own header
 * comment). This is effectively Phase 2 of the same cleanup.
 */

import { fmtIsoDate } from '@/lib/format';
import { RATE_COLUMNS, type RawReading, type CorrectionRow } from '@/lib/regressionCorrection';

/** For each source table: which FK column identifies the sub-entity
 *  (well / locator / meter / train) readings belong to, so gaps are never
 *  detected/interpolated across different entities. power_readings has none
 *  (plant-level only). Passed in rather than imported from
 *  dataAnalysis/shared.ts's full ENTITY_CONFIG to keep this module's only
 *  dependency the one field it actually needs. */
export type EntityFkLookup = (sourceTable: string) => string | null;

// Sentinel prefix used to distinguish gap-fill pseudo-rows from real corrections.
// Gap fills are stored inside the same `corrections` JSONB array so no extra DB
// column / migration is required.  Any consumer that only wants real outlier rows
// must filter out entries whose reading_id starts with this prefix.
export const GAP_FILL_PREFIX = '__gap__';

export interface GapFillMeta {
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
export function detectGaps(
  readings: RawReading[],
  column: string,
  sourceTable: string,
  getEntityFkColumn: EntityFkLookup,
): CorrectionRow[] {
  const entityFkCol = getEntityFkColumn(sourceTable);

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

      // Asia/Manila calendar day, not raw UTC — otherwise a reading logged
      // just after Manila midnight gets misread as the previous day here
      // too, which can both mis-detect gaps and place gap-fill rows on the
      // wrong date. Same root cause as EntityHistoryChart.tsx.
      const dateStrA = fmtIsoDate(rowA.reading_datetime);
      const dateStrB = fmtIsoDate(rowB.reading_datetime);
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
