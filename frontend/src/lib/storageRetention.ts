/**
 * storageRetention.ts
 *
 * Client wrapper for the Phase 0 storage-measurement RPCs added by
 * supabase/migrations/20260916000005_reading_storage_report.sql:
 *
 *   fn_reading_storage_report(boolean)  — per-table heap/index/TOAST bytes,
 *                                         row counts, oldest/newest reading,
 *                                         7-day growth, per-index idx_scan
 *   fn_duplicate_index_report()         — schema-wide exact-duplicate indexes
 *
 * WHY THIS EXISTS
 *   Nothing in this app has ever reported its own storage. The retention
 *   decision for ro_train_readings / ro_pretreatment_readings was being argued
 *   from a logging cadence that is wrong by ~24x (both tables take an hourly
 *   reading per train — see submitROReadings.ts' "one per train per hour" check),
 *   so these functions exist to answer "how big, growing how fast, and what is
 *   the free space sitting in duplicate indexes" with real numbers.
 *
 * TYPING NOTE
 *   frontend/src/integrations/supabase/types.ts is generated from the live
 *   schema (`npm run types:gen`) and so does not know these two functions until
 *   they are applied to the project. Rather than weakening the call site with
 *   `any` (which the repo counts as a lint warning — see scripts/check-lint-ceiling.mjs),
 *   this exposes a narrow typed view of `.rpc` and casts the single unknown
 *   result back to the shape declared here.
 */
import { supabase } from '@/integrations/supabase/client';

export interface StorageIndexInfo {
  index: string;
  size: string;
  bytes: number;
  idx_scan: number;
  unique: boolean;
  primary: boolean;
  definition: string;
}

export interface StorageTableInfo {
  table: string;
  total_size: string;
  total_bytes: number;
  heap_bytes: number;
  index_bytes: number;
  toast_bytes: number;
  est_rows: number;
  exact_rows: number | null;
  oldest_reading: string | null;
  newest_reading: string | null;
  rows_last_7d: number;
  avg_row_bytes: number | null;
  projected_bytes_per_day: number | null;
  indexes: StorageIndexInfo[];
}

export interface StorageReport {
  ok: boolean;
  generated_at: string;
  database_size: string;
  database_size_bytes: number;
  exact_counts: boolean;
  tables: StorageTableInfo[];
}

export interface DuplicateIndexRow {
  table_name: string;
  keep_index: string;
  drop_index: string;
  definition: string;
  keep_idx_scan: number;
  drop_idx_scan: number;
  drop_index_bytes: number;
}

/** Narrow, explicitly-typed view of supabase.rpc for functions not yet in types.ts. */
type RpcCaller = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const rpc = supabase.rpc as unknown as RpcCaller;

/**
 * Database storage budget used for the "time until full" projection on the
 * admin Storage & Retention card.
 *
 * PROVISIONAL: this is Supabase's Free-tier database limit, used because the
 * project tier has not been confirmed yet. Pro is 8 GB. The retention decision
 * for these tables depends on knowing which one applies, so change this the
 * moment the tier is confirmed — it feeds daysUntilBytes() below, not just a
 * label.
 */
export const DEFAULT_STORAGE_BUDGET_BYTES = 500 * 1024 * 1024;

/**
 * Per-table storage measurement. `exactCounts` runs a real COUNT(*) per table
 * (a sequential scan on a large table) — leave it off for routine checks and
 * turn it on when the estimate needs to be pinned down.
 */
export async function fetchStorageReport(exactCounts = false): Promise<StorageReport> {
  const { data, error } = await rpc('fn_reading_storage_report', { p_exact_counts: exactCounts });
  if (error) throw new Error(error.message);
  return data as StorageReport;
}

/**
 * Every exact-duplicate index pair in the public schema, with a suggested
 * keep/drop member. Only exact duplicates (same columns, operator classes,
 * collations, sort direction, expression, predicate and uniqueness) are
 * reported — near-duplicates that would need EXPLAIN evidence are not.
 */
export async function fetchDuplicateIndexReport(): Promise<DuplicateIndexRow[]> {
  const { data, error } = await rpc('fn_duplicate_index_report');
  if (error) throw new Error(error.message);
  return (data ?? []) as DuplicateIndexRow[];
}

/** Human-readable byte count for values that arrive as raw numbers. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Reading-table rows added per day, derived from the report's 7-day window.
 * Returns null when the report has no growth data to divide by.
 */
export function rowsPerDay(table: StorageTableInfo): number | null {
  if (!Number.isFinite(table.rows_last_7d)) return null;
  return table.rows_last_7d / 7;
}

/**
 * Projected days until the given table reaches `limitBytes`, at the growth rate
 * measured over the last 7 days. Null when the table is not growing (or the
 * report lacks the numbers), which is what makes "we don't need a retention
 * policy yet" a defensible answer instead of a guess.
 */
export function daysUntilBytes(table: StorageTableInfo, limitBytes: number): number | null {
  const perDay = table.projected_bytes_per_day;
  if (perDay === null || perDay === undefined || perDay <= 0) return null;
  const remaining = limitBytes - table.total_bytes;
  if (remaining <= 0) return 0;
  return Math.round(remaining / perDay);
}