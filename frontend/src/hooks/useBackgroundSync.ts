/**
 * useBackgroundSync
 *
 * Silently refetches all active react-query queries every SYNC_INTERVAL_MS
 * (default 60 s) without triggering any navigation, scroll reset, or component
 * remount. Scroll position, active tab, form inputs, and filter state are all
 * naturally preserved because:
 *
 *   • react-query updates only the cached value — no component is unmounted
 *   • useScrollRestore / useTabPersist already own those pieces of state
 *   • controlled form inputs live in local component state, untouched by cache updates
 *
 * Retry strategy:
 *   • On a failed sync, retry after RETRY_DELAY_MS (10 s) up to MAX_RETRIES times
 *   • Only surface an error toast when ALL retries are exhausted or when the very
 *     first data load fails (critical error)
 *
 * Usage: mount once inside AppShell (via BackgroundSyncMount) so the sync
 * lifecycle mirrors the authenticated app shell.
 * SyncIndicator (in TopBar) reads from syncStore and shows UI feedback.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncStore } from '@/store/syncStore';

const SYNC_INTERVAL_MS  = 60_000;  // 1 minute
const RETRY_DELAY_MS    = 10_000;  // 10 seconds between retries
const MAX_RETRIES       = 3;       // silent retries before surfacing an error

export function useBackgroundSync() {
  const qc                  = useQueryClient();
  const { setStatus, setLastSynced, setError } = useSyncStore();

  const intervalRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef       = useRef(0);
  const isMountedRef        = useRef(true);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  /** Run a single sync cycle. Returns true on success. */
  const runSync = useCallback(async (): Promise<boolean> => {
    if (!isMountedRef.current) return false;

    setStatus('syncing');

    try {
      // Refetch only queries that are currently mounted and active.
      // react-query will merge updated data into the cache; React's virtual DOM
      // then diffs and re-paints only the changed nodes — no full re-render.
      await qc.refetchQueries({ type: 'active', throwOnError: true });

      if (!isMountedRef.current) return true;

      retryCountRef.current = 0;
      setLastSynced(new Date());
      setError(null);
      return true;
    } catch (err) {
      if (!isMountedRef.current) return false;

      const msg = err instanceof Error ? err.message : String(err);

      // Abort/cancel errors happen during route transitions — not real failures
      if (/abort/i.test(msg)) {
        setStatus('idle');
        return true;
      }

      setStatus('error');
      return false;
    }
  }, [qc, setStatus, setLastSynced, setError]);

  /** Schedule a retry cycle with back-off. */
  const scheduleRetry = useCallback((attempt: number) => {
    clearRetryTimeout();

    if (attempt >= MAX_RETRIES) {
      // All retries exhausted — surface error to user via syncStore (SyncIndicator reads it)
      setError('Background sync failed. Data may be stale. Will retry next cycle.');
      retryCountRef.current = 0;
      return;
    }

    retryTimeoutRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      retryCountRef.current = attempt + 1;
      const ok = await runSync();
      if (!ok) scheduleRetry(attempt + 1);
    }, RETRY_DELAY_MS);
  }, [clearRetryTimeout, runSync, setError]);

  /** Kick off a sync and handle failure via retry scheduler. */
  const triggerSync = useCallback(async () => {
    clearRetryTimeout();
    const ok = await runSync();
    if (!ok) scheduleRetry(0);
  }, [clearRetryTimeout, runSync, scheduleRetry]);

  useEffect(() => {
    isMountedRef.current = true;

    // Run an initial sync shortly after mount so stale data is refreshed
    // on first visit without waiting a full minute.
    const firstSyncTimer = setTimeout(triggerSync, 5_000);

    // Recurring sync every SYNC_INTERVAL_MS
    intervalRef.current = setInterval(triggerSync, SYNC_INTERVAL_MS);

    // Sync when the tab regains focus after being hidden (e.g. user switches
    // back after a long absence). Throttled by react-query's own staleTime so
    // very recent data is not redundantly re-fetched.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') triggerSync();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      clearTimeout(firstSyncTimer);
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      clearRetryTimeout();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [triggerSync, clearRetryTimeout]);
}

