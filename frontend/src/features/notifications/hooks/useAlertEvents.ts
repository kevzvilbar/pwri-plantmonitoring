/**
 * useAlertEvents — P3-2 of docs/NAV-IA-REMEDIATION-PLAN.md
 *
 * Persists acknowledge / resolve / snooze / reopen actions to
 * `public.alert_events` so an acknowledgement survives a page reload, a
 * recompute, and is visible to a second user on the same plant.
 *
 * Offline-first: the field app advertises offline reading capture, so these
 * writes go through the same *localStorage outbox* pattern already used by
 * `usePlantMeterConfig` (features/plants/shared.tsx — UNSYNCED_CONFIG_LS +
 * retry-on-mount). A failed insert is queued with its full payload and flushed
 * the next time the hook mounts or the browser reports itself online.
 *
 * Status is derived server-side by `get_alert_statuses()`, which returns the
 * latest event per alert_key with the snooze window already applied.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { Database } from '@/integrations/supabase/types';
import type { AlertStatus } from '@/store/alertStore';

export type AlertEventAction = 'acknowledged' | 'resolved' | 'snoozed' | 'reopened';

type AlertEventInsert = Database['public']['Tables']['alert_events']['Insert'];

/** Latest derived status per alert_key, as returned by get_alert_statuses(). */
export interface AlertServerStatus {
  status: AlertStatus;
  user_id: string | null;
  note: string | null;
  snooze_until: string | null;
  created_at: string;
}

export type AlertServerStatusMap = Record<string, AlertServerStatus>;

export const EMPTY_ALERT_STATUSES: AlertServerStatusMap = {};

export const OUTBOX_KEY_PREFIX = 'pwri-alert-event-outbox:';
const LEGACY_OUTBOX_KEY = 'pwri-alert-event-outbox';

export function getOutboxKey(userId?: string | null): string {
  return userId ? `${OUTBOX_KEY_PREFIX}${userId}` : LEGACY_OUTBOX_KEY;
}

/**
 * Move whatever is still sitting in the pre-partition shared key into each
 * row's own owner's key (a row with no `user_id` — queued before that field
 * was even written — is adopted by whoever is signed in now, since that is
 * who the server would have attributed it to).
 *
 * Without this, a row queued before this file started keying the outbox by
 * user is invisible forever: `flushAlertEventOutbox` is only ever called with
 * a signed-in user's id (see the hook below), which reads
 * `${OUTBOX_KEY_PREFIX}<uid>`, never `LEGACY_OUTBOX_KEY`. The row is not lost
 * to an error, it is simply never read again.
 */
function adoptLegacyOutbox(currentUserId: string): void {
  const legacy = readOutbox(null);
  if (legacy.length === 0) return;
  const byOwner = new Map<string, AlertEventInsert[]>();
  for (const row of legacy) {
    const owner = row.user_id ?? currentUserId;
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), row]);
  }
  byOwner.forEach((rows, owner) => writeOutbox(owner, [...readOutbox(owner), ...rows]));
  writeOutbox(null, []);
}

/** D2: snooze caps at 24 h and is never allowed for critical alerts. */
export const MAX_SNOOZE_MS = 24 * 60 * 60 * 1000;

export function isSnoozeAllowed(severity: string, durationMs: number): boolean {
  if (severity === 'critical') return false;
  return durationMs > 0 && durationMs <= MAX_SNOOZE_MS;
}

/** D2: resolving an alert derived from live data requires a note. */
export function canResolve(note: string): boolean {
  return note.trim().length > 0;
}

/**
 * Classifies an error from supabase.from('alert_events').insert() as retryable
 * (transient network outage, 5xx server error, rate limit 429) or non-retryable
 * (4xx client errors, RLS 42501 violations, constraint violations 23503/23505).
 * Non-retryable errors are dropped from the outbox so they never cause head-of-line blocking.
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;

  const err = error as { message?: string; code?: string; status?: number; statusCode?: number };
  const status = err.status ?? err.statusCode;
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }

  const msg = String(err.message || '').toLowerCase();
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('load failed') ||
    msg.includes('fetch failed') ||
    msg.includes('connection') ||
    msg.includes('abort')
  ) {
    return true;
  }

  // Postgres error code prefixes:
  // 42xxx: syntax / privileges / RLS policy violation -> non-retryable
  // 23xxx: integrity constraint violation (e.g. foreign key, unique) -> non-retryable
  // 22xxx: data exception -> non-retryable
  // 08xxx: connection exception -> retryable
  if (err.code) {
    if (err.code.startsWith('08')) return true;
    if (err.code.startsWith('42') || err.code.startsWith('23') || err.code.startsWith('22')) {
      return false;
    }
  }

  if (error instanceof TypeError) return true;

  return false;
}

// ── Outbox (localStorage) ───────────────────────────────────────────────────
// Kept outside React so the flush helper is usable from anywhere and so a
// failed write from a component that unmounts immediately (the bell panel
// closes on action) is not lost.
// Partitioned by user ID so shared tablets don't attempt to replay User A's
// writes under User B's session (triggering RLS 42501 violations).

export function readOutbox(userId?: string | null): AlertEventInsert[] {
  try {
    const key = getOutboxKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AlertEventInsert[]) : [];
  } catch {
    return [];
  }
}

export function writeOutbox(userId: string | null | undefined, rows: AlertEventInsert[]): void {
  try {
    const key = getOutboxKey(userId);
    if (rows.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(rows));
  } catch { /* Safari private mode / quota — the event is simply lost, as before */ }
}

/** Insert one event, falling back to the outbox when the network refuses. */
export async function persistEvent(row: AlertEventInsert, userId?: string | null): Promise<boolean> {
  const uid = userId ?? row.user_id ?? null;
  try {
    const { error } = await supabase.from('alert_events').insert(row);
    if (!error) return true;
    if (!isRetryableError(error)) {
      console.warn('[useAlertEvents] Dropping non-retryable alert event insert error:', error);
      return false;
    }
  } catch (err) {
    if (!isRetryableError(err)) {
      console.warn('[useAlertEvents] Dropping non-retryable alert event insert exception:', err);
      return false;
    }
  }
  writeOutbox(uid, [...readOutbox(uid), row]);
  return false;
}

/**
 * Flush queued events for a user. Stops at the first retryable failure so ordering
 * is preserved; drops non-retryable failures so the queue never gets permanently blocked.
 */
export async function flushAlertEventOutbox(userId?: string | null): Promise<number> {
  if (userId) adoptLegacyOutbox(userId);
  const queued = readOutbox(userId);
  if (queued.length === 0) return 0;
  let sent = 0;
  const remaining: AlertEventInsert[] = [];

  for (let i = 0; i < queued.length; i++) {
    const row = queued[i];
    // Guard against wrong user_id if flushing under a specific user session
    if (userId && row.user_id && row.user_id !== userId) {
      remaining.push(row);
      continue;
    }

    try {
      const { error } = await supabase.from('alert_events').insert(row);
      if (error) {
        if (isRetryableError(error)) {
          // Network or transient error: stop and preserve this row and subsequent items
          remaining.push(...queued.slice(i));
          break;
        } else {
          // Non-retryable error (e.g. 403 RLS violation, foreign key constraint):
          // Drop it so head-of-line blocking does not prevent subsequent items
          console.warn('[useAlertEvents] Dropping non-retryable queued alert event:', error, row);
          continue;
        }
      }
      sent += 1;
    } catch (err) {
      if (isRetryableError(err)) {
        remaining.push(...queued.slice(i));
        break;
      } else {
        console.warn('[useAlertEvents] Dropping non-retryable queued alert event on exception:', err, row);
        continue;
      }
    }
  }

  writeOutbox(userId, remaining);
  return sent;
}

/** Test/debug helper — how many writes are still waiting to reach the DB. */
export function alertEventOutboxSize(userId?: string | null): number {
  if (userId) return readOutbox(userId).length;
  let total = readOutbox(null).length;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(OUTBOX_KEY_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) total += parsed.length;
        }
      }
    }
  } catch { /* ignore */ }
  return total;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface AlertEventInput {
  alertKey: string;
  action: AlertEventAction;
  plantId?: string | null;
  note?: string;
  snoozeUntil?: string | null;
}

export interface UseAlertEventsResult {
  /** alert_key → derived status. Empty until the first successful fetch. */
  statuses: AlertServerStatusMap;
  /** True once get_alert_statuses() has resolved at least once. */
  loaded: boolean;
  /** Record an action. Resolves false when it had to be queued offline. */
  record: (input: AlertEventInput) => Promise<boolean>;
  isRecording: boolean;
}

export function useAlertEvents(plantIds: string[] = []): UseAlertEventsResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isOnline = useOnlineStatus();
  const plantIdsKey = plantIds.join(',');

  const { data, isSuccess } = useQuery({
    queryKey: ['alert-events', 'statuses', plantIdsKey],
    queryFn: async (): Promise<AlertServerStatusMap> => {
      const { data: rows, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }).rpc('get_alert_statuses', { p_plant_ids: plantIds.length ? plantIds : null });
      if (error) throw error;
      return (rows ?? EMPTY_ALERT_STATUSES) as AlertServerStatusMap;
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    // A missing table (migration not applied yet) must not spam toasts — the
    // caller simply falls back to the in-memory store.
    retry: 0,
    meta: { silent: true },
  });

  // Flush anything queued while offline for this user. Runs once per mount/user switch,
  // and again the moment the browser reports it is back online.
  useEffect(() => {
    if (!user?.id || !isOnline) return;
    void flushAlertEventOutbox(user.id).then((sent) => {
      if (sent > 0) qc.invalidateQueries({ queryKey: ['alert-events'] });
    });
  }, [user?.id, isOnline, qc]);

  const mutation = useMutation({
    mutationFn: async (input: AlertEventInput) => {
      const row: AlertEventInsert = {
        alert_key: input.alertKey,
        action: input.action,
        plant_id: input.plantId || null,
        note: input.note?.trim() || null,
        snooze_until: input.snoozeUntil ?? null,
        // user_id defaults to auth.uid() server-side, but sending it keeps the
        // queued row self-describing when it is replayed later.
        ...(user?.id ? { user_id: user.id } : {}),
      };
      return persistEvent(row, user?.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alert-events'] });
    },
  });

  const record = useCallback(
    (input: AlertEventInput) => mutation.mutateAsync(input),
    [mutation],
  );

  const statuses = useMemo(() => data ?? EMPTY_ALERT_STATUSES, [data]);

  return {
    statuses,
    loaded: isSuccess,
    record,
    isRecording: mutation.isPending,
  };
}
