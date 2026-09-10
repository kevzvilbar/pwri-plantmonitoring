/**
 * pages/dataCorrections/types.ts
 *
 * Types and formatting helpers for the Data Corrections domain.
 */
import { format } from 'date-fns';

export type SourceTable = 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';

export type UUID = string;

export interface FlaggedRow {
  id: string;
  source_table: SourceTable;
  entity_id?: string;
  entity_name: string;
  plant_id?: string;
  plant_name: string;
  reading_datetime: string;
  previous_reading: number | null;
  previous_reading_datetime?: string | null;
  previous_operator_username?: string | null;
  current_reading: number;
  daily_volume: number | null;
  recorded_by?: string | null;
  operator_username: string | null;
  norm_status: string;
  flag_reason?: 'backward' | 'unchanged' | 'edited' | 'spike' | string;
  is_backward?: boolean;
  is_unchanged?: boolean;
  anomaly_remark?: {
    text: string;
    tier: 'needs_remark' | 'critical';
    direction?: 'high' | 'low' | null;
    deviation_pct?: number | null;
    flow_rate?: number | null;
    avg_flow_rate?: number | null;
    rate_unit?: string;
    logged_at: string;
    logged_by?: string | null;
  } | null;
  edit_reason?: { text: string; actor_label: string | null; logged_at: string } | null;
  pre_edit_value?: number | null;
  calculated_flow_rate?: number | null;
  avg_flow_rate?: number | null;
  deviation_pct?: number | null;
  deviation_direction?: 'high' | 'low' | null;
  elapsed_hours?: number | null;
  diagnostic_summary?: string | null;
  predecessor?: {
    reading_datetime: string;
    current_reading: number;
    recorded_by: string | null;
  } | null;
}

export interface CorrectionRequest {
  id: string;
  source_table: SourceTable;
  source_id: string;
  entity_name?: string | null;
  plant_name?: string | null;
  original_value: number;
  proposed_value: number;
  reason: string;
  note: string | null;
  status: string;
  submitter_email: string | null;
  created_at: string;
  plant_id?: string;
  entity_type?: string;
  field_name?: string;
  current_value?: number;
  resolution_note?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  requested_by?: string | null;
  requested_at?: string;
}

export interface ChainEntry {
  id: string;
  table_name?: string;
  entity_id?: string;
  reading_datetime: string;
  previous_reading: number | null;
  current_reading: number;
  daily_volume: number | null;
  recorded_by?: string | null;
  is_estimated?: boolean;
  is_meter_replacement?: boolean;
  norm_status: string;
  isFocused?: boolean;
}

export interface OperatorStat {
  user_id?: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  plant_id?: string;
  plant_name?: string;
  role?: string | null;
  operator_email?: string;
  total_entries?: number;
  total_readings?: number;
  pending_review?: number;
  retracted?: number;
  backward_readings?: number;
  error_count?: number;
  error_rate?: number;
  error_rate_pct?: number;
  last_entry_at?: string | null;
  last_error_at?: string | null;
}

export const tableLabel: Record<SourceTable, string> = {
  locator_readings: 'Locator',
  well_readings: 'Well',
  product_meter_readings: 'Product Meter',
  ro_train_readings: 'RO Train',
};

export const fmtNum = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDt = (s: string) => format(new Date(s), 'dd MMM yy HH:mm');

export const PENDING_FETCH_LIMIT_PER_TABLE = 1000;

export function guessMeterMax(previousReading: number | null): number {
  if (previousReading == null || !Number.isFinite(previousReading)) return 99999.99;
  const digits = String(Math.floor(Math.abs(previousReading))).length;
  return Math.pow(10, digits) - 0.01;
}

export function parseNumeric(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const clean = val.replace(/,/g, '').trim();
    const num = Number(clean);
    return isNaN(num) ? null : num;
  }
  return null;
}

export function extractOldValueFromChanges(changes: unknown): number | null {
  if (!changes || typeof changes !== 'object') return null;
  const changesObj = changes as Record<string, unknown>;
  const priorityKeys = [
    'current_reading', 'raw_meter_reading', 'meter_reading_kwh',
    'power_meter_reading', 'value', 'feed_meter_reading',
    'permeate_meter_reading', 'reject_meter_reading',
    'previous_reading', 'daily_volume',
  ];

  const getOld = (obj: unknown): number | null => {
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    const candidates = [o.old, o.old_value, o.from, o.before, o.previous, o.prev];
    for (const c of candidates) {
      const parsed = parseNumeric(c);
      if (parsed != null) return parsed;
    }
    return null;
  };

  for (const k of priorityKeys) {
    const val = changesObj[k];
    const old = getOld(val);
    if (old != null) return old;
  }
  for (const key of Object.keys(changesObj)) {
    const val = changesObj[key];
    const old = getOld(val);
    if (old != null) return old;
  }
  return null;
}

export const ROLE_DISPLAY_PRIORITY: Record<string, number> = { Admin: 1, 'Data Analyst': 2, Manager: 3 };

export function pickDisplayRole(roles: string[]): string {
  if (!roles.length) return 'Unknown';
  return [...roles].sort((a, b) => (ROLE_DISPLAY_PRIORITY[a] ?? 99) - (ROLE_DISPLAY_PRIORITY[b] ?? 99))[0];
}