/**
 * lib/trainStatusLogWriter.ts
 *
 * The one shared writer for train_status_log status transitions.
 *
 * train_status_log used to be inserted from four independent, hand-rolled
 * call sites that didn't coordinate with each other:
 *   1. the 2h auto-flagger  (hooks/useTrainAutoOffline.ts)
 *   2. the operator offline→online save (pages/ROTrains/pretreatment/hooks/
 *      usePretreatmentActions.ts)
 *   3. the uptime-exemption attestation (hooks/useTrainUptimeExemption.ts)
 *   4. the manager quick-toggle (pages/plants/trains/TrainsList/TrainsList/
 *      index.tsx) — which had NO guard at all: it inserted unconditionally,
 *      never checked the train's latest logged status, and relied on the DB's
 *      now() default. That's the writer that produced the Train 7 · RO7
 *      "Offline Aug 19, 08:13 → 08:13 · 0m" duplicate banner (see
 *      RO_TRAIN_ALERT_SYSTEM_RECONCILIATION.md).
 *
 * Every row in train_status_log becomes a full-width banner in the Operator
 * Log, so any writer that lands a row on top of another writer's row renders
 * garbage. This function centralizes the guards:
 *
 *   1. It ALWAYS reads the train's actual latest train_status_log row first —
 *      never a locally-derived flag like `wasOffline` / `isEffectivelyOffline`
 *      (which can be stale by the time the write lands).
 *   2. It refuses to log a row that isn't a real transition (the train's
 *      latest logged status already equals the target).
 *   3. It refuses to log a row whose confirmed_at would not be strictly after
 *      the currently open segment's start — that's exactly what produces a
 *      zero-duration segment.
 *
 * Refusal means "no train_status_log row"; ro_trains.status is still updated
 * (idempotently), so a caller toggling into the already-logged state can't
 * leave ro_trains diverged from the log.
 *
 * Opt-outs, each with its reason spelled out at the call site:
 *   - allowBackdated  — the auto-flagger deliberately writes
 *     confirmed_at = last-reading-at, which can predate the open Running
 *     segment's start (operator attested back online at T1 without logging a
 *     reading; nothing has flowed since). That backdating is documented,
 *     intentional history reconstruction — not a duplicate.
 *   - allowNoTransition — the exemption's "Uptime reported: …" Running row is
 *     an audit record, not (only) a state transition: it must land even when
 *     the preceding row is already Running (the bogus Auto-flagged Offline
 *     row having just been deleted), because the attestation text is what
 *     TrainStatusBannerRow.canReportRunning and the audit trail match on.
 *
 * The operator offline→online save (usePretreatmentActions.ts) intentionally
 * does NOT route through here: its write shape is "UPDATE the open Offline
 * row's reason/confirmed_at, then INSERT the Running close" — a pair, driven
 * by form state, already guarded by its own latestStatusLog read and the
 * offlineStart < offlineEnd validation. The DB backstop
 * (fn_reject_duplicate_train_status_ts, migration
 * 20260916000002_train_status_log_no_identical_timestamps.sql) covers any
 * residue from that flow.
 */

import type { TrainRunStatus } from '@/lib/trainStatusTimeline';

export interface TrainStatusTransitionOpts {
  trainId: string;
  plantId: string;
  status: TrainRunStatus;
  /** Free-text reason stored in train_status_log.reason (null for plain "back online"). */
  reason?: string | null;
  /** profiles.id / users.id of whoever confirmed the change. */
  confirmedBy?: string | null;
  /**
   * Explicit confirmed_at (ISO string) for deliberately backdated or
   * form-driven timestamps. Omit for "now" — the manager quick-toggle's
   * original behavior.
   */
  confirmedAt?: string | null;
  /**
   * Skip the "must be strictly after the open segment's start" refusal. Only
   * for writers whose confirmed_at is deliberately historical (auto-flagger).
   */
  allowBackdated?: boolean;
  /**
   * Skip the "latest logged status must differ" refusal. Only for writers
   * whose row is an audit record that must exist regardless (exemption).
   */
  allowNoTransition?: boolean;
}

export type TrainStatusTransitionResult = {
  /** True when a train_status_log row was written. */
  logged: boolean;
  /** True when the ro_trains.status update was issued (attempted every call). */
  statusUpdated: boolean;
  /** Why the log row was skipped — undefined when logged. */
  skippedReason?: 'no-transition' | 'not-after-open-segment' | 'error';
  /** The underlying Supabase error when skippedReason === 'error'. */
  error?: unknown;
};

export async function recordTrainStatusTransition(
  supabase: any,
  opts: TrainStatusTransitionOpts,
): Promise<TrainStatusTransitionResult> {
  const confirmedAt = opts.confirmedAt ?? new Date().toISOString();

  // Guards 2+3's input: the train's ACTUAL latest log row — the source of
  // truth every hand-rolled writer used to skip (or approximate with a
  // locally-derived flag that could be stale by write time).
  const { data: latest, error: latestErr } = await supabase
    .from('train_status_log')
    .select('status, confirmed_at')
    .eq('train_id', opts.trainId)
    .order('confirmed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) {
    return { logged: false, statusUpdated: false, skippedReason: 'error', error: latestErr };
  }

  if (latest && !opts.allowNoTransition && latest.status === opts.status) {
    // Not a transition — the exact duplicate that renders a 0m banner.
    return { logged: false, statusUpdated: false, skippedReason: 'no-transition' };
  }

  if (latest && !opts.allowBackdated
    && new Date(confirmedAt).getTime() <= new Date(latest.confirmed_at).getTime()) {
    // Would land on or before the open segment's start — a zero/negative
    // duration segment no matter what the statuses are.
    return { logged: false, statusUpdated: false, skippedReason: 'not-after-open-segment' };
  }

  const { error: updErr } = await supabase
    .from('ro_trains')
    .update({ status: opts.status })
    .eq('id', opts.trainId);
  if (updErr) {
    return { logged: false, statusUpdated: false, skippedReason: 'error', error: updErr };
  }

  const { error: insErr } = await supabase.from('train_status_log').insert({
    train_id: opts.trainId,
    plant_id: opts.plantId,
    status: opts.status,
    reason: opts.reason ?? null,
    confirmed_by: opts.confirmedBy ?? null,
    confirmed_at: confirmedAt,
  });
  if (insErr) {
    // ro_trains was updated but the log row didn't land — the caller decides
    // whether that's fatal (exemption: yes; best-effort writers: warn only).
    return { logged: false, statusUpdated: true, skippedReason: 'error', error: insErr };
  }

  return { logged: true, statusUpdated: true };
}

