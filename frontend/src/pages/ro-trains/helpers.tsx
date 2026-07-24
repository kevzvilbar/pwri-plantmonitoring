/**
 * ro-trains/helpers.tsx
 *
 * Utility functions and the Sparkline micro-component shared across the RO
 * Train sub-components.  Extracted from ROTrains.tsx (§4 item 2 decomposition).
 */
import React from 'react';
import { supabase } from '@/integrations/supabase/client';

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

export function Sparkline({
  values,
  color = 'currentColor',
}: {
  values: number[];
  color?: string;
}) {
  if (values.length < 2)
    return <span className="text-[10px] text-muted-foreground/40">—</span>;
  const w = 48; const h = 16;
  const min = Math.min(...values); const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block align-middle">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
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

export const EDIT_WINDOW_HOURS = 8;

export function canEditEntry(
  row: { recorded_by?: string | null; created_at?: string | null } | null | undefined,
  hasFullAccess: boolean,
  activeOperatorId: string | null | undefined,
): boolean {
  if (hasFullAccess) return true;
  if (!row || !activeOperatorId || !row.recorded_by) return false;
  if (row.recorded_by !== activeOperatorId) return false;
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
  table_name: 'ro_train_readings' | 'ro_pretreatment_readings' | 'chemical_dosing_logs';
  /** Nullable for 'import' action — a CSV batch covers N records, not one. */
  record_id?: string | null;
  plant_id: string | null;
  train_id?: string | null;
  action?: 'update' | 'delete' | 'import';
  actor_user_id: string | null;
  actor_label: string | null;
  /** For update/delete: { field: { old, new } }. For import: metadata blob. */
  changes?: Record<string, any>;
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
    }]);
  } catch { /* silently ignore if table missing — migration not yet run */ }
}

// ─── recalculateTrainDeltas ──────────────────────────────────────────────────
// Re-walks all permeate_meter readings for a train in chronological order and
// corrects permeate_meter_delta so the Dashboard's production totals remain
// accurate after any edit, delete, or meter-replacement toggle.

export async function recalculateTrainDeltas(trainId: string): Promise<void> {
  try {
    const { data: rows } = await (supabase.from('ro_train_readings' as any) as any)
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
      if (isRepl)                              { newDelta = 0; }
      else if (prevMeter != null && curMeter != null) { newDelta = Math.max(0, curMeter - prevMeter); }
      else                                     { newDelta = null; }
      if (curMeter != null) prevMeter = curMeter;
      if (newDelta !== stored) {
        await (supabase.from('ro_train_readings' as any) as any)
          .update({ permeate_meter_delta: newDelta })
          .eq('id', row.id);
      }
    }
  } catch { /* non-critical */ }
}
