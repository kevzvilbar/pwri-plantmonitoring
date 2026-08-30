/**
 * ro-trains/helpers.tsx
 *
 * Utility functions and the Sparkline micro-component shared across the RO
 * Train sub-components.  Extracted from ROTrains.tsx (§4 item 2 decomposition).
 */
import React from 'react';
import { supabase } from '@/integrations/supabase/client';
import { deltaCache } from '@/lib/deltaCache';

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

export function Sparkline({
  values,
  color = 'currentColor',
  width = 60,
  height = 20,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2)
    return <span className="text-3xs text-muted-foreground/40 font-mono">—</span>;

  const pad = 2;
  const w = width;
  const h = height;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return { x, y };
  });

  const pathD = points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`, '');
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${h} L ${points[0].x.toFixed(1)} ${h} Z`;
  const lastPoint = points[points.length - 1];
  const gradId = `spark-grad-${Math.abs(points[0].x + points[0].y).toFixed(0)}-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block overflow-visible shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastPoint.x} cy={lastPoint.y} r="2.25" fill={color} className="animate-pulse" />
    </svg>
  );
}

// ─── Effective-status derivation ──────────────────────────────────────────────
// Rules (in priority order):
//   1. Operator manually tagged 'Maintenance' → always Maintenance (hard lock)
//   2. Operator manually tagged 'Offline'     → always Offline     (hard lock)
//      Cleared only when operator submits a reading with trainOnline=true.
//   3. A reading exists within the last 2 hours → Running
//   4. Otherwise → Offline (no recent data)

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function deriveTrainStatus(
  train: any,
  lastReading: any,
): 'Running' | 'Maintenance' | 'Offline' {
  if (train.status === 'Maintenance') return 'Maintenance';
  if (train.status === 'Offline') return 'Offline';
  if (lastReading?.reading_datetime) {
    const age = Date.now() - new Date(lastReading.reading_datetime).getTime();
    if (age <= TWO_HOURS_MS) return 'Running';
  }
  return 'Offline';
}

// ─── Entry-edit permission model ──────────────────────────────────────────────
// Managers, Admins, and Data Analysts may edit or delete any reading, at any
// time. Regular operators may only edit entries they themselves recorded
// within EDIT_WINDOW_HOURS of creation; after that window, use
// CorrectionRequestDialog.
//
// This function is role-agnostic on purpose — it just takes a single
// "can bypass the edit window" boolean. Callers compute that from useAuth(),
// e.g. `const hasFullAccess = isManager || isDataAnalyst;`, so this helper
// doesn't need to know about the app's specific role names.
//
// RO Train / Pretreatment readings are the one exception: Kevz asked for the
// window removed there entirely (no time limit on self-editing an own
// entry), offset by the audit trail this same edit path already requires —
// logReadingEdit() (below) records actor/timestamp/field-level diffs, every
// update needs a non-empty reason (correctionReasons.ts's isReasonComplete),
// and a flagged/pending-review reading is still fully locked regardless of
// this flag (checked before the time window, see below) so an old edit
// can't be used to quietly rewrite a reading that's actively under review.
// Every other reading type (well/locator/power/product/blending/CIP/dosing)
// is unaffected — they don't pass this flag, so they keep the 8h window
// exactly as before.

export const EDIT_WINDOW_HOURS = 8;

export function canEditEntry(
  row: { recorded_by?: string | null; created_at?: string | null; norm_status?: string | null } | null | undefined,
  hasFullAccess: boolean,
  activeOperatorId: string | null | undefined,
  noTimeLimit = false,
): boolean {
  if (hasFullAccess) return true;
  if (!row || !activeOperatorId || !row.recorded_by) return false;
  if (row.recorded_by !== activeOperatorId) return false;
  // A reading currently flagged and sitting in Data Corrections' Pending
  // queue is actively awaiting a reviewer's Approve/Reject — a self-edit
  // here would let the operator quietly change the value AND overwrite the
  // "edit reason" the reviewer is looking at, mid-review. Full-access roles
  // (who own that review) are unaffected by this check above. Tables
  // without a norm_status column (e.g. power_readings) leave this field
  // undefined, so the check is simply a no-op there. This check applies
  // regardless of noTimeLimit — removing the time window doesn't mean
  // bypassing an active review.
  if (row.norm_status === 'pending_review') return false;
  if (noTimeLimit) return true;
  if (!row.created_at) return false;
  const ageHours = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
  return ageHours <= EDIT_WINDOW_HOURS;
}

// ─── Diff helper ──────────────────────────────────────────────────────────────
// Recursively sorts object keys so two logically-identical JSONB values (e.g.
// afm_units, booster_pumps) always serialize the same way regardless of key
// order — otherwise `String(a) !== String(b)` on an array of objects just
// compares "[object Object],[object Object]" and silently misses real edits.

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canonicalize((value as Record<string, unknown>)[k]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return value;
}

export function diffFields(
  before: Record<string, any>,
  after: Record<string, any>,
): Record<string, { old: any; new: any }> {
  const changes: Record<string, { old: any; new: any }> = {};
  for (const key of Object.keys(after)) {
    const a = before?.[key] ?? null;
    const b = after[key] ?? null;
    if (JSON.stringify(canonicalize(a)) !== JSON.stringify(canonicalize(b))) {
      changes[key] = { old: a, new: b };
    }
  }
  return changes;
}

// ─── Reading edit audit log ────────────────────────────────────────────────────
// Best-effort: a failed insert here never blocks the actual save/delete —
// accountability logging must not be able to break the primary workflow.

export async function logReadingEdit(entry: {
  // 'locator_readings' added alongside the Hamas override feature — see
  // supabase/migrations/20260727_hamas_phase0_roles_and_audit.sql, which
  // extends the matching DB check constraint the same way. 'cip_logs' added
  // 2026-08-09 — CIPLog.tsx was casting table_name to 'chemical_dosing_logs'
  // via `as any` to get past this union, silently mislabeling every CIP
  // edit in the audit trail as a dosing edit. 'product_meter_readings' added
  // 2026-08-11 — ProductMeterHistoryDialog (ProductSection.tsx) was the one
  // "edit an already-saved reading" surface that never got wired to this
  // audit log or the required-reason field at all (unlike its siblings
  // here); see 20260811_reading_audit_log_add_product_meter.sql for the
  // matching DB check-constraint change.
  table_name: 'ro_train_readings' | 'ro_pretreatment_readings' | 'chemical_dosing_logs' | 'cip_logs' | 'locator_readings' | 'power_readings' | 'blending_events' | 'well_readings' | 'product_meter_readings';
  /** Nullable for 'import' action — a CSV batch covers N records, not one. */
  record_id?: string | null;
  plant_id: string | null;
  train_id?: string | null;
  action?: 'update' | 'delete' | 'import';
  actor_user_id: string | null;
  actor_label: string | null;
  /** For update/delete: { field: { old, new } }. For import: metadata blob. */
  changes?: Record<string, any>;
  /**
   * Why this edit was made — one of CORRECTION_REASONS (correctionReasons.ts),
   * already resolved through resolveReason() if 'Other' was picked. Required
   * by every caller for action 'update' (enforced client-side, same as
   * CorrectionRequestDialog/EditValueModal — see
   * 20260809_reading_edit_audit_log_reason.sql for why this isn't a DB-level
   * NOT NULL). Left undefined for 'delete'/'import', which don't require one.
   */
  reason?: string | null;
}) {
  try {
    await (supabase.from('reading_edit_audit_log' as any) as any).insert([{
      table_name:    entry.table_name,
      record_id:     entry.record_id,
      plant_id:      entry.plant_id,
      train_id:      entry.train_id ?? null,
      action:        entry.action ?? 'update',
      actor_user_id: entry.actor_user_id,
      actor_label:   entry.actor_label,
      changes:       entry.changes ?? null,
      reason:        entry.reason ?? null,
    }]);
  } catch { /* silently ignore if table missing — migration not yet run */ }
}

// ─── recalculateTrainDeltas ──────────────────────────────────────────────────
// Re-walks all feed, permeate, and reject meter readings for a train in
// chronological order and corrects feed_meter_delta / permeate_meter_delta /
// reject_meter_delta so the Dashboard's production totals remain accurate
// after any edit, delete, or meter-replacement toggle.
//
// All three meters are fixed in a single ascending pass so one Supabase query
// covers every column and the three "prev" baselines stay in sync.
//
// This is the ONE canonical implementation — as of the 2026-08-22
// god-component extraction, two other private copies of this exact function
// existed (plants/trains/TrainDetail.tsx -- since split up, this logic lived
// in its TrainOperatorLogModal piece -- and DataAnalysis.tsx), each
// independently drifted: the TrainDetail.tsx one never recalculated
// feed_meter_delta at all (permeate +
// reject only), and DataAnalysis.tsx's only ever recalculated permeate_meter
// _delta (feed and reject both silently went stale after every regression
// correction it applied). Both now import this one instead. If you need to
// change this function's behavior, this is the only file to touch — grep
// for `recalculateTrainDeltas` across the repo to confirm before assuming
// otherwise.
//
// ── HYBRID STRATEGY (permeate only) ─────────────────────────────────────────
// After every successful DB write to permeate_meter_delta this function also
// calls deltaCache.set() with the freshly-computed value so the Dashboard and
// TrendChart pick it up immediately (Tier-1 cache shortcut) without waiting
// for a refetch. Feed and reject deltas are not Dashboard-cached (display-
// only in the operator log / DataAnalysis) so no equivalent sync is needed
// for those two.

export async function recalculateTrainDeltas(trainId: string): Promise<void> {
  try {
    const { data: rows } = await (supabase.from('ro_train_readings' as any) as any)
      .select(
        'id, reading_datetime, feed_meter, feed_meter_delta, permeate_meter, permeate_meter_delta, reject_meter, reject_meter_delta, ' +
        'is_meter_replacement, is_feed_meter_replacement, is_permeate_meter_replacement, is_reject_meter_replacement',
      )
      .eq('train_id', trainId)
      .order('reading_datetime', { ascending: true });
    if (!rows?.length) return;

    let prevFeedMeter: number | null = null;
    let prevMeter:      number | null = null;
    let prevRejMeter:   number | null = null;

    for (const row of rows as any[]) {
      const dateKey = row.reading_datetime
        ? new Date(row.reading_datetime).toLocaleDateString('en-CA') // YYYY-MM-DD
        : null;

      // ── Feed delta ────────────────────────────────────────────────────────
      // Only the granular is_feed_meter_replacement flag zeros the feed delta —
      // same rationale as the reject branch below (is_meter_replacement alone,
      // pre-migration, meant a permeate-only swap).
      const isFeedRepl   = !!(row.is_feed_meter_replacement);
      const curFeedMeter = row.feed_meter != null ? +row.feed_meter : null;
      const storedFeed   = row.feed_meter_delta != null ? +row.feed_meter_delta : null;
      let newFeedDelta: number | null;
      if (isFeedRepl)                                        { newFeedDelta = 0; }
      else if (prevFeedMeter != null && curFeedMeter != null) { newFeedDelta = Math.max(0, curFeedMeter - prevFeedMeter); }
      else                                                   { newFeedDelta = null; }
      if (curFeedMeter != null) prevFeedMeter = curFeedMeter;
      if (newFeedDelta !== storedFeed) {
        await (supabase.from('ro_train_readings' as any) as any)
          .update({ feed_meter_delta: newFeedDelta })
          .eq('id', row.id);
      }

      // ── Permeate delta ────────────────────────────────────────────────────
      // is_permeate_meter_replacement is the granular source of truth as of the
      // 2026-07-27 migration; is_meter_replacement is kept in sync by a DB
      // trigger (OR of feed/permeate/reject) but OR'ing both here too so this
      // still behaves correctly against a DB that hasn't run that migration yet.
      const isPermRepl = !!(row.is_permeate_meter_replacement || row.is_meter_replacement);
      const curMeter   = row.permeate_meter != null ? +row.permeate_meter : null;
      const stored     = row.permeate_meter_delta != null ? +row.permeate_meter_delta : null;
      let newDelta: number | null;
      if (isPermRepl)                              { newDelta = 0; }
      else if (prevMeter != null && curMeter != null) { newDelta = Math.max(0, curMeter - prevMeter); }
      else                                         { newDelta = null; }
      if (curMeter != null) prevMeter = curMeter;
      if (newDelta !== stored) {
        await (supabase.from('ro_train_readings' as any) as any)
          .update({ permeate_meter_delta: newDelta })
          .eq('id', row.id);
      }

      // ── HYBRID STRATEGY: sync in-memory delta cache (permeate only) ───────
      if (dateKey) {
        if (newDelta !== null) {
          deltaCache.set(trainId, dateKey, newDelta, 'stored');
        } else {
          deltaCache.invalidate(trainId);
        }
      }

      // ── Reject delta ──────────────────────────────────────────────────────
      // Only the granular is_reject_meter_replacement flag zeros the reject
      // delta.  Pre-migration rows with is_meter_replacement=true but no
      // granular flag were permeate-only replacements — don't zero reject there.
      const isRejRepl   = !!(row.is_reject_meter_replacement);
      const curRejMeter = row.reject_meter != null ? +row.reject_meter : null;
      const storedRej   = row.reject_meter_delta != null ? +row.reject_meter_delta : null;
      let newRejDelta: number | null;
      if (isRejRepl)                                       { newRejDelta = 0; }
      else if (prevRejMeter != null && curRejMeter != null) { newRejDelta = Math.max(0, curRejMeter - prevRejMeter); }
      else                                                 { newRejDelta = null; }
      if (curRejMeter != null) prevRejMeter = curRejMeter;
      if (newRejDelta !== storedRej) {
        await (supabase.from('ro_train_readings' as any) as any)
          .update({ reject_meter_delta: newRejDelta })
          .eq('id', row.id);
      }
    }
  } catch { /* non-critical */ }
}
