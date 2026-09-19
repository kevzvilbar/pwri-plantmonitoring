/**
 * shared/readingAudit.ts
 *
 * Generic reading edit audit logging and edit permission validation shared
 * across operations, wells, locators, product meters, reading history, and RO trains.
 */
import { supabase } from '@/integrations/supabase/client';

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

// Matches a Postgres/PostgREST timestamptz string like
// "2026-08-29T01:52:00+00:00" or the "...Z" ISO form JS's toISOString()
// produces — deliberately narrow (anchored, requires an explicit offset or
// Z) so it can't misfire on an unrelated string that merely starts with
// digits.
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

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
  // BUGFIX: every reading_datetime diff logged through this helper was a
  // false positive. Supabase/PostgREST returns timestamptz columns as
  // "...+00:00", but every saveEdit()/handleSave() in this codebase rebuilds
  // the value via `new Date(...).toISOString()`, which always yields
  // "...000Z" — the identical instant, a different string. Compared as raw
  // strings (the previous behavior), those two ALWAYS looked "changed" even
  // when the operator never touched the timestamp — confirmed live: 100% of
  // update edits on well_readings, power_readings, blending_events,
  // ro_train_readings and ro_pretreatment_readings carried this phantom
  // entry, and for edits where nothing else was touched either, it was the
  // *only* recorded change — masking, e.g., an edit reason like "data entry
  // typo" that reviewers would reasonably read as "the value was corrected"
  // when in fact it never was. Parsing both sides to the same instant before
  // comparing fixes this at the source for every diffFields() caller.
  if (typeof value === 'string' && ISO_DATETIME_RE.test(value)) {
    const t = new Date(value).getTime();
    if (!isNaN(t)) return new Date(t).toISOString();
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
