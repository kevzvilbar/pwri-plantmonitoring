/**
 * data/queries/corrections.ts — Data correction query functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure query functions for
 * correction workflows. Components wrap them with React Query via
 * the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type SourceTable = 'locator_readings' | 'well_readings' | 'product_meter_readings' | 'ro_train_readings';

export interface FlaggedRow {
  id: string;
  source_table: SourceTable;
  entity_id?: string;
  entity_name: string | null;
  plant_id?: string;
  plant_name: string | null;
  reading_datetime: string;
  previous_reading: number | null;
  current_reading: number;
  daily_volume: number | null;
  recorded_by: string | null;
  operator_username: string | null;
  norm_status: string;
  flag_reason?: 'backward' | 'unchanged' | 'edited' | 'spike' | string;
  is_backward?: boolean;
  is_unchanged?: boolean;
  predecessor?: {
    reading_datetime: string;
    current_reading: number;
    recorded_by: string | null;
  } | null;
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
}

export interface CorrectionRequest {
  id: string;
  source_table: SourceTable;
  source_id: string;
  entity_name: string | null;
  plant_name: string | null;
  original_value: number;
  proposed_value: number;
  reason: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  submitter_email: string | null;
  created_at: string;
  plant_id: string;
  entity_type: string;
  field_name: string;
  current_value: number;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  requested_by: string | null;
  requested_at: string;
}

export interface ChainEntry {
  id: string;
  table_name: string;
  entity_id: string;
  reading_datetime: string;
  previous_reading: number | null;
  current_reading: number;
  daily_volume: number | null;
  recorded_by: string | null;
  is_estimated: boolean;
  is_meter_replacement: boolean;
  norm_status: string;
}

export interface OperatorStat {
  user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  plant_id: string;
  plant_name: string;
  role: string | null;
  error_count: number;
  total_readings: number;
  error_rate: number;
  last_error_at: string | null;
}

/** Fetch all pending review readings across all three source tables */
export async function fetchPending(limit = 1000): Promise<{ rows: FlaggedRow[]; truncated: boolean }> {
  const tables: SourceTable[] = ['locator_readings', 'well_readings', 'product_meter_readings'];
  const results: FlaggedRow[] = [];
  let truncated = false;

  for (const table of tables) {
    const entityCol = table === 'locator_readings' ? 'locator_id'
      : table === 'well_readings' ? 'well_id' : 'meter_id';
    const entityTable = table === 'locator_readings' ? 'locators'
      : table === 'well_readings' ? 'wells' : 'product_meters';

    const { data: rows } = await (supabase
      .from(table as any)
      .select(`id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, ${entityCol}`)
      .eq('norm_status', 'pending_review')
      .order('reading_datetime', { ascending: false })
      .limit(limit) as any);

    if (!rows?.length) continue;
    if (rows.length === limit) truncated = true;

    // Resolve entity names
    const entityIds = [...new Set(rows.map((r: any) => r[entityCol]))].filter(Boolean) as string[];
    const { data: entities } = await (supabase
      .from(entityTable as any)
      .select('id, name')
      .in('id', entityIds) as any);
    const entityMap = Object.fromEntries((entities ?? []).map((e: any) => [e.id, e.name]));

    // Resolve plant names
    const plantIds = [...new Set(rows.map((r: any) => r.plant_id))].filter(Boolean) as string[];
    const { data: plants } = await (supabase
      .from('plants')
      .select('id, name')
      .in('id', plantIds) as any);
    const plantMap = Object.fromEntries((plants ?? []).map((p: any) => [p.id, p.name]));

    // Resolve operator usernames
    const operatorIds = [...new Set(rows.map((r: any) => r.recorded_by))].filter(Boolean) as string[];
    const { data: operators } = await (supabase
      .from('user_profiles')
      .select('id, username')
      .in('id', operatorIds) as any);
    const operatorMap = Object.fromEntries((operators ?? []).map((o: any) => [o.id, o.username]));

    // Predecessors lookup per pending row
    const predecessorMap: Record<string, { reading_datetime: string; current_reading: number; recorded_by: string | null }> = {};
    const predResults = await Promise.all(
      rows.map(async (r: any) => {
        const { data: pRows } = await (supabase
          .from(table as any)
          .select('id, reading_datetime, current_reading, recorded_by')
          .eq(entityCol, r[entityCol])
          .lt('reading_datetime', r.reading_datetime)
          .order('reading_datetime', { ascending: false })
          .limit(1) as any);
        return { rowId: r.id, prev: pRows?.[0] ?? null };
      })
    );
    predResults.forEach(({ rowId, prev }) => { predecessorMap[rowId] = prev; });

    for (const r of rows) {
      const pred = predecessorMap[r.id];
      const currentReading = r.current_reading;
      const previousReading = r.previous_reading;
      const is_backward = previousReading != null && currentReading < previousReading;
      const is_unchanged = previousReading != null && currentReading === previousReading;
      const flag_reason = is_backward ? 'backward' : (is_unchanged ? 'unchanged' : 'edited');

      results.push({
        id: r.id,
        source_table: table,
        entity_id: r[entityCol],
        entity_name: entityMap[r[entityCol]] ?? null,
        plant_id: r.plant_id,
        plant_name: plantMap[r.plant_id] ?? null,
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        current_reading: r.current_reading,
        daily_volume: r.daily_volume,
        norm_status: r.norm_status,
        recorded_by: r.recorded_by,
        operator_username: operatorMap[r.recorded_by] ?? null,
        predecessor: pred ?? null,
        is_backward,
        is_unchanged,
        flag_reason,
        anomaly_remark: null,
        edit_reason: null,
        pre_edit_value: null,
        calculated_flow_rate: null,
        avg_flow_rate: null,
        deviation_pct: null,
        deviation_direction: null,
        elapsed_hours: null,
        diagnostic_summary: null,
      });
    }
  }

  // Sort by reading_datetime desc across all tables
  results.sort((a, b) => b.reading_datetime.localeCompare(a.reading_datetime));

  return { rows: results, truncated };
}

/** Count pending readings for badge */
export async function fetchPendingCount(): Promise<number> {
  const tables: SourceTable[] = ['locator_readings', 'well_readings', 'product_meter_readings'];
  const counts = await Promise.all(
    tables.map((t) =>
      (supabase.from(t as any).select('id', { count: 'exact', head: true }).eq('norm_status', 'pending_review') as any)
    )
  );
  return counts.reduce((sum, r) => sum + (r.count ?? 0), 0);
}

/** Count correction requests pending */
export async function fetchCorrectionRequestsCount(): Promise<number> {
  const { count } = await (supabase
    .from('correction_requests' as any)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending') as any);
  return count ?? 0;
}

/** Count inbox items (negative daily_volume not flagged) */
export async function fetchInboxCount(): Promise<number> {
  const tables: SourceTable[] = ['locator_readings', 'well_readings', 'product_meter_readings'];
  const counts = await Promise.all(
    tables.map((t) =>
      (supabase.from(t as any)
        .select('id', { count: 'exact', head: true })
        .eq('norm_status', 'normal')
        .lt('daily_volume', 0)
        .eq('is_meter_replacement', false) as any)
    )
  );
  return counts.reduce((sum, r) => sum + (r.count ?? 0), 0);
}

/** Fetch correction inbox items */
export async function fetchCorrectionInbox(): Promise<FlaggedRow[]> {
  const tables: SourceTable[] = ['locator_readings', 'well_readings', 'product_meter_readings'];
  const results: FlaggedRow[] = [];

  for (const table of tables) {
    const entityCol = table === 'locator_readings' ? 'locator_id'
      : table === 'well_readings' ? 'well_id' : 'meter_id';
    const entityTable = table === 'locator_readings' ? 'locators'
      : table === 'well_readings' ? 'wells' : 'product_meters';

    const { data: rows } = await (supabase.from(table as any)
      .select(`id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, ${entityCol}`)
      .eq('norm_status', 'normal')
      .lt('daily_volume', 0)
      .eq('is_meter_replacement', false)
      .order('reading_datetime', { ascending: false })
      .limit(500) as any);

    if (!rows?.length) continue;

    const entityIds = [...new Set(rows.map((r: any) => r[entityCol]))].filter(Boolean) as string[];
    const { data: entities } = await (supabase
      .from(entityTable as any)
      .select('id, name')
      .in('id', entityIds) as any);
    const entityMap = Object.fromEntries((entities ?? []).map((e: any) => [e.id, e.name]));

    const plantIds = [...new Set(rows.map((r: any) => r.plant_id))].filter(Boolean) as string[];
    const { data: plants } = await (supabase
      .from('plants')
      .select('id, name')
      .in('id', plantIds) as any);
    const plantMap = Object.fromEntries((plants ?? []).map((p: any) => [p.id, p.name]));

    const operatorIds = [...new Set(rows.map((r: any) => r.recorded_by))].filter(Boolean) as string[];
    const { data: operators } = await (supabase
      .from('user_profiles')
      .select('id, username')
      .in('id', operatorIds) as any);
    const operatorMap = Object.fromEntries((operators ?? []).map((o: any) => [o.id, o.username]));

    for (const r of rows) {
      const currentReading = r.current_reading;
      const previousReading = r.previous_reading;
      const is_backward = previousReading != null && currentReading < previousReading;
      const is_unchanged = previousReading != null && currentReading === previousReading;
      const flag_reason = is_backward ? 'backward' : (is_unchanged ? 'unchanged' : 'edited');

      results.push({
        id: r.id,
        source_table: table,
        entity_id: r[entityCol],
        entity_name: entityMap[r[entityCol]] ?? null,
        plant_id: r.plant_id,
        plant_name: plantMap[r.plant_id] ?? null,
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        current_reading: r.current_reading,
        daily_volume: r.daily_volume,
        norm_status: r.norm_status,
        recorded_by: r.recorded_by,
        operator_username: operatorMap[r.recorded_by] ?? null,
        predecessor: null,
        is_backward,
        is_unchanged,
        flag_reason,
        anomaly_remark: null,
        edit_reason: null,
        pre_edit_value: null,
        calculated_flow_rate: null,
        avg_flow_rate: null,
        deviation_pct: null,
        deviation_direction: null,
        elapsed_hours: null,
        diagnostic_summary: null,
      });
    }
  }

  results.sort((a, b) => b.reading_datetime.localeCompare(a.reading_datetime));
  return results;
}

/** Fetch correction requests */
export async function fetchCorrectionRequests(status?: 'pending' | 'approved' | 'rejected'): Promise<CorrectionRequest[]> {
  let q = supabase.from('correction_requests').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as CorrectionRequest[];
}

/** Fetch edit history (reading_normalizations) */
export async function fetchEditHistory(limit = 200): Promise<any[]> {
  const { data, error } = await supabase
    .from('reading_normalizations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Fetch operator error stats (30-day rolling) */
export async function fetchOperatorStats(): Promise<OperatorStat[]> {
  const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_operator_error_rates_30d');
  if (!rpcError && rpcData) return rpcData as OperatorStat[];
  
  // Fallback
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('reading_normalizations')
    .select('*')
    .gte('created_at', thirtyDaysAgo);
  if (error) throw error;
  
  // Aggregate by operator
  const stats: Record<string, OperatorStat> = {};
  (data ?? []).forEach((r: any) => {
    const key = r.recorded_by;
    if (!key) return;
    if (!stats[key]) {
      stats[key] = {
        user_id: key,
        username: null,
        first_name: null,
        last_name: null,
        plant_id: r.plant_id,
        plant_name: '',
        role: null,
        error_count: 0,
        total_readings: 0,
        error_rate: 0,
        last_error_at: r.created_at,
      };
    }
    stats[key].error_count++;
    stats[key].last_error_at = r.created_at;
  });
  
  // Fetch user details
  const userIds = Object.keys(stats);
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, username, first_name, last_name, plant_assignments')
      .in('id', userIds);
    (profiles ?? []).forEach((p: any) => {
      if (stats[p.id]) {
        stats[p.id].username = p.username;
        stats[p.id].first_name = p.first_name;
        stats[p.id].last_name = p.last_name;
        stats[p.id].plant_id = p.plant_assignments?.[0] ?? stats[p.id].plant_id;
      }
    });
  }
  
  return Object.values(stats);
}

/** Fetch reading chain for an entity */
export async function fetchReadingChain(
  table: SourceTable,
  entityId: string,
  limit = 100
): Promise<ChainEntry[]> {
  const entityCol = table === 'locator_readings' ? 'locator_id'
    : table === 'well_readings' ? 'well_id' : 'meter_id';
  
  const { data, error } = await (supabase
    .from(table as any)
    .select('*')
    .eq(entityCol, entityId)
    .order('reading_datetime', { ascending: false })
    .limit(limit) as any);
  if (error) throw error;
  return (data ?? []) as ChainEntry[];
}

/** Approve a pending reading */
export async function approveReading(
  table: SourceTable,
  id: string,
  reviewerId: string,
  note?: string
): Promise<void> {
  const { error } = await (supabase.from(table as any)
    .update({ norm_status: 'normal', reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), resolution_note: note })
    .eq('id', id) as any);
  if (error) throw error;
}

/** Retract a pending reading */
export async function retractReading(
  table: SourceTable,
  id: string,
  reviewerId: string,
  note?: string
): Promise<void> {
  const { error } = await (supabase.from(table as any)
    .update({ norm_status: 'retracted', reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), resolution_note: note })
    .eq('id', id) as any);
  if (error) throw error;
}

/** Update a reading value with cascade */
export async function updateReadingValue(
  table: SourceTable,
  id: string,
  newValue: number,
  editorId: string,
  reason: string
): Promise<void> {
  const { error } = await (supabase as any).rpc('cascade_reading_correction', {
    p_table: table,
    p_id: id,
    p_new_value: newValue,
    p_editor_id: editorId,
    p_reason: reason,
  });
  if (error) throw error;
}

/** Mark as meter replacement */
export async function markMeterReplacement(
  table: SourceTable,
  id: string,
  editorId: string
): Promise<void> {
  const { error } = await (supabase.from(table as any)
    .update({ is_meter_replacement: true, recorded_by: editorId })
    .eq('id', id) as any);
  if (error) throw error;
}