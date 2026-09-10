/**
 * DataCorrections.tsx
 * ═══════════════════
 * Unified correction hub — replaces the scattered Admin → Normalization panel,
 * the Pending Readings queue, and the per-row ReadingHistoryDialog corrections.
 *
 * Tabs
 * ────
 * 1. Pending Review  — readings auto-flagged by the DB trigger awaiting approval.
 *                      Bulk approve/retract + inline chain context (items 3, 4, 5).
 * 2. Correction Inbox — all active backward or erroneous readings still norm_status='normal'.
 *                      Admin can edit value (cascade), retract, or mark as replacement (item 6).
 * 3. Edit History    — reading_normalizations audit trail.
 * 4. Operator Stats  — rolling 30-day error rate table (item 7).
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { DataState } from '@/components/DataState';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { format, formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2,
  ChevronDown, ChevronUp, ClipboardCheck, Inbox, History,
  Users, ArrowRight, Pencil, Search, ShieldAlert, Gauge,
  AlertTriangle, CheckSquare, FileText, Clock, Activity, Tag, HelpCircle, FileQuestion,
} from 'lucide-react';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  computeRollingAverageRate, computeRollingAverageRateFromDeltas, RatePoint, VolumePoint,
} from '@/lib/flowRateGuards';
import { submitAnomalyRemark } from '@/lib/anomalyRemarks';
import { cn } from '@/lib/utils';
import { SourceTable, FlaggedRow, CorrectionRequest, ChainEntry, OperatorStat, tableLabel, fmtNum, fmtDt, parseNumeric, extractOldValueFromChanges, pickDisplayRole, ROLE_DISPLAY_PRIORITY, UUID } from './types';
import { formatElapsedDuration } from './components/DiagnosticPopover';


// ── Pending Review tab (items 3, 4, 5) ───────────────────────────────────────

// BUGFIX: this previously capped each of the 3 source tables at .limit(200)
// while the header badge (usePendingCount, below) does an exact head-count
// with no limit at all. With >200 pending rows in any one table, the badge
// and the visible list permanently disagreed — approving everything visible
// would empty the list while the badge still showed a large leftover number,
// which reads exactly like "approved items are still stuck as pending."
// They weren't stuck; they were never fetched. Raised to PostgREST's own
// per-request row cap (1000) and the query now reports whether even THAT
// was hit, so a future plant with >1000 pending rows in one table gets a
// visible "showing partial results" banner instead of the same silent gap.
export const PENDING_FETCH_LIMIT_PER_TABLE = 1000;


// Same "guessed max, human confirms" heuristic as Step 1 of
// supabase/migrations/*_meter_rollover_backfill.sql: a mechanical register
// almost always wraps at a round power-of-ten boundary just above its
// previous value (e.g. a reading in the 900,000s on a 6-digit odometer
// wraps at 999999.99). It's a starting point for the admin to confirm or
// overtype against the physical meter's real register size, never applied
// automatically.
export function guessMeterMax(previousReading: number | null): number {
  if (previousReading == null || !Number.isFinite(previousReading)) return 99999.99;
  const digits = String(Math.floor(Math.abs(previousReading))).length;
  return Math.pow(10, digits) - 0.01;
}


// ── Pending Review tab (items 3, 4, 5) ───────────────────────────────────────

// BUGFIX: this previously capped each of the 3 source tables at .limit(200)
// while the header badge (usePendingCount, below) does an exact head-count
// with no limit at all. With >200 pending rows in any one table, the badge
// and the visible list permanently disagreed — approving everything visible
// would empty the list while the badge still showed a large leftover number,
// which reads exactly like "approved items are still stuck as pending."
// They weren't stuck; they were never fetched. Raised to PostgREST's own
// per-request row cap (1000) and the query now reports whether even THAT
// was hit, so a future plant with >1000 pending rows in one table gets a
// visible "showing partial results" banner instead of the same silent gap.

export async function fetchPending(): Promise<{ rows: FlaggedRow[]; truncated: boolean }> {
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
      .limit(PENDING_FETCH_LIMIT_PER_TABLE) as any);

    if (!rows?.length) continue;
    if (rows.length === PENDING_FETCH_LIMIT_PER_TABLE) truncated = true;

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

    // Predecessors lookup per pending row to get exact date/time and operator of prior reading
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
    for (const p of predResults) {
      if (p.prev) predecessorMap[p.rowId] = p.prev;
    }

    // Resolve usernames from user_profiles (including both pending submitter and preceding submitter)
    const userIds = [...new Set([
      ...rows.map((r: any) => r.recorded_by),
      ...Object.values(predecessorMap).map((p: any) => p.recorded_by),
    ])].filter(Boolean) as string[];
    const { data: profiles } = await (supabase
      .from('user_profiles')
      .select('id, username, first_name, last_name')
      .in('id', userIds) as any);
    const usernameMap = Object.fromEntries(
      (profiles ?? []).map((p: any) => {
        const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
        const display = p.username ? `@${p.username}` : (full || '—');
        return [p.id, display];
      })
    );

    // Resolve the operator's own anomaly remark for each row (including flow rate & deviation metadata)
    const rowIds = rows.map((r: any) => r.id);
    const { data: remarkRows } = await (supabase
      .from('reading_anomaly_remarks' as any)
      .select('record_id, remark_text, tier, direction, deviation_pct, flow_rate, avg_flow_rate, rate_unit, logged_at, logged_by')
      .eq('table_name', table)
      .in('record_id', rowIds)
      .order('logged_at', { ascending: true }) as any);
    const remarkMap = (remarkRows ?? []).reduce((acc: Record<string, any>, rem: any) => {
      acc[rem.record_id] = {
        text: rem.remark_text,
        tier: rem.tier,
        direction: rem.direction,
        deviation_pct: rem.deviation_pct != null ? Number(rem.deviation_pct) : null,
        flow_rate: rem.flow_rate != null ? Number(rem.flow_rate) : null,
        avg_flow_rate: rem.avg_flow_rate != null ? Number(rem.avg_flow_rate) : null,
        rate_unit: rem.rate_unit,
        logged_at: rem.logged_at,
        logged_by: rem.logged_by,
      };
      return acc;
    }, {} as Record<string, any>);

    // Query historical normal readings over the last 14 days for these entities to compute 7-day average flow rate
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const { data: histRows } = await (supabase
      .from(table as any)
      .select(`id, ${entityCol}, reading_datetime, daily_volume, current_reading, previous_reading`)
      .in(entityCol, entityIds)
      .eq('norm_status', 'normal')
      .gte('reading_datetime', twoWeeksAgo.toISOString())
      .order('reading_datetime', { ascending: true }) as any);

    const entityHistMap: Record<string, any[]> = {};
    for (const h of histRows ?? []) {
      const eid = h[entityCol];
      if (!entityHistMap[eid]) entityHistMap[eid] = [];
      entityHistMap[eid].push(h);
    }

    const entityAvgRateMap: Record<string, number | null> = {};
    for (const eid of entityIds) {
      const eRows = entityHistMap[eid] ?? [];
      if (!eRows.length) {
        entityAvgRateMap[eid] = null;
        continue;
      }
      if (table === 'well_readings') {
        const points: RatePoint[] = eRows.map((er: any) => ({
          value: Number(er.current_reading),
          at: new Date(er.reading_datetime),
        }));
        entityAvgRateMap[eid] = computeRollingAverageRate(points, 7);
      } else {
        const volPoints: VolumePoint[] = eRows
          .filter((er: any) => er.daily_volume != null && !isNaN(Number(er.daily_volume)))
          .map((er: any) => ({
            volume: Number(er.daily_volume),
            at: new Date(er.reading_datetime),
          }));
        entityAvgRateMap[eid] = computeRollingAverageRateFromDeltas(volPoints, 7);
      }
    }

    // BUGFIX: a reading can also (or instead) carry a required "Reason for this edit"
    const { data: editReasonRows } = await (supabase
      .from('reading_edit_audit_log' as any)
      .select('record_id, reason, actor_label, edited_at, changes, action')
      .eq('table_name', table)
      .in('record_id', rowIds)
      .order('edited_at', { ascending: true }) as any);
    const editReasonMap = (editReasonRows ?? []).reduce((acc: Record<string, any>, e: any) => {
      acc[e.record_id] = { text: e.reason, actor_label: e.actor_label, logged_at: e.edited_at, changes: e.changes };
      return acc;
    }, {} as Record<string, any>);

    // Also fetch any prior reading_normalizations entries for these records
    const { data: normRows } = await (supabase
      .from('reading_normalizations' as any)
      .select('source_id, original_value, adjusted_value, note, performed_at')
      .eq('source_table', table)
      .in('source_id', rowIds)
      .order('performed_at', { ascending: true }) as any);
    const normMap = (normRows ?? []).reduce((acc: Record<string, any>, n: any) => {
      acc[n.source_id] = {
        original_value: n.original_value != null ? Number(n.original_value) : null,
        adjusted_value: n.adjusted_value != null ? Number(n.adjusted_value) : null,
        note: n.note,
        performed_at: n.performed_at,
      };
      return acc;
    }, {} as Record<string, any>);

    // Also fetch any correction_requests filed against these records
    const { data: corrRows } = await (supabase
      .from('correction_requests' as any)
      .select('source_id, original_value, proposed_value, reason, note, created_at')
      .eq('source_table', table)
      .in('source_id', rowIds)
      .order('created_at', { ascending: true }) as any);
    const corrMap = (corrRows ?? []).reduce((acc: Record<string, any>, c: any) => {
      acc[c.source_id] = {
        original_value: c.original_value != null ? Number(c.original_value) : null,
        proposed_value: c.proposed_value != null ? Number(c.proposed_value) : null,
        reason: c.reason,
      };
      return acc;
    }, {} as Record<string, any>);

    for (const r of rows) {
      const vol = r.daily_volume ?? (r.previous_reading != null ? r.current_reading - r.previous_reading : null);
      const isBackward = r.previous_reading != null && Number(r.current_reading) < Number(r.previous_reading);
      const isUnchanged = r.previous_reading != null && Number(r.current_reading) === Number(r.previous_reading);

      const editEntry = editReasonMap[r.id];
      const normEntry = normMap[r.id];
      const corrEntry = corrMap[r.id];

      // Extract pre-edit value from audit log changes, normalizations, or correction requests
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

      // Predecessor details
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
      const avgFlowRate = rem?.avg_flow_rate ?? entityAvgRateMap[r[entityCol]] ?? null;

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

      // Classify flag reason accurately:
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
        entity_id: r[entityCol],
        entity_name: entityMap[r[entityCol]] ?? '—',
        plant_id: r.plant_id,
        plant_name: plantMap[r.plant_id] ?? '—',
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

  return {
    rows: results.sort((a, b) => new Date(b.reading_datetime).getTime() - new Date(a.reading_datetime).getTime()),
    truncated,
  };
}


// ── Pending Review tab (items 3, 4, 5) ───────────────────────────────────────

// BUGFIX: this previously capped each of the 3 source tables at .limit(200)
// while the header badge (usePendingCount, below) does an exact head-count
// with no limit at all. With >200 pending rows in any one table, the badge
// and the visible list permanently disagreed — approving everything visible
// would empty the list while the badge still showed a large leftover number,
// which reads exactly like "approved items are still stuck as pending."
// They weren't stuck; they were never fetched. Raised to PostgREST's own
// per-request row cap (1000) and the query now reports whether even THAT
// was hit, so a future plant with >1000 pending rows in one table gets a
// visible "showing partial results" banner instead of the same silent gap.

export async function fetchCorrectionRequests(): Promise<CorrectionRequest[]> {
  const { data: reqs } = await (supabase
    .from('correction_requests' as any)
    .select('id,source_table,source_id,plant_id,original_value,proposed_value,reason,note,status,submitted_by,created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100) as any);
  if (!reqs?.length) return [];

  const plantIds = [...new Set(reqs.map((r: any) => r.plant_id))].filter(Boolean) as string[];
  const { data: plants } = await (supabase.from('plants').select('id,name').in('id', plantIds) as any);
  const plantMap = Object.fromEntries((plants ?? []).map((p: any) => [p.id, p.name]));
  const userIds = [...new Set(reqs.map((r: any) => r.submitted_by))].filter(Boolean) as string[];
  const { data: profiles } = await (supabase.from('user_profiles').select('id,email').in('id', userIds) as any);
  const emailMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.email]));

  return reqs.map((r: any) => ({
    id: r.id, source_table: r.source_table, source_id: r.source_id,
    plant_name: plantMap[r.plant_id] ?? '—',
    original_value: r.original_value, proposed_value: r.proposed_value,
    reason: r.reason, note: r.note, status: r.status,
    submitter_email: emailMap[r.submitted_by] ?? null,
    created_at: r.created_at,
  }));
}


// ── Pending Review tab (items 3, 4, 5) ───────────────────────────────────────

// BUGFIX: this previously capped each of the 3 source tables at .limit(200)
// while the header badge (usePendingCount, below) does an exact head-count
// with no limit at all. With >200 pending rows in any one table, the badge
// and the visible list permanently disagreed — approving everything visible
// would empty the list while the badge still showed a large leftover number,
// which reads exactly like "approved items are still stuck as pending."
// They weren't stuck; they were never fetched. Raised to PostgREST's own
// per-request row cap (1000) and the query now reports whether even THAT
// was hit, so a future plant with >1000 pending rows in one table gets a
// visible "showing partial results" banner instead of the same silent gap.

/**
 * BUGFIX: a reading could end up with BOTH its own norm_status =
 * 'pending_review' (shown in the main Pending list below) AND a separate
 * correction_requests row (shown under "Operator correction requests")
 * for the exact same underlying reading — e.g. an operator files a
 * correction request for a reading that was independently auto-flagged,
 * or two operators file overlapping requests for the same reading. These
 * were never linked: resolving one left the other sitting there
 * indefinitely, which looks exactly like "approved corrections still
 * stays." Whichever path resolves a reading first now also closes out any
 * OTHER still-pending correction_requests for that same
 * source_table + source_id, so there's only ever one live approval prompt
 * per reading.
 *
 * Reuses the 'rejected' status rather than introducing an unverified new
 * 'superseded' value: correction_requests isn't defined in any migration in
 * this repo (it was set up directly in the Supabase dashboard per the
 * 20260723 migration's note), so its exact status CHECK constraint can't be
 * confirmed from here — 'rejected' is already a value this table accepts
 * (see rejectRequest below). The resolution_note distinguishes the two
 * cases for anyone reading the Inbox/History later.
 */
export async function supersedeOtherCorrectionRequests(
  sourceTable: SourceTable,
  sourceId: string,
  resolvedBy: string | undefined,
  note: string,
  excludeRequestId?: string,
) {
  let q = supabase.from('correction_requests' as any)
    .update({
      status: 'rejected',
      resolved_by: resolvedBy ?? null,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
    })
    .eq('source_table', sourceTable)
    .eq('source_id', sourceId)
    .eq('status', 'pending');
  if (excludeRequestId) q = q.neq('id', excludeRequestId);
  // Best-effort dedup step — a failure here shouldn't block the primary
  // approve/reject action that's already succeeded, but it also shouldn't
  // vanish silently, since it's the same class of "looks fine, quietly
  // didn't happen" bug as the one on the primary update below.
  const { error } = await (q as any);
  if (error) console.error('supersedeOtherCorrectionRequests failed:', error);
}