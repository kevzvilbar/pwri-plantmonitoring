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
import { useCallback, useEffect, useMemo, useRef } from 'react';
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

const OUTBOX_KEY = 'pwri-alert-event-outbox';

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

// ── Outbox (localStorage) ───────────────────────────────────────────────────
// Kept outside React so the flush helper is usable from anywhere and so a
// failed write from a component that unmounts immediately (the bell panel
// closes on action) is not lost.

function readOutbox(): AlertEventInsert[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AlertEventInsert[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(rows: AlertEventInsert[]): void {
  try {
    if (rows.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(rows));
  } catch { /* Safari private mode / quota — the event is simply lost, as before */ }
}

/** Insert one event, falling back to the outbox when the network refuses. */
async function persistEvent(row: AlertEventInsert): Promise<boolean> {
  try {
    const { error } = await supabase.from('alert_events').insert(row);
    if (!error) return true;
  } catch { /* network down — fall through to the queue */ }
  writeOutbox([...readOutbox(), row]);
  return false;
}

/** Flush queued events. Stops at the first failure so ordering is preserved. */
export async function flushAlertEventOutbox(): Promise<number> {
  const queued = readOutbox();
  if (queued.length === 0) return 0;
  let sent = 0;
  for (const row of queued) {
    try {
      const { error } = await supabase.from('alert_events').insert(row);
      if (error) break;
      sent += 1;
    } catch {
      break;
    }
  }
  if (sent > 0) writeOutbox(readOutbox().slice(sent));
  return sent;
}

/** Test/debug helper — how many writes are still waiting to reach the DB. */
export function alertEventOutboxSize(): number {
  return readOutbox().length;
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
  const flushedRef = useRef(false);

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

  // Flush anything queued while offline. Runs once per mount, and again the
  // moment the browser reports it is back online.
  useEffect(() => {
    if (!user || !isOnline || flushedRef.current) return;
    flushedRef.current = true;
    void flushAlertEventOutbox().then((sent) => {
      if (sent > 0) qc.invalidateQueries({ queryKey: ['alert-events'] });
    });
  }, [user, isOnline, qc]);

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
      return persistEvent(row);
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
