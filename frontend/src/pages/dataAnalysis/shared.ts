/**
 * dataAnalysis/shared.ts — cross-cutting types and constants for the
 * DataAnalysis page's sub-components.
 *
 * Extracted 2026-08-22 (god-component split, DataAnalysis.tsx part of the
 * external review's TrainDetail.tsx/DataAnalysis.tsx/Costs.tsx/
 * PlantTopology.tsx list) — these were all module-level declarations in
 * DataAnalysis.tsx used by more than one of the page's sub-components
 * (EditRawDialog, RegressionDetail, RawDataTable, and the main page itself),
 * so they live here instead of being duplicated or force-imported through
 * one arbitrary "owner" file.
 */

import { fmtIsoDate, fmtTime } from '@/lib/format';

export const SOURCE_TABLES: Record<string, string[]> = {
  well_readings:          ['daily_volume', 'current_reading', 'previous_reading', 'power_meter_reading'],
  locator_readings:       ['daily_volume', 'current_reading', 'previous_reading'],
  product_meter_readings: ['daily_volume', 'current_reading', 'previous_reading'],
  ro_train_readings:      ['permeate_tds', 'permeate_ph', 'turbidity_ntu', 'dp_psi', 'recovery_pct', 'permeate_meter', 'feed_meter', 'reject_meter'],
  power_readings:         ['daily_consumption_kwh', 'meter_reading_kwh', 'daily_solar_kwh', 'daily_grid_kwh'],
};

/** Tables that do not have a norm_status column — skip it in SELECT. */
export const TABLES_WITHOUT_NORM_STATUS = new Set(['power_readings']);

/** All tables show full datetime (YYYY-MM-DD HH:mm). */
export const TABLES_WITH_TIME = new Set(Object.keys(SOURCE_TABLES));

/** Format a reading_datetime string based on whether the table uses time.
 *  Converts to Asia/Manila first — reading_datetime comes back from Supabase
 *  as a UTC ISO timestamp, and displaying it raw (old behavior: strip 'T'/'Z'
 *  and slice) showed the wrong calendar date/time for any reading logged in
 *  the UTC-16:00–23:59 window (Manila 00:00–07:59) — see EntityHistoryChart.tsx
 *  for the same root cause. */
export function fmtDatetime(raw: string, showTime: boolean): { date: string; time?: string } {
  const date = fmtIsoDate(raw);
  if (!showTime) return { date };
  return { date, time: fmtTime(raw) };
}

export const TABLE_LABELS: Record<string, string> = {
  well_readings:          'Well Readings',
  locator_readings:       'Locator Readings',
  product_meter_readings: 'Product Meter Readings',
  ro_train_readings:      'RO Train Readings',
  power_readings:         'Grid & Solar Readings',
};

/** For each source table: which Supabase lookup table + FK column on the readings row.
 *  power_readings is plant-level only (no sub-entity FK); it is intentionally absent here.
 *  Instead, a "Source" filter (Solar / Grid) is provided via POWER_SOURCE_FILTER. */
export const ENTITY_CONFIG: Record<string, {
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
    selectCols:  'id, name, plant_id, status, default_input_mode, is_derived',
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
export const POWER_SOURCE_OPTIONS = [
  { value: 'all',   label: 'All Sources' },
  { value: 'solar', label: 'Solar',       columns: ['daily_solar_kwh'] },
  { value: 'grid',  label: 'Grid',        columns: ['daily_grid_kwh'] },
  { value: 'total', label: 'Total / Meter', columns: ['daily_consumption_kwh', 'meter_reading_kwh'] },
];

export interface RegressionResult {
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
  corrections: import('@/lib/regressionCorrection').CorrectionRow[];
  status: 'pending' | 'applied' | 'retracted';
  created_at: string;
}

export interface Plant { id: string; name: string; }
export interface EntityOption { id: string; label: string; }

// max rows fetched per regression run — see D5 fix. Page-level data-fetching
// concern, kept here even though the rest of the regression algorithm moved
// to lib/regressionCorrection.ts — this isn't part of that algorithm itself.
export const ROW_LIMIT = 2000;

export const PAIRED_COL_TABLES = new Set(['well_readings', 'locator_readings', 'product_meter_readings']);
