/**
 * data/queries/corrections.ts — Data correction query functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure query functions for
 * correction workflows. Components wrap them with React Query via
 * the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import {
  type SourceTable,
  type FlaggedRow,
  type CorrectionRequest,
  type ChainEntry,
  type OperatorStat,
  PENDING_FETCH_LIMIT_PER_TABLE,
  fmtNum,
  extractOldValueFromChanges,
  tableLabel,
} from '@/pages/dataCorrections/types';
import { formatElapsedDuration } from '@/pages/dataCorrections/components/DiagnosticPopover';
import {
  computeRollingAverageRate,
  computeRollingAverageRateFromDeltas,
  type RatePoint,
  type VolumePoint,
} from '@/lib/flowRateGuards';

export type { SourceTable, FlaggedRow, CorrectionRequest, ChainEntry, OperatorStat };

interface GenericReadingRow {
  id: string;
  reading_datetime: string;
  previous_reading: number | null;
  current_reading: number;
  daily_volume: number | null;
  norm_status: string;
  recorded_by: string | null;
  plant_id: string;
  entity_id: string;
}

async function fetchRawPending(table: SourceTable, limit: number): Promise<GenericReadingRow[]> {
  if (table === 'locator_readings') {
    const { data } = await supabase
      .from('locator_readings')
      .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, locator_id')
      .eq('norm_status', 'pending_review')
      .order('reading_datetime', { ascending: false })
      .limit(limit);
    return (data ?? []).map(r => ({
      id: r.id,
      reading_datetime: r.reading_datetime,
      previous_reading: r.previous_reading,
      current_reading: r.current_reading ?? 0,
      daily_volume: r.daily_volume,
      norm_status: r.norm_status ?? 'pending_review',
      recorded_by: r.recorded_by,
      plant_id: r.plant_id,
      entity_id: r.locator_id,
    }));
  }
  if (table === 'well_readings') {
    const { data } = await supabase
      .from('well_readings')
      .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, well_id')
      .eq('norm_status', 'pending_review')
      .order('reading_datetime', { ascending: false })
      .limit(limit);
    return (data ?? []).map(r => ({
      id: r.id,
      reading_datetime: r.reading_datetime,
      previous_reading: r.previous_reading,
      current_reading: r.current_reading ?? 0,
      daily_volume: r.daily_volume,
      norm_status: r.norm_status ?? 'pending_review',
      recorded_by: r.recorded_by,
      plant_id: r.plant_id,
      entity_id: r.well_id,
    }));
  }
  if (table === 'product_meter_readings') {
    const { data } = await supabase
      .from('product_meter_readings')
      .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, meter_id')
      .eq('norm_status', 'pending_review')
      .order('reading_datetime', { ascending: false })
      .limit(limit);
    return (data ?? []).map(r => ({
      id: r.id,
      reading_datetime: r.reading_datetime,
      previous_reading: r.previous_reading,
      current_reading: r.current_reading ?? 0,
      daily_volume: r.daily_volume,
      norm_status: r.norm_status ?? 'pending_review',
      recorded_by: r.recorded_by,
      plant_id: r.plant_id,
      entity_id: r.meter_id,
    }));
  }
  return [];
}

async function fetchPredecessors(
  table: SourceTable,
  rows: GenericReadingRow[],
): Promise<Record<string, { reading_datetime: string; current_reading: number; recorded_by: string | null }>> {
  const map: Record<string, { reading_datetime: string; current_reading: number; recorded_by: string | null }> = {};
  const predResults = await Promise.all(
    rows.map(async (r) => {
      let prev: { reading_datetime: string; current_reading: number; recorded_by: string | null } | null = null;
      if (table === 'locator_readings') {
        const { data } = await supabase
          .from('locator_readings')
          .select('id, reading_datetime, current_reading, recorded_by')
          .eq('locator_id', r.entity_id)
          .lt('reading_datetime', r.reading_datetime)
          .order('reading_datetime', { ascending: false })
          .limit(1);
        prev = data?.[0] ? { reading_datetime: data[0].reading_datetime, current_reading: data[0].current_reading ?? 0, recorded_by: data[0].recorded_by } : null;
      } else if (table === 'well_readings') {
        const { data } = await supabase
          .from('well_readings')
          .select('id, reading_datetime, current_reading, recorded_by')
          .eq('well_id', r.entity_id)
          .lt('reading_datetime', r.reading_datetime)
          .order('reading_datetime', { ascending: false })
          .limit(1);
        prev = data?.[0] ? { reading_datetime: data[0].reading_datetime, current_reading: data[0].current_reading ?? 0, recorded_by: data[0].recorded_by } : null;
      } else if (table === 'product_meter_readings') {
        const { data } = await supabase
          .from('product_meter_readings')
          .select('id, reading_datetime, current_reading, recorded_by')
          .eq('meter_id', r.entity_id)
          .lt('reading_datetime', r.reading_datetime)
          .order('reading_datetime', { ascending: false })
          .limit(1);
        prev = data?.[0] ? { reading_datetime: data[0].reading_datetime, current_reading: data[0].current_reading ?? 0, recorded_by: data[0].recorded_by } : null;
      }
      return { rowId: r.id, prev };
    }),
  );
  for (const p of predResults) {
    if (p.prev) map[p.rowId] = p.prev;
  }
  return map;
}

async function fetchHistoricalBaselines(
  table: SourceTable,
  entityIds: string[],
): Promise<Record<string, number | null>> {
  if (!entityIds.length) return {};
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const sinceIso = twoWeeksAgo.toISOString();

  type HistPoint = { entity_id: string; reading_datetime: string; current_reading: number; daily_volume: number | null };
  let histRows: HistPoint[] = [];

  if (table === 'locator_readings') {
    const { data } = await supabase
      .from('locator_readings')
      .select('locator_id, reading_datetime, daily_volume, current_reading')
      .in('locator_id', entityIds)
      .eq('norm_status', 'normal')
      .gte('reading_datetime', sinceIso)
      .order('reading_datetime', { ascending: true });
    histRows = (data ?? []).map(r => ({
      entity_id: r.locator_id,
      reading_datetime: r.reading_datetime,
      current_reading: r.current_reading,
      daily_volume: r.daily_volume,
    }));
  } else if (table === 'well_readings') {
    const { data } = await supabase
      .from('well_readings')
      .select('well_id, reading_datetime, daily_volume, current_reading')
      .in('well_id', entityIds)
      .eq('norm_status', 'normal')
      .gte('reading_datetime', sinceIso)
      .order('reading_datetime', { ascending: true });
    histRows = (data ?? []).map(r => ({
      entity_id: r.well_id,
      reading_datetime: r.reading_datetime,
      current_reading: r.current_reading ?? 0,
      daily_volume: r.daily_volume,
    }));
  } else if (table === 'product_meter_readings') {
    const { data } = await supabase
      .from('product_meter_readings')
      .select('meter_id, reading_datetime, daily_volume, current_reading')
      .in('meter_id', entityIds)
      .eq('norm_status', 'normal')
      .gte('reading_datetime', sinceIso)
      .order('reading_datetime', { ascending: true });
    histRows = (data ?? []).map(r => ({
      entity_id: r.meter_id,
      reading_datetime: r.reading_datetime,
      current_reading: r.current_reading ?? 0,
      daily_volume: r.daily_volume,
    }));
  }

  const entityHistMap: Record<string, HistPoint[]> = {};
  for (const h of histRows) {
    if (!entityHistMap[h.entity_id]) entityHistMap[h.entity_id] = [];
    entityHistMap[h.entity_id].push(h);
  }

  const entityAvgRateMap: Record<string, number | null> = {};
  for (const eid of entityIds) {
    const eRows = entityHistMap[eid] ?? [];
    if (!eRows.length) {
      entityAvgRateMap[eid] = null;
      continue;
    }
    if (table === 'well_readings') {
      const points: RatePoint[] = eRows.map(er => ({
        value: Number(er.current_reading),
        at: new Date(er.reading_datetime),
      }));
      entityAvgRateMap[eid] = computeRollingAverageRate(points, 7);
    } else {
      const volPoints: VolumePoint[] = eRows
        .filter(er => er.daily_volume != null && !isNaN(Number(er.daily_volume)))
        .map(er => ({
          volume: Number(er.daily_volume),
          at: new Date(er.reading_datetime),
        }));
      entityAvgRateMap[eid] = computeRollingAverageRateFromDeltas(volPoints, 7);
    }
  }
  return entityAvgRateMap;
}

async function fetchEntityNames(table: SourceTable, entityIds: string[]): Promise<Record<string, string>> {
  if (!entityIds.length) return {};
  if (table === 'locator_readings') {
    const { data } = await supabase.from('locators').select('id, name').in('id', entityIds);
    return Object.fromEntries((data ?? []).map(e => [e.id, e.name]));
  }
  if (table === 'well_readings') {
    const { data } = await supabase.from('wells').select('id, name').in('id', entityIds);
    return Object.fromEntries((data ?? []).map(e => [e.id, e.name]));
  }
  if (table === 'product_meter_readings') {
    const { data } = await supabase.from('product_meters').select('id, name').in('id', entityIds);
    return Object.fromEntries((data ?? []).map(e => [e.id, e.name]));
  }
  return {};
}

async function fetchUsernames(userIds: string[]): Promise<Record<string, string>> {
  if (!userIds.length) return {};
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, username, first_name, last_name')
    .in('id', userIds);
  return Object.fromEntries(
    (profiles ?? []).map(p => {
      const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      const display = p.username ? `@${p.username}` : (full || '—');
      return [p.id, display];
    }),
  );
}

async function fetchPlantNames(plantIds: string[]): Promise<Record<string, string>> {
  if (!plantIds.length) return {};
  const { data: plants } = await supabase.from('plants').select('id, name').in('id', plantIds);
  return Object.fromEntries((plants ?? []).map(p => [p.id, p.name]));
}

/** Fetch all pending review readings across all three source tables */
export async function fetchPending(
  limit = PENDING_FETCH_LIMIT_PER_TABLE,
): Promise<{ rows: FlaggedRow[]; truncated: boolean }> {
  const tables: SourceTable[] = ['locator_readings', 'well_readings', 'product_meter_readings'];
  const results: FlaggedRow[] = [];
  let truncated = false;

  for (const table of tables) {
    const rows = await fetchRawPending(table, limit);
    if (!rows.length) continue;
    if (rows.length === limit) truncated = true;

    const rowIds = rows.map(r => r.id);
    const entityIds = [...new Set(rows.map(r => r.entity_id))].filter(Boolean);
    const plantIds = [...new Set(rows.map(r => r.plant_id))].filter(Boolean);

    const [entityMap, plantMap, predecessorMap, entityAvgRateMap] = await Promise.all([
      fetchEntityNames(table, entityIds),
      fetchPlantNames(plantIds),
      fetchPredecessors(table, rows),
      fetchHistoricalBaselines(table, entityIds),
    ]);

    const userIds = [...new Set([
      ...rows.map(r => r.recorded_by).filter((id): id is string => Boolean(id)),
      ...Object.values(predecessorMap).map(p => p.recorded_by).filter((id): id is string => Boolean(id)),
    ])];
    const usernameMap = await fetchUsernames(userIds);

    const { data: remarkRows } = await supabase
      .from('reading_anomaly_remarks')
      .select('record_id, remark_text, tier, direction, deviation_pct, flow_rate, avg_flow_rate, rate_unit, logged_at, logged_by')
      .eq('table_name', table)
      .in('record_id', rowIds)
      .order('logged_at', { ascending: true });

    const remarkMap = (remarkRows ?? []).reduce<Record<string, NonNullable<FlaggedRow['anomaly_remark']>>>((acc, rem) => {
      acc[rem.record_id] = {
        text: rem.remark_text,
        tier: rem.tier as 'needs_remark' | 'critical',
        direction: (rem.direction as 'high' | 'low' | null) ?? null,
        deviation_pct: rem.deviation_pct != null ? Number(rem.deviation_pct) : null,
        flow_rate: rem.flow_rate != null ? Number(rem.flow_rate) : null,
        avg_flow_rate: rem.avg_flow_rate != null ? Number(rem.avg_flow_rate) : null,
        rate_unit: rem.rate_unit ?? undefined,
        logged_at: rem.logged_at,
        logged_by: rem.logged_by,
      };
      return acc;
    }, {});

    const { data: editReasonRows } = await supabase
      .from('reading_edit_audit_log')
      .select('record_id, actor_label, edited_at, changes, action')
      .eq('table_name', table)
      .in('record_id', rowIds)
      .order('edited_at', { ascending: true });

    const editReasonMap = (editReasonRows ?? []).reduce<Record<string, { text: string; actor_label: string | null; logged_at: string; changes: unknown }>>((acc, e) => {
      if (!e.record_id) return acc;
      const changesObj = e.changes && typeof e.changes === 'object' && !Array.isArray(e.changes) ? (e.changes as Record<string, unknown>) : null;
      const text = typeof changesObj?.reason === 'string'
        ? changesObj.reason
        : typeof changesObj?.notes === 'string'
          ? changesObj.notes
          : e.action ?? 'Manual edit';
      acc[e.record_id] = { text, actor_label: e.actor_label, logged_at: e.edited_at, changes: e.changes };
      return acc;
    }, {});

    const { data: normRows } = await supabase
      .from('reading_normalizations')
      .select('source_id, original_value, adjusted_value, note, performed_at')
      .eq('source_table', table)
      .in('source_id', rowIds)
      .order('performed_at', { ascending: true });

    const normMap = (normRows ?? []).reduce<Record<string, { original_value: number | null; adjusted_value: number | null; note: string | null; performed_at: string }>>((acc, n) => {
      acc[n.source_id] = {
        original_value: n.original_value != null ? Number(n.original_value) : null,
        adjusted_value: n.adjusted_value != null ? Number(n.adjusted_value) : null,
        note: n.note,
        performed_at: n.performed_at,
      };
      return acc;
    }, {});

    const { data: corrRows } = await supabase
      .from('correction_requests')
      .select('source_id, original_value, proposed_value, reason, resolution_note, created_at')
      .eq('source_table', table)
      .in('source_id', rowIds)
      .order('created_at', { ascending: true });

    const corrMap = (corrRows ?? []).reduce<Record<string, { original_value: number | null; proposed_value: number | null; reason: string }>>((acc, c) => {
      acc[c.source_id] = {
        original_value: c.original_value != null ? Number(c.original_value) : null,
        proposed_value: c.proposed_value != null ? Number(c.proposed_value) : null,
        reason: c.reason,
      };
      return acc;
    }, {});

    for (const r of rows) {
      const vol = r.daily_volume ?? (r.previous_reading != null ? r.current_reading - r.previous_reading : null);
      const isBackward = r.previous_reading != null && Number(r.current_reading) < Number(r.previous_reading);
      const isUnchanged = r.previous_reading != null && Number(r.current_reading) === Number(r.previous_reading);

      const editEntry = editReasonMap[r.id];
      const normEntry = normMap[r.id];
      const corrEntry = corrMap[r.id];

      let preEditVal: number | null = null;
      if (editEntry?.changes) {
        preEditVal = extractOldValueFromChanges(editEntry.changes);
      }
      if (preEditVal == null && normEntry?.original_value != null && !isNaN(Number(normEntry.original_value))) {
        preEditVal = Number(normEntry.original_value);
      }
      if (preEditVal == null && corrEntry?.original_value != null && !isNaN(Number(corrEntry.original_value))) {
        preEditVal = Number(corrEntry.original_value);
      }

      const pred = predecessorMap[r.id];
      const prevDt = pred?.reading_datetime ?? null;
      const prevUser = pred?.recorded_by ? usernameMap[pred.recorded_by] ?? null : null;

      let elapsedHours: number | null = null;
      if (prevDt && r.reading_datetime) {
        const diffMs = new Date(r.reading_datetime).getTime() - new Date(prevDt).getTime();
        if (diffMs > 0) {
          elapsedHours = diffMs / 3_600_000;
        }
      }

      let calculatedFlowRate: number | null = null;
      if (vol != null && elapsedHours != null && elapsedHours > 0) {
        calculatedFlowRate = vol / elapsedHours;
      }

      const rem = remarkMap[r.id];
      const avgFlowRate = rem?.avg_flow_rate ?? entityAvgRateMap[r.entity_id] ?? null;

      let deviationPct: number | null = rem?.deviation_pct ?? null;
      let deviationDirection: 'high' | 'low' | null = rem?.direction ?? null;

      if (deviationPct == null && calculatedFlowRate != null && avgFlowRate != null && avgFlowRate > 0) {
        deviationPct = Math.round(Math.abs(calculatedFlowRate / avgFlowRate - 1) * 100);
        deviationDirection = calculatedFlowRate >= avgFlowRate ? 'high' : 'low';
      }

      const elapsedStr = elapsedHours != null ? formatElapsedDuration(elapsedHours) : 'interval';
      let diagnosticSummary = '';

      if (isBackward) {
        diagnosticSummary = `Meter moved backward: current reading (${fmtNum(r.current_reading)}) is lower than preceding (${fmtNum(r.previous_reading)}), resulting in a negative delta (${fmtNum(vol)} m³ over ${elapsedStr}). Possible meter rollover, swap, or data entry error.`;
      } else if (isUnchanged) {
        diagnosticSummary = `Zero flow recorded: current reading equals preceding reading (${fmtNum(r.current_reading)}). 0.00 m³ volume elapsed over ${elapsedStr}. Possible plant downtime or meter stoppage.`;
      } else if (preEditVal != null && preEditVal !== Number(r.current_reading)) {
        diagnosticSummary = `Manual edit detected: reading was modified post-submission from ${fmtNum(preEditVal)} to ${fmtNum(r.current_reading)} (Δ ${fmtNum(vol)} m³).`;
      } else if (calculatedFlowRate != null && avgFlowRate != null && avgFlowRate > 0) {
        if (deviationDirection === 'high') {
          diagnosticSummary = `Flow rate spike: calculated rate of ${calculatedFlowRate.toFixed(2)} m³/hr is +${deviationPct}% above the 7-day average baseline (${avgFlowRate.toFixed(2)} m³/hr). Normal operational ceiling exceeded.`;
        } else {
          diagnosticSummary = `Low flow rate: calculated rate of ${calculatedFlowRate.toFixed(2)} m³/hr is -${deviationPct}% below the 7-day average baseline (${avgFlowRate.toFixed(2)} m³/hr).`;
        }
      } else if (calculatedFlowRate != null) {
        diagnosticSummary = `Calculated flow rate is ${calculatedFlowRate.toFixed(2)} m³/hr (${fmtNum(vol)} m³ over ${elapsedStr}). Insufficient 7-day normal history to compute average baseline.`;
      } else {
        diagnosticSummary = `Flagged by system integrity guards: ${fmtNum(vol)} m³ delta over ${elapsedStr}.`;
      }

      const flagReason: 'backward' | 'unchanged' | 'edited' | 'spike' = isBackward
        ? 'backward'
        : isUnchanged
        ? 'unchanged'
        : preEditVal != null && preEditVal !== Number(r.current_reading)
        ? 'edited'
        : 'spike';

      results.push({
        id: r.id,
        source_table: table,
        entity_id: r.entity_id,
        entity_name: entityMap[r.entity_id] ?? '—',
        plant_id: r.plant_id,
        plant_name: plantMap[r.plant_id] ?? '—',
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        previous_reading_datetime: prevDt,
        previous_operator_username: prevUser,
        current_reading: r.current_reading,
        daily_volume: vol,
        norm_status: r.norm_status,
        recorded_by: r.recorded_by,
        operator_username: r.recorded_by ? usernameMap[r.recorded_by] ?? null : null,
        predecessor: pred ?? null,
        is_backward: isBackward,
        is_unchanged: isUnchanged,
        flag_reason: flagReason,
        anomaly_remark: rem ?? null,
        edit_reason: editEntry ? { text: editEntry.text, actor_label: editEntry.actor_label, logged_at: editEntry.logged_at } : null,
        pre_edit_value: preEditVal,
        calculated_flow_rate: calculatedFlowRate,
        avg_flow_rate: avgFlowRate,
        deviation_pct: deviationPct,
        deviation_direction: deviationDirection,
        elapsed_hours: elapsedHours,
        diagnostic_summary: diagnosticSummary,
      });
    }
  }

  results.sort((a, b) => b.reading_datetime.localeCompare(a.reading_datetime));
  return { rows: results, truncated };
}

/** Count pending readings for badge */
export async function fetchPendingCount(): Promise<number> {
  const [locatorRes, wellRes, meterRes] = await Promise.all([
    supabase.from('locator_readings').select('id', { count: 'exact', head: true }).eq('norm_status', 'pending_review'),
    supabase.from('well_readings').select('id', { count: 'exact', head: true }).eq('norm_status', 'pending_review'),
    supabase.from('product_meter_readings').select('id', { count: 'exact', head: true }).eq('norm_status', 'pending_review'),
  ]);
  return (locatorRes.count ?? 0) + (wellRes.count ?? 0) + (meterRes.count ?? 0);
}

/** Count correction requests pending */
export async function fetchCorrectionRequestsCount(): Promise<number> {
  const { count, error } = await supabase
    .from('correction_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}

/** Count inbox items (negative daily_volume not flagged) */
export async function fetchInboxCount(): Promise<number> {
  const [locatorRes, wellRes, meterRes] = await Promise.all([
    supabase.from('locator_readings').select('id', { count: 'exact', head: true }).eq('norm_status', 'normal').lt('daily_volume', 0).eq('is_meter_replacement', false),
    supabase.from('well_readings').select('id', { count: 'exact', head: true }).eq('norm_status', 'normal').lt('daily_volume', 0).eq('is_meter_replacement', false),
    supabase.from('product_meter_readings').select('id', { count: 'exact', head: true }).eq('norm_status', 'normal').lt('daily_volume', 0).eq('is_meter_replacement', false),
  ]);
  return (locatorRes.count ?? 0) + (wellRes.count ?? 0) + (meterRes.count ?? 0);
}

/** Fetch correction inbox items */
export async function fetchCorrectionInbox(tableFilter?: SourceTable): Promise<FlaggedRow[]> {
  const tables: SourceTable[] = tableFilter
    ? [tableFilter]
    : ['locator_readings', 'well_readings', 'product_meter_readings'];
  const results: FlaggedRow[] = [];

  for (const table of tables) {
    let rows: GenericReadingRow[] = [];
    if (table === 'locator_readings') {
      const { data } = await supabase
        .from('locator_readings')
        .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, locator_id')
        .eq('norm_status', 'normal')
        .lt('daily_volume', 0)
        .eq('is_meter_replacement', false)
        .order('reading_datetime', { ascending: false })
        .limit(500);
      rows = (data ?? []).map(r => ({
        id: r.id,
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        current_reading: r.current_reading ?? 0,
        daily_volume: r.daily_volume,
        norm_status: r.norm_status ?? 'normal',
        recorded_by: r.recorded_by,
        plant_id: r.plant_id,
        entity_id: r.locator_id,
      }));
    } else if (table === 'well_readings') {
      const { data } = await supabase
        .from('well_readings')
        .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, well_id')
        .eq('norm_status', 'normal')
        .lt('daily_volume', 0)
        .eq('is_meter_replacement', false)
        .order('reading_datetime', { ascending: false })
        .limit(500);
      rows = (data ?? []).map(r => ({
        id: r.id,
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        current_reading: r.current_reading ?? 0,
        daily_volume: r.daily_volume,
        norm_status: r.norm_status ?? 'normal',
        recorded_by: r.recorded_by,
        plant_id: r.plant_id,
        entity_id: r.well_id,
      }));
    } else if (table === 'product_meter_readings') {
      const { data } = await supabase
        .from('product_meter_readings')
        .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, plant_id, meter_id')
        .eq('norm_status', 'normal')
        .lt('daily_volume', 0)
        .eq('is_meter_replacement', false)
        .order('reading_datetime', { ascending: false })
        .limit(500);
      rows = (data ?? []).map(r => ({
        id: r.id,
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        current_reading: r.current_reading ?? 0,
        daily_volume: r.daily_volume,
        norm_status: r.norm_status ?? 'normal',
        recorded_by: r.recorded_by,
        plant_id: r.plant_id,
        entity_id: r.meter_id,
      }));
    }

    if (!rows.length) continue;

    const entityIds = [...new Set(rows.map(r => r.entity_id))].filter(Boolean);
    const entityMap = await fetchEntityNames(table, entityIds);

    const plantIds = [...new Set(rows.map(r => r.plant_id))].filter(Boolean);
    const plantMap = await fetchPlantNames(plantIds);

    const operatorIds = [...new Set(rows.map(r => r.recorded_by).filter((id): id is string => Boolean(id)))];
    const operatorMap = await fetchUsernames(operatorIds);

    for (const r of rows) {
      const currentReading = r.current_reading;
      const previousReading = r.previous_reading;
      const is_backward = previousReading != null && currentReading < previousReading;
      const is_unchanged = previousReading != null && currentReading === previousReading;
      const flag_reason = is_backward ? 'backward' : (is_unchanged ? 'unchanged' : 'edited');

      results.push({
        id: r.id,
        source_table: table,
        entity_id: r.entity_id,
        entity_name: entityMap[r.entity_id] ?? '—',
        plant_id: r.plant_id,
        plant_name: plantMap[r.plant_id] ?? '—',
        reading_datetime: r.reading_datetime,
        previous_reading: r.previous_reading,
        current_reading: r.current_reading,
        daily_volume: r.daily_volume,
        norm_status: r.norm_status,
        recorded_by: r.recorded_by,
        operator_username: r.recorded_by ? operatorMap[r.recorded_by] ?? null : null,
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
export async function fetchCorrectionRequests(status?: string): Promise<CorrectionRequest[]> {
  let q = supabase.from('correction_requests').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data: reqs, error } = await q;
  if (error) throw error;
  if (!reqs?.length) return [];

  const plantIds = [...new Set(reqs.map(r => r.plant_id).filter((id): id is string => Boolean(id)))];
  const plantMap = await fetchPlantNames(plantIds);

  const userIds = [...new Set(reqs.map(r => r.submitted_by).filter((id): id is string => Boolean(id)))];
  const userMap = await fetchUsernames(userIds);

  return reqs.map(r => ({
    id: r.id,
    source_table: r.source_table as SourceTable,
    source_id: r.source_id,
    entity_name: `${tableLabel[r.source_table as SourceTable] ?? r.source_table} ${r.source_id.slice(0, 8)}`,
    plant_name: r.plant_id ? plantMap[r.plant_id] ?? null : null,
    original_value: r.original_value,
    proposed_value: r.proposed_value,
    reason: r.reason,
    note: r.note,
    status: r.status,
    submitter_email: r.submitted_by ? userMap[r.submitted_by] ?? null : null,
    created_at: r.created_at,
    plant_id: r.plant_id ?? undefined,
    entity_type: r.source_table,
    field_name: 'current_reading',
    current_value: r.original_value,
    resolution_note: r.resolution_note,
    resolved_at: r.resolved_at,
    resolved_by: r.resolved_by,
    requested_by: r.submitted_by,
    requested_at: r.created_at,
  }));
}

/** Fetch edit history (reading_normalizations) */
export async function fetchEditHistory(
  limit = 200,
): Promise<Database['public']['Tables']['reading_normalizations']['Row'][]> {
  const { data, error } = await supabase
    .from('reading_normalizations')
    .select('*')
    .order('performed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Fetch operator error stats (30-day rolling) */
export async function fetchOperatorStats(): Promise<OperatorStat[]> {
  // 1. Fetch user profiles and user roles to identify Operator accounts only
  let profiles: Array<{ id: string; username: string | null; first_name: string | null; last_name: string | null; status?: string }> = [];
  try {
    const { data: rpcProfiles, error: rpcErr } = await (supabase as any).rpc('get_all_staff_profiles');
    if (!rpcErr && rpcProfiles && rpcProfiles.length > 0) {
      profiles = rpcProfiles;
    } else {
      const { data, error } = await supabase.from('user_profiles').select('id, username, first_name, last_name, status');
      if (!error && data) profiles = data;
    }
  } catch {
    const { data } = await supabase.from('user_profiles').select('id, username, first_name, last_name, status');
    if (data) profiles = data ?? [];
  }

  let rolesData: Array<{ user_id: string; role: string }> = [];
  try {
    const { data: rpcRoles, error: rpcErr } = await (supabase as any).rpc('get_all_user_roles');
    if (!rpcErr && rpcRoles && rpcRoles.length > 0) {
      rolesData = rpcRoles;
    } else {
      const { data, error } = await supabase.from('user_roles').select('user_id, role');
      if (!error && data) rolesData = data as Array<{ user_id: string; role: string }>;
    }
  } catch {
    const { data } = await supabase.from('user_roles').select('user_id, role');
    if (data) rolesData = (data ?? []) as Array<{ user_id: string; role: string }>;
  }

  // Build role map per user_id
  const rolesByUser = new Map<string, Set<string>>();
  for (const r of rolesData) {
    if (!r.user_id) continue;
    if (!rolesByUser.has(r.user_id)) {
      rolesByUser.set(r.user_id, new Set());
    }
    rolesByUser.get(r.user_id)!.add(r.role);
  }

  // Filter ONLY Operator accounts (exclude Admin, Manager, Data Analyst, non-operators)
  const operatorProfiles = profiles.filter((p) => {
    if (p.status === 'Suspended') return false;
    const userRoles = rolesByUser.get(p.id);
    if (!userRoles || userRoles.size === 0) return false;
    const rolesArr = Array.from(userRoles).map((r) => r.toLowerCase());
    const hasOperator = rolesArr.includes('operator');
    const isExcluded = rolesArr.some((r) =>
      r === 'admin' || r === 'manager' || r === 'data analyst' || r === 'analyst'
    );
    return hasOperator && !isExcluded;
  });

  if (operatorProfiles.length === 0 && profiles.length > 0) {
    // Edge-case safeguard: if roles table is not populated in local dev/tests, fallback to any non-admin/non-manager profile
    const fallbackOps = profiles.filter((p) => {
      const rolesArr = Array.from(rolesByUser.get(p.id) ?? []).map((r) => r.toLowerCase());
      return !rolesArr.some((r) => r === 'admin' || r === 'manager' || r === 'data analyst');
    });
    if (fallbackOps.length > 0) {
      operatorProfiles.push(...fallbackOps);
    }
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Query readings across locator_readings, well_readings, product_meter_readings, ro_train_readings
  const [locRes, wellRes, prodRes, roRes] = await Promise.allSettled([
    supabase
      .from('locator_readings')
      .select('id, recorded_by, reading_datetime, norm_status, daily_volume, is_meter_replacement')
      .gte('reading_datetime', thirtyDaysAgo)
      .limit(5000),
    supabase
      .from('well_readings')
      .select('id, recorded_by, reading_datetime, norm_status, daily_volume, is_meter_replacement')
      .gte('reading_datetime', thirtyDaysAgo)
      .limit(5000),
    supabase
      .from('product_meter_readings')
      .select('id, recorded_by, reading_datetime, norm_status, daily_volume, is_meter_replacement')
      .gte('reading_datetime', thirtyDaysAgo)
      .limit(5000),
    supabase
      .from('ro_train_readings')
      .select('id, recorded_by, reading_datetime, norm_status')
      .gte('reading_datetime', thirtyDaysAgo)
      .limit(5000),
  ]);

  interface ReadingStatItem {
    recorded_by: string | null;
    reading_datetime: string;
    norm_status?: string | null;
    daily_volume?: number | null;
    is_meter_replacement?: boolean | null;
  }

  const allReadings: ReadingStatItem[] = [];
  if (locRes.status === 'fulfilled' && locRes.value.data) {
    allReadings.push(...(locRes.value.data as ReadingStatItem[]));
  }
  if (wellRes.status === 'fulfilled' && wellRes.value.data) {
    allReadings.push(...(wellRes.value.data as ReadingStatItem[]));
  }
  if (prodRes.status === 'fulfilled' && prodRes.value.data) {
    allReadings.push(...(prodRes.value.data as ReadingStatItem[]));
  }
  if (roRes.status === 'fulfilled' && roRes.value.data) {
    allReadings.push(...(roRes.value.data as ReadingStatItem[]));
  }

  // Initialize stats for each operator
  const statsMap = new Map<string, {
    user_id: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    total_entries: number;
    backward_readings: number;
    pending_review: number;
    retracted: number;
    error_count: number;
    last_entry_at: string | null;
  }>();

  for (const op of operatorProfiles) {
    statsMap.set(op.id, {
      user_id: op.id,
      username: op.username,
      first_name: op.first_name,
      last_name: op.last_name,
      total_entries: 0,
      backward_readings: 0,
      pending_review: 0,
      retracted: 0,
      error_count: 0,
      last_entry_at: null,
    });
  }

  // Aggregate readings
  for (const r of allReadings) {
    if (!r.recorded_by || !statsMap.has(r.recorded_by)) continue;
    const stat = statsMap.get(r.recorded_by)!;
    stat.total_entries += 1;

    if (r.reading_datetime) {
      if (!stat.last_entry_at || new Date(r.reading_datetime).getTime() > new Date(stat.last_entry_at).getTime()) {
        stat.last_entry_at = r.reading_datetime;
      }
    }

    const isReplacement = !!r.is_meter_replacement;
    const isBackward = !isReplacement && r.daily_volume != null && r.daily_volume < 0;
    const isPending = r.norm_status === 'pending_review';
    const isRetracted = r.norm_status === 'retracted';

    if (isBackward) stat.backward_readings += 1;
    if (isPending) stat.pending_review += 1;
    if (isRetracted) stat.retracted += 1;

    if (isBackward || isPending || isRetracted) {
      stat.error_count += 1;
    }
  }

  const result: OperatorStat[] = Array.from(statsMap.values()).map((s) => {
    const error_rate_pct = s.total_entries > 0
      ? (s.error_count / s.total_entries) * 100
      : 0;

    return {
      user_id: s.user_id,
      username: s.username,
      first_name: s.first_name,
      last_name: s.last_name,
      total_entries: s.total_entries,
      backward_readings: s.backward_readings,
      pending_review: s.pending_review,
      retracted: s.retracted,
      error_count: s.error_count,
      error_rate_pct,
      last_entry_at: s.last_entry_at,
    };
  });

  // For operators who had no entries in the last 30 days, look up their latest historical entry if any
  const operatorsNeedingLastEntry = result.filter(r => !r.last_entry_at && r.user_id);
  if (operatorsNeedingLastEntry.length > 0) {
    const userIds = operatorsNeedingLastEntry.map(r => r.user_id!);
    try {
      const [locLast, wellLast] = await Promise.allSettled([
        supabase
          .from('locator_readings')
          .select('recorded_by, reading_datetime')
          .in('recorded_by', userIds)
          .order('reading_datetime', { ascending: false })
          .limit(userIds.length * 2),
        supabase
          .from('well_readings')
          .select('recorded_by, reading_datetime')
          .in('recorded_by', userIds)
          .order('reading_datetime', { ascending: false })
          .limit(userIds.length * 2),
      ]);
      const latestMap = new Map<string, string>();
      const processRows = (rows: Array<{ recorded_by: string | null; reading_datetime: string }> | null | undefined) => {
        for (const row of rows ?? []) {
          if (!row.recorded_by || !row.reading_datetime) continue;
          const curr = latestMap.get(row.recorded_by);
          if (!curr || new Date(row.reading_datetime).getTime() > new Date(curr).getTime()) {
            latestMap.set(row.recorded_by, row.reading_datetime);
          }
        }
      };
      if (locLast.status === 'fulfilled' && locLast.value.data) processRows(locLast.value.data as any);
      if (wellLast.status === 'fulfilled' && wellLast.value.data) processRows(wellLast.value.data as any);

      for (const r of result) {
        if (!r.last_entry_at && r.user_id && latestMap.has(r.user_id)) {
          r.last_entry_at = latestMap.get(r.user_id);
        }
      }
    } catch {
      // Non-critical optimization, ignore error
    }
  }

  // Sort: error_rate_pct DESC, then total_entries DESC, then username ASC
  result.sort((a, b) => {
    const rateDiff = (b.error_rate_pct ?? 0) - (a.error_rate_pct ?? 0);
    if (Math.abs(rateDiff) > 0.001) return rateDiff;
    const entriesDiff = (b.total_entries ?? 0) - (a.total_entries ?? 0);
    if (entriesDiff !== 0) return entriesDiff;
    return (a.username ?? '').localeCompare(b.username ?? '');
  });

  return result;
}

/** Fetch reading chain for an entity */
export async function fetchReadingChain(
  table: SourceTable,
  entityId: string,
  limit = 100,
): Promise<ChainEntry[]> {
  if (table === 'locator_readings') {
    const { data, error } = await supabase
      .from('locator_readings')
      .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, is_estimated, is_meter_replacement, locator_id')
      .eq('locator_id', entityId)
      .order('reading_datetime', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(r => ({
      id: r.id,
      table_name: table,
      entity_id: r.locator_id,
      reading_datetime: r.reading_datetime,
      previous_reading: r.previous_reading,
      current_reading: r.current_reading ?? 0,
      daily_volume: r.daily_volume,
      recorded_by: r.recorded_by,
      is_estimated: r.is_estimated ?? false,
      is_meter_replacement: r.is_meter_replacement ?? false,
      norm_status: r.norm_status ?? 'raw',
    }));
  }
  if (table === 'well_readings') {
    const { data, error } = await supabase
      .from('well_readings')
      .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, is_estimated, is_meter_replacement, well_id')
      .eq('well_id', entityId)
      .order('reading_datetime', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(r => ({
      id: r.id,
      table_name: table,
      entity_id: r.well_id,
      reading_datetime: r.reading_datetime,
      previous_reading: r.previous_reading,
      current_reading: r.current_reading ?? 0,
      daily_volume: r.daily_volume,
      recorded_by: r.recorded_by,
      is_estimated: r.is_estimated ?? false,
      is_meter_replacement: r.is_meter_replacement ?? false,
      norm_status: r.norm_status ?? 'raw',
    }));
  }
  if (table === 'product_meter_readings') {
    const { data, error } = await supabase
      .from('product_meter_readings')
      .select('id, reading_datetime, previous_reading, current_reading, daily_volume, norm_status, recorded_by, is_estimated, is_meter_replacement, meter_id')
      .eq('meter_id', entityId)
      .order('reading_datetime', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(r => ({
      id: r.id,
      table_name: table,
      entity_id: r.meter_id,
      reading_datetime: r.reading_datetime,
      previous_reading: r.previous_reading,
      current_reading: r.current_reading ?? 0,
      daily_volume: r.daily_volume,
      recorded_by: r.recorded_by,
      is_estimated: r.is_estimated ?? false,
      is_meter_replacement: r.is_meter_replacement ?? false,
      norm_status: r.norm_status ?? 'raw',
    }));
  }
  return [];
}

/** Approve a pending reading */
export async function approveReading(
  table: SourceTable,
  id: string,
  reviewerId: string,
  note?: string,
): Promise<void> {
  let error;
  if (table === 'locator_readings') {
    ({ error } = await supabase.from('locator_readings').update({
      norm_status: 'normal',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
      ...(note ? { remarks: note } : {}),
    }).eq('id', id));
  } else if (table === 'well_readings') {
    ({ error } = await supabase.from('well_readings').update({
      norm_status: 'normal',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
    }).eq('id', id));
  } else if (table === 'product_meter_readings') {
    ({ error } = await supabase.from('product_meter_readings').update({
      norm_status: 'normal',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
    }).eq('id', id));
  } else {
    ({ error } = await supabase.from('ro_train_readings').update({
      norm_status: 'normal',
      ...(note ? { remarks: note } : {}),
    }).eq('id', id));
  }
  if (error) throw error;
}

/** Retract a pending reading */
export async function retractReading(
  table: SourceTable,
  id: string,
  reviewerId: string,
  note?: string,
): Promise<void> {
  let error;
  if (table === 'locator_readings') {
    ({ error } = await supabase.from('locator_readings').update({
      norm_status: 'retracted',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
      ...(note ? { remarks: note } : {}),
    }).eq('id', id));
  } else if (table === 'well_readings') {
    ({ error } = await supabase.from('well_readings').update({
      norm_status: 'retracted',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
    }).eq('id', id));
  } else if (table === 'product_meter_readings') {
    ({ error } = await supabase.from('product_meter_readings').update({
      norm_status: 'retracted',
      locked_by: reviewerId,
      locked_at: new Date().toISOString(),
    }).eq('id', id));
  } else {
    ({ error } = await supabase.from('ro_train_readings').update({
      norm_status: 'retracted',
      ...(note ? { remarks: note } : {}),
    }).eq('id', id));
  }
  if (error) throw error;
}

/** Update a reading value with cascade */
export async function updateReadingValue(
  table: SourceTable,
  id: string,
  newValue: number,
  editorId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('fn_cascade_reading_correction', {
    p_table: table,
    p_row_id: id,
    p_new_current: newValue,
    p_admin_id: editorId,
    p_reason: reason,
  });
  if (error) throw error;
}

/** Mark as meter replacement */
export async function markMeterReplacement(
  table: SourceTable,
  id: string,
  editorId: string,
): Promise<void> {
  let error;
  if (table === 'locator_readings') {
    ({ error } = await supabase.from('locator_readings').update({ is_meter_replacement: true, recorded_by: editorId }).eq('id', id));
  } else if (table === 'well_readings') {
    ({ error } = await supabase.from('well_readings').update({ is_meter_replacement: true, recorded_by: editorId }).eq('id', id));
  } else if (table === 'product_meter_readings') {
    ({ error } = await supabase.from('product_meter_readings').update({ is_meter_replacement: true, recorded_by: editorId }).eq('id', id));
  } else {
    ({ error } = await supabase.from('ro_train_readings').update({ is_meter_replacement: true, recorded_by: editorId }).eq('id', id));
  }
  if (error) throw error;
}