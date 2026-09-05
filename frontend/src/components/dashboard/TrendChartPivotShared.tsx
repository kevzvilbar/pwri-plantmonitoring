// Extracted from TrendChart.tsx (Phase 1 of pwri-improvement-plan.md).
// Shared by TrendChartTables.tsx (PivotTable/OverviewTable) and
// TrendChartDataSummaryPopup.tsx (DataSummaryPopup). TrendChart.tsx itself
// only uses buildEntityPivot/fillDateRange/fmtDateKey directly — see that
// file for where those three are still called from the main chart.
//
// resolveReadingDelta is not currently called anywhere (verified via repo
// search before this extraction) — kept as-is rather than removed, since
// this pass is a pure structural move with no behavior change. Worth a
// follow-up cleanup pass once test coverage exists to confirm it's safe to
// delete (see pwri-improvement-plan.md Phase 2).

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { sanitizeReadings } from '@/lib/readingSanitizer';

/** Resolve a single reading row → delta volume (m³). */
export function resolveReadingDelta(r: any): number {
  // Priority 1: daily_volume is the operator-entered / backend-cached delta.
  // It is ground truth. Treat 0 as a genuine zero reading (not "missing").
  // This avoids using a stale previous_reading stored in the DB.
  if (r.daily_volume != null) return +r.daily_volume;
  // Priority 2: compute from cumulative meter readings.
  // NOTE: prefer the in-memory lastSeen map from buildEntityPivot (sequential)
  // over the DB-stored previous_reading when possible — see buildEntityPivot.
  if (r.current_reading != null && r.previous_reading != null)
    return +r.current_reading - +r.previous_reading;
  return 0;
}

/**
 * Build a pivot:  dateKey (yyyy-MM-dd) → entityId → summed volume.
 * Readings must already be sorted by reading_datetime asc.
 * Returns the pivot map and the sorted set of unique date keys found.
 */
export function buildEntityPivot(
  readings: any[],
  entityField: string,
  // IDs (e.g. locator_id) whose default_input_mode = 'direct' — current_reading
  // already IS the period's volume for these, so daily_volume/diff math must be
  // skipped. Mirrors EntityHistoryChart.tsx's isDirectMode branch. Safe to pass
  // the same locator-ID set to well/meter pivots too — no ID collision risk.
  directModeIds?: Set<string>,
  minDateKey?: string,
): { pivot: Map<string, Map<string, number>>; dateKeys: string[] } {
  const pivot = new Map<string, Map<string, number>>();
  // Sequential lastSeen: tracks the actual last current_reading per entity so
  // we never rely on a potentially stale previous_reading stored in the DB.
  // Readings must be sorted asc by reading_datetime for this to be correct.
  const lastSeen = new Map<string, number>();

  // Sanitize readings: exclude retracted rows, discard orphan estimates on dates
  // where confirmed human readings exist, and discard non-monotonic backward estimates
  // (skipping monotonicity checks on direct-mode/derived meters like HAMAS).
  const cleanReadings = sanitizeReadings(readings, entityField, directModeIds);

  cleanReadings.forEach((r) => {
    if (r.is_meter_replacement) {
      // Reset sequential tracking on meter replacement so the new meter's
      // first reading doesn't produce a huge delta vs the old meter.
      const entityId = r[entityField] ?? '__';
      lastSeen.delete(entityId);
      return;
    }

    const dateKey  = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
    const entityId = r[entityField] ?? '__';

    let vol: number;
    if (directModeIds?.has(entityId)) {
      // Direct mode: current_reading already IS the period's volume — no
      // diff, no dependence on daily_volume/previous_reading.
      vol = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (lastSeen.has(entityId) && r.current_reading != null) {
      // SELF-HEAL (checked before daily_volume — mirrors the identical fix in
      // TrendChart.tsx's computeEntityDeltas and DataSummaryModal.tsx's
      // computePivotFromReadings(NoCache), all patched together for the
      // Coke/Parkmall Aug 7–10 incident): once a predecessor for this entity
      // has already been walked sequentially within this window, always diff
      // live against it rather than trusting a stored daily_volume/
      // previous_reading.
      vol = +r.current_reading - lastSeen.get(entityId)!;
      lastSeen.set(entityId, +r.current_reading);
    } else if (r.daily_volume != null) {
      // Ground-truth operator/cached delta — no walked predecessor yet
      // (first row for this entity in the window), so this is the correct
      // source: it may legitimately span >1 day if readings were skipped
      // before the window.
      vol = +r.daily_volume;
      // Keep lastSeen in sync so a subsequent null-daily_volume row can delta
      // correctly against this reading.
      if (r.current_reading != null) lastSeen.set(entityId, +r.current_reading);
    } else if (r.current_reading != null) {
      const prev = r.previous_reading != null ? +r.previous_reading : null; // DB fallback (may be stale) — no lastSeen yet, handled above
      vol = prev != null ? +r.current_reading - prev : 0;
      lastSeen.set(entityId, +r.current_reading);
    } else {
      vol = 0;
    }

    if (minDateKey && dateKey < minDateKey) return;
    if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
    pivot.get(dateKey)!.set(entityId, (pivot.get(dateKey)!.get(entityId) ?? 0) + vol);
  });

  const dateKeys = Array.from(pivot.keys()).sort();
  return { pivot, dateKeys };
}

/** Fill every calendar day between startIso and endIso (yyyy-MM-dd strings). */
export function fillDateRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso   + 'T00:00:00');
  while (cur <= end) {
    dates.push(format(cur, 'yyyy-MM-dd'));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Format a yyyy-MM-dd key for display as "MMM d" */
export function fmtDateKey(key: string): string {
  return format(new Date(key + 'T00:00:00'), 'MMM d');
}

export type DSMTab = 'overview' | 'production' | 'consumption' | 'grid-by-meter';

// ─── CSS class helpers (avoids repetition) ──────────────────────────────────
// z-index scheme for the single shared scroll container (see PivotTable/
// OverviewTable in TrendChartTables.tsx — header and body now live in one
// <table> inside one overflow-auto div, header pinned via sticky top-0,
// rather than two separately-scrolling divs that could drift out of sync):
//   z-10 — body's sticky left/right columns (Date, Total), above plain cells
//   z-20 — header's plain sticky-top cells, above the body columns scrolling under them
//   z-30 — header's corner cells (sticky on top *and* left/right at once),
//          above the plain header cells scrolling under them
export const TH = 'px-3 py-2 text-center text-2xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/80 align-bottom sticky top-0 z-20 bg-card/95 backdrop-blur-sm';
export const TH_DATE = 'px-3.5 py-2 text-left text-2xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap border-b border-border/80 sticky left-0 top-0 z-30 bg-card/95 backdrop-blur-sm w-[84px] min-w-[84px]';
export const TH_TOTAL = 'px-3 py-2 text-center text-2xs font-extrabold border-b border-l border-border/80 sticky right-0 top-0 z-30 bg-primary-soft text-primary align-bottom w-[90px] min-w-[90px]';
export const TD = 'px-3 py-2 text-center font-mono tabular-nums text-xs text-foreground/90';
export const TD_TOTAL_ROW = 'px-3 py-2 text-center font-bold font-mono tabular-nums text-xs text-primary bg-primary/5';
export const TD_TOTAL_COL = 'px-3 py-2 text-center font-bold font-mono tabular-nums text-xs text-primary sticky right-0 z-10 border-l border-border/60 bg-primary-soft/40 w-[90px] min-w-[90px]';

export function fmtV(v: number | null | undefined, dec = 2) {
  if (v == null || v === 0) return <span className="text-muted-foreground/40">—</span>;
  return v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ─── Grid-by-meter breakdown (Power Consumption & Energy Mix data summary) ───
//
// Pure computation behind the "Grid by Meter" side table in DataSummaryPopup's
// kWh tab. Mirrors the grid-kWh walk in useTrendChartData.ts (search for
// "Power kWh — priority order") EXACTLY — priority order, replacement-row
// baseline reset, per-meter CT multipliers and the "days with computed total
// <= 0 never accumulate" rule — so the table's Total column is always
// day-for-day identical to the Solar vs Grid table's Grid (kWh) column.
//
// Per-meter attribution is only possible when both the current and previous
// rows carry grid_meter_readings JSONB (priority 1), or when the legacy
// single-meter delta applies (priority 2 → attributed to meter 0). Days that
// fall back to stored daily totals (priorities 3/4) cannot be attributed —
// their residual is parked under the reserved GRID_METER_OTHER_KEY column and
// the component renders an "Other" column only when such days exist.

/** Minimal shape of the power_readings columns the walk needs. */
export interface GridPowerReadingRow {
  plant_id?: string | null;
  reading_datetime: string;
  meter_reading_kwh?: number | null;
  grid_meter_readings?: Record<string, number> | null;
  daily_grid_kwh?: number | null;
  daily_consumption_kwh?: number | null;
  multiplier?: number | null;
  is_meter_replacement?: boolean | null;
  is_estimated?: boolean | null;
}

export interface GridMeterColumn {
  /** Stable key: `${plant_id}#${meterIndex}` (or GRID_METER_OTHER_KEY). */
  key: string;
  label: string;
  title?: string;
}

/** One day's breakdown: per-column kWh (absent key = unknown, not zero). */
export interface GridMeterDayRow {
  dateKey: string; // yyyy-MM-dd
  values: Record<string, number>;
  total: number;
}

export interface GridMeterBreakdown {
  dates: string[]; // yyyy-MM-dd, chronological, only days that accumulated
  columns: GridMeterColumn[];
  byDate: Map<string, GridMeterDayRow>;
  /** True when at least one day carries unattributable (stored-total) kWh. */
  hasUnattributed: boolean;
  multiPlant: boolean;
}

export const GRID_METER_OTHER_KEY = '__other__';

/**
 * Resolves missing grid meter readings for auto-backfilled estimated rows (is_estimated = true)
 * via linear interpolation between the nearest bounding rows for each meter.
 * Mirrors getGridMeterVal in ReadingHistoryDialog.tsx so that history dialogs,
 * summary tables, and trend charts are completely consistent.
 */
export function interpolateMissingGridMeterReadings<T extends GridPowerReadingRow>(
  sortedAscReadings: T[],
): T[] {
  if (!sortedAscReadings || sortedAscReadings.length === 0) return sortedAscReadings;
  if (!sortedAscReadings.some(r => r.is_estimated)) return sortedAscReadings;

  // Group by plant_id so interpolation is strictly within the same plant
  const byPlant = new Map<string, { row: T; index: number }[]>();
  sortedAscReadings.forEach((r, index) => {
    const pid = r.plant_id ?? '__';
    if (!byPlant.has(pid)) byPlant.set(pid, []);
    byPlant.get(pid)!.push({ row: r, index });
  });

  const result = [...sortedAscReadings];

  for (const plantEntries of byPlant.values()) {
    // Find all meter indices that appear in this plant's readings
    const meterIndices = new Set<number>();
    for (const { row } of plantEntries) {
      if (row.grid_meter_readings) {
        for (const k of Object.keys(row.grid_meter_readings)) {
          const mi = parseInt(k, 10);
          if (Number.isFinite(mi)) meterIndices.add(mi);
        }
      }
      if (row.meter_reading_kwh != null) {
        meterIndices.add(0);
      }
    }

    // For each estimated row, interpolate any missing meter index
    for (let i = 0; i < plantEntries.length; i++) {
      const { row: r, index: globalIdx } = plantEntries[i];
      if (!r.is_estimated) continue;

      const rowTime = new Date(r.reading_datetime).getTime();
      if (isNaN(rowTime)) continue;

      let gmrCopy: Record<string, number> | null = r.grid_meter_readings ? { ...r.grid_meter_readings } : null;

      for (const mi of meterIndices) {
        const direct = gmrCopy?.[String(mi)] ?? (mi === 0 ? r.meter_reading_kwh : null);
        if (direct != null && Number.isFinite(+direct)) continue;

        // Search backward (j < i) for nearest earlier row with valid reading for mi
        let earlierVal: number | null = null;
        let earlierTime: number | null = null;
        for (let j = i - 1; j >= 0; j--) {
          const prevR = plantEntries[j].row;
          const v = prevR.grid_meter_readings?.[String(mi)] ?? (mi === 0 ? prevR.meter_reading_kwh : null);
          if (v != null && Number.isFinite(+v)) {
            earlierVal = Number(v);
            earlierTime = new Date(prevR.reading_datetime).getTime();
            break;
          }
        }

        // Search forward (j > i) for nearest later row with valid reading for mi
        let laterVal: number | null = null;
        let laterTime: number | null = null;
        for (let j = i + 1; j < plantEntries.length; j++) {
          const nextR = plantEntries[j].row;
          const v = nextR.grid_meter_readings?.[String(mi)] ?? (mi === 0 ? nextR.meter_reading_kwh : null);
          if (v != null && Number.isFinite(+v)) {
            laterVal = Number(v);
            laterTime = new Date(nextR.reading_datetime).getTime();
            break;
          }
        }

        if (
          earlierVal != null &&
          laterVal != null &&
          earlierTime != null &&
          laterTime != null &&
          laterTime > earlierTime
        ) {
          const fraction = (rowTime - earlierTime) / (laterTime - earlierTime);
          const estVal = Math.round((earlierVal + (laterVal - earlierVal) * fraction) * 10) / 10;
          if (!gmrCopy) gmrCopy = {};
          gmrCopy[String(mi)] = estVal;
        }
      }

      if (gmrCopy) {
        result[globalIdx] = {
          ...r,
          grid_meter_readings: gmrCopy,
          meter_reading_kwh: r.meter_reading_kwh ?? gmrCopy['0'] ?? null,
        };
      }
    }
  }

  return result;
}

export function computeGridMeterBreakdown(
  readings: GridPowerReadingRow[],
  opts: {
    powerConfigMap?: Map<string, number[]>;
    billMultiplierMap?: Map<string, number>;
    plantNames?: Map<string, string>;
    /** plant_id → configured grid meter names + count (plant_power_config). */
    gridMeterMeta?: Map<string, { names: string[]; count: number }>;
    /** Accumulate only readings within [fromMs, toMs] (null = unbounded).
     *  Baselines are still seeded from earlier rows, mirroring the chart. */
    fromMs?: number | null;
    toMs?: number | null;
  } = {},
): GridMeterBreakdown {
  const { powerConfigMap, billMultiplierMap, plantNames, gridMeterMeta, fromMs, toMs } = opts;

  const rawSorted = [...readings].sort(
    (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
  );
  const sorted = interpolateMissingGridMeterReadings(rawSorted);

  // ── Pass 1: plant order (first appearance) + highest meter index seen ──────
  const plantOrder: string[] = [];
  const plantSeen = new Set<string>();
  const plantMaxIdx = new Map<string, number>();
  for (const r of sorted) {
    const pid = r.plant_id ?? '__';
    if (!plantSeen.has(pid)) { plantSeen.add(pid); plantOrder.push(pid); }
    const gmr = r.grid_meter_readings;
    if (gmr) {
      for (const k of Object.keys(gmr)) {
        const mi = parseInt(k, 10);
        if (Number.isFinite(mi)) plantMaxIdx.set(pid, Math.max(plantMaxIdx.get(pid) ?? 0, mi));
      }
    }
  }

  const meterCountFor = (pid: string): number =>
    Math.max(1, gridMeterMeta?.get(pid)?.count ?? 0, (plantMaxIdx.get(pid) ?? -1) + 1);

  const meterLabelFor = (pid: string, mi: number): string => {
    const names = gridMeterMeta?.get(pid)?.names;
    const count = meterCountFor(pid);
    return names?.[mi] || (count === 1 ? 'Grid Meter' : `Grid Meter ${mi + 1}`);
  };

  // ── Pass 2: the delta walk (mirrors useTrendChartData.ts priority order) ───
  const byDate = new Map<string, GridMeterDayRow>();
  const daySort = new Map<string, number>();
  const prevGridMeter = new Map<string, number | null>();
  const prevGridReadings = new Map<string, Record<string, number>>();
  const afterGridRepl = new Set<string>();

  for (const r of sorted) {
    const pid = r.plant_id ?? '__';
    const isMR = !!r.is_meter_replacement;
    const gridCurrent = r.meter_reading_kwh != null ? +r.meter_reading_kwh : null;
    const rGmr = r.grid_meter_readings ?? null;

    if (isMR) {
      // Replacement row: zero this day, reset baselines for the next delta.
      if (gridCurrent != null) prevGridMeter.set(pid, gridCurrent);
      const replBaselines = { ...(prevGridReadings.get(pid) ?? {}) };
      if (rGmr) {
        for (const [k, v] of Object.entries(rGmr)) {
          if (v != null && Number.isFinite(+v)) replBaselines[k] = +v;
        }
      }
      if (gridCurrent != null) replBaselines['0'] = gridCurrent;
      prevGridReadings.set(pid, replBaselines);
      afterGridRepl.add(pid);
      continue;
    }

    let gridKwh = 0;
    const meterDeltas = new Map<string, number>();
    // Per-meter multiplier array: plant_power_config wins, then the row's own
    // scalar multiplier, then the billing multiplier, then 1 — same as chart.
    const multArr: number[] = powerConfigMap?.get(pid) ?? [
      +(r.multiplier ?? 0) > 0 ? +r.multiplier : (billMultiplierMap?.get(pid) ?? 1),
    ];

    if (!afterGridRepl.has(pid)) {
      const pGmr   = prevGridReadings.get(pid) ?? null;
      const pMeter = prevGridMeter.get(pid) ?? null;

      if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
        // Priority 1: multi-meter JSONB delta × per-meter CT multiplier.
        // Diff against the last known baseline for each individual meter.
        for (const k of Object.keys(rGmr)) {
          const mi = parseInt(k, 10);
          if (!Number.isFinite(mi)) continue; // non-numeric keys aren't meters
          const mMult = multArr[mi] ?? multArr[0] ?? 1;
          const currVal = rGmr[k];
          const prevVal = pGmr[k];
          if (currVal != null && prevVal != null) {
            const rawD = (currVal - prevVal) * mMult;
            const d = Math.round(rawD * 1000) / 1000;
            if (d >= 0) {
              gridKwh = Math.round((gridKwh + d) * 1000) / 1000;
              const colKey = `${pid}#${mi}`;
              meterDeltas.set(colKey, Math.round(((meterDeltas.get(colKey) ?? 0) + d) * 1000) / 1000);
            }
          }
        }
      }
      
      if (gridKwh === 0 && pMeter != null && gridCurrent != null) {
        // Priority 2: single-meter legacy delta → attributed to meter 0.
        const rawD = (gridCurrent - pMeter) * (multArr[0] ?? 1);
        const d = Math.round(rawD * 1000) / 1000;
        if (d >= 0) {
          gridKwh = d;
          meterDeltas.set(`${pid}#0`, gridKwh);
        }
      }

      // Priorities 3 & 4: stored daily totals — no per-meter attribution.
      if (gridKwh === 0) {
        if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0)
          gridKwh = +r.daily_grid_kwh;
        else if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0)
          gridKwh = +r.daily_consumption_kwh * (multArr[0] ?? 1);
      }
    }
    afterGridRepl.delete(pid);
    // Baselines update BEFORE the skip checks below — same order as the chart,
    // so a skipped (non-positive / out-of-window) day still seeds the next delta.
    // Persistent per-meter merge: merge newly observed meter readings into the
    // plant's running baseline state so unlogged meters retain their prior baselines.
    if (gridCurrent != null) prevGridMeter.set(pid, gridCurrent);
    const currentBaselines = { ...(prevGridReadings.get(pid) ?? {}) };
    if (rGmr) {
      for (const [k, v] of Object.entries(rGmr)) {
        if (v != null && Number.isFinite(+v)) {
          currentBaselines[k] = +v;
        }
      }
    }
    if (gridCurrent != null && currentBaselines['0'] == null) {
      currentBaselines['0'] = gridCurrent;
    }
    prevGridReadings.set(pid, currentBaselines);

    // Chart parity: only positive totals accumulate. Out-of-window readings
    // contribute no day (but already seeded the baseline above).
    if (gridKwh <= 0) continue;
    const t = new Date(r.reading_datetime).getTime();
    if (fromMs != null && t < fromMs) continue;
    if (toMs != null && t > toMs) continue;

    const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
    let row = byDate.get(dateKey);
    if (!row) {
      row = { dateKey, values: {}, total: 0 };
      byDate.set(dateKey, row);
    }
    const r0 = row;
    daySort.set(dateKey, Math.max(daySort.get(dateKey) ?? 0, t));
    r0.total += gridKwh;
    meterDeltas.forEach((v, k) => { r0.values[k] = (r0.values[k] ?? 0) + v; });
  }

  // ── Pass 3: unattributed residuals + column list ───────────────────────────
  let hasUnattributed = false;
  for (const row of byDate.values()) {
    const known = Object.entries(row.values)
      .filter(([k]) => k !== GRID_METER_OTHER_KEY)
      .reduce((s, [, v]) => s + v, 0);
    const residual = row.total - known;
    if (Math.abs(residual) > 0.05) {
      row.values[GRID_METER_OTHER_KEY] = residual;
      hasUnattributed = true;
    }
  }

  const multiPlant = plantOrder.length > 1;
  const columns: GridMeterColumn[] = [];
  for (const pid of plantOrder) {
    const count = meterCountFor(pid);
    for (let mi = 0; mi < count; mi++) {
      const label = meterLabelFor(pid, mi);
      const plantName = plantNames?.get(pid);
      columns.push(multiPlant
        ? {
            key: `${pid}#${mi}`,
            label: `${(plantName ?? 'Plant').split(' ')[0]} · ${label}`,
            title: `${plantName ?? 'Plant'} — ${label}`,
          }
        : { key: `${pid}#${mi}`, label, title: label });
    }
  }

  return {
    dates: [...byDate.keys()].sort((a, b) => (daySort.get(a) ?? 0) - (daySort.get(b) ?? 0)),
    columns,
    byDate,
    hasUnattributed,
    multiPlant,
  };
}

/** CSV field escaping: quote only when the value contains a comma, quote or newline. */
export function csvField(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Builds the two-section CSV for the kWh Data Summary popup's Export button —
 * one section per on-screen table:
 *
 *   Solar vs Grid      ← the left table (date, solar, grid, total, solar %)
 *   Grid by Meter      ← the right table (date, per-meter columns, [Other], total)
 *
 * Section values mirror each table's display semantics: a metric that renders
 * as "—" on screen (zero/absent) exports as an empty field, and numbers are
 * rounded to 2 decimals (1 for the percent) matching the on-screen precision.
 * Rows are chronological — the same order the popup's other CSV sections use.
 */
export function buildKwhSummaryCsv(
  overviewRows: { date: string; kwh?: number | null; solarKwh?: number | null }[],
  breakdown: GridMeterBreakdown,
  dates: string[],
): string {
  // ── Section 1: Solar vs Grid ────────────────────────────────────────────────
  const s1: string[] = [
    'Solar vs Grid',
    'date,solar_kwh,grid_kwh,total_kwh,solar_pct',
  ];
  for (const r of overviewRows) {
    const solar = +(r.solarKwh ?? 0);
    const grid = +(r.kwh ?? 0);
    const total = solar + grid;
    s1.push([
      csvField(r.date),
      solar !== 0 ? +solar.toFixed(2) : '',
      grid !== 0 ? +grid.toFixed(2) : '',
      total > 0 ? +total.toFixed(2) : '',
      total > 0 && solar > 0 ? +((solar / total) * 100).toFixed(1) : '',
    ].join(','));
  }

  // ── Section 2: Grid by Meter ────────────────────────────────────────────────
  const cols: GridMeterColumn[] = breakdown.hasUnattributed
    ? [...breakdown.columns, { key: GRID_METER_OTHER_KEY, label: 'Other' }]
    : breakdown.columns;
  const s2: string[] = [
    'Grid by Meter',
    ['date', ...cols.map((c) => csvField(c.label)), 'total_kwh'].join(','),
  ];
  for (const dk of dates) {
    const row = breakdown.byDate.get(dk);
    s2.push([
      csvField(fmtDateKey(dk)),
      ...cols.map((c) => {
        const v = row?.values[c.key];
        return v != null ? +v.toFixed(2) : '';
      }),
      row && row.total > 0 ? +row.total.toFixed(2) : '',
    ].join(','));
  }

  return [s1.join('\n'), '', s2.join('\n')].join('\n');
}

const GAP_ENTITY_TYPE_LABEL: Record<'well' | 'locator' | 'ro_train' | 'meter' | 'blending' | 'power', string> = {
  well: 'Well', locator: 'Locator', ro_train: 'RO Train', meter: 'Product Meter', blending: 'Blending Well', power: 'Power',
};
// Underlying table for each entity type — used to resolve plant_id when
// retroactively logging a gap reason from the Data Summary pivot (see
// PivotTable in TrendChartTables.tsx). reading_gap_reasons.plant_id is
// NOT NULL, but locator_readings/well_readings rows don't reliably carry it
// (see useTrendChartQueries.ts's "locator_readings has no plant_id column"
// note), so we look it up directly from the entity's own row instead of
// threading a plant map through every layer between here and TrendChart.tsx.
export const GAP_ENTITY_TABLE: Record<'well' | 'locator' | 'ro_train' | 'meter' | 'blending' | 'power', string> = {
  well: 'wells', locator: 'locators', ro_train: 'ro_trains', meter: 'product_meters', blending: 'wells', power: 'plants',
};
const GAP_DOWN_STATUSES = new Set(['Inactive', 'Offline', 'Maintenance', 'Locked']);

export type GapReasonHit = { category: string; detail: string | null; source: 'gap' | 'status' };

/**
 * Looks up "why is this cell blank" for the Data Summary pivot — checks an
 * explicit per-day reading_gap_reasons entry first, then falls back to
 * whether the entity was Offline/Inactive/Maintenance/Locked (per
 * entity_status_audit_log) on that date.
 */
export function useGapReasonLookup(
  entityType: 'well' | 'locator' | 'ro_train' | 'meter' | 'blending' | 'power' | undefined,
  entities: { id: string; label: string }[],
  _dates: string[],
): {
  getReason: (entityId: string, dateKey: string) => GapReasonHit | null;
  /** Call after writing a new reading_gap_reasons row (see PivotTable's
   *  retroactive logging dialog) so the new icon appears immediately instead
   *  of waiting for this query's next natural refetch. */
  refetchReasons: () => void;
} {
  const queryClient = useQueryClient();
  const entityIds = useMemo(() => entities.map((e) => e.id).sort(), [entities]);
  const entityIdsKey = entityIds.join(',');
  const gapReasonsQueryKey = ['pivot-gap-reasons', entityType, entityIdsKey];

  const { data: gapReasons } = useQuery({
    queryKey: gapReasonsQueryKey,
    enabled: !!entityType && entityIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('entity_type', entityType)
        .in('entity_id', entityIds);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });

  const { data: statusLog } = useQuery({
    queryKey: ['pivot-status-log', entityType, entityIdsKey],
    enabled: !!entityType && entityIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_status_audit_log' as any)
        .select('*')
        .eq('entity_type', GAP_ENTITY_TYPE_LABEL[entityType!])
        .in('entity_id', entityIds)
        .order('timestamp', { ascending: true });
      if (error) return [];
      return (data ?? []) as any[];
    },
  });

  const getReason = useMemo(() => {
    const gapMap = new Map<string, any>();
    (gapReasons ?? []).forEach((g: any) => { gapMap.set(`${g.entity_id}|${g.gap_date}`, g); });

    // Reconstruct Offline/Inactive/Maintenance intervals per entity from the
    // transition log: each "down" transition opens an interval that runs
    // until that entity's next transition (or now, if still ongoing).
    const intervalsByEntity = new Map<string, Array<{ start: number; end: number; category: string | null; detail: string | null }>>();
    const rowsByEntity = new Map<string, any[]>();
    (statusLog ?? []).forEach((row: any) => {
      if (!rowsByEntity.has(row.entity_id)) rowsByEntity.set(row.entity_id, []);
      rowsByEntity.get(row.entity_id)!.push(row);
    });
    rowsByEntity.forEach((rows, entityId) => {
      const intervals: Array<{ start: number; end: number; category: string | null; detail: string | null }> = [];
      rows.forEach((row, i) => {
        if (!GAP_DOWN_STATUSES.has(row.to_status)) return;
        const start = new Date(row.timestamp).getTime();
        const next = rows[i + 1];
        const end = next ? new Date(next.timestamp).getTime() : Date.now();
        intervals.push({ start, end, category: row.reason_category ?? null, detail: row.reason_detail ?? null });
      });
      intervalsByEntity.set(entityId, intervals);
    });

    return (entityId: string, dateKey: string): GapReasonHit | null => {
      const gap = gapMap.get(`${entityId}|${dateKey}`);
      if (gap) return { category: gap.reason_category, detail: gap.reason_detail ?? null, source: 'gap' };

      const intervals = intervalsByEntity.get(entityId);
      if (intervals && intervals.length) {
        const dayStart = new Date(dateKey + 'T00:00:00').getTime();
        const dayEnd = new Date(dateKey + 'T23:59:59').getTime();
        const hit = intervals.find((iv) => iv.start <= dayEnd && iv.end >= dayStart);
        if (hit && hit.category) return { category: hit.category, detail: hit.detail, source: 'status' };
      }
      return null;
    };
  }, [gapReasons, statusLog]);

  const refetchReasons = () => {
    queryClient.invalidateQueries({ queryKey: gapReasonsQueryKey });
  };

  return { getReason, refetchReasons };
}
