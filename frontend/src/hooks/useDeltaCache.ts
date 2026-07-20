/**
 * useDeltaCache.ts — Hybrid Strategy debug / diagnostic hook
 *
 * Provides React components with a live view of the in-memory delta cache.
 * Useful for admin panels, devtools overlays, and unit tests.
 *
 * Usage:
 *   const { size, flush, snapshot } = useDeltaCache();
 *
 *   // In a devtools panel:
 *   <p>{size} cached delta entries</p>
 *   <button onClick={flush}>Clear cache</button>
 */

import { useState, useCallback, useEffect } from 'react';
import { deltaCache, flushDeltaCache } from '@/lib/deltaCache';

export interface DeltaCacheStats {
  /** Number of live (non-expired) cache entries. */
  size: number;
  /**
   * Flush all or targeted entity entries.
   * Passing no argument clears the entire cache.
   */
  flush: (entityIds?: string[]) => void;
  /**
   * Snapshot of all live entries — useful for devtools tables.
   * Returns a stable reference; changes on each interval tick.
   */
  snapshot: ReturnType<typeof deltaCache.snapshot>;
  /** Whether the cache is completely empty. */
  isEmpty: boolean;
}

/**
 * Hook that polls the singleton deltaCache every `pollIntervalMs` milliseconds
 * and returns live stats.  Defaults to 2-second polling.
 *
 * @param pollIntervalMs - How often to re-read cache stats (default: 2000ms).
 *                         Pass 0 to disable polling (one-shot read on mount).
 */
export function useDeltaCache(pollIntervalMs = 2_000): DeltaCacheStats {
  const [stats, setStats] = useState<Omit<DeltaCacheStats, 'flush'>>(() => ({
    size: deltaCache.size,
    snapshot: deltaCache.snapshot(),
    isEmpty: deltaCache.size === 0,
  }));

  const refresh = useCallback(() => {
    setStats({
      size: deltaCache.size,
      snapshot: deltaCache.snapshot(),
      isEmpty: deltaCache.size === 0,
    });
  }, []);

  useEffect(() => {
    refresh();
    if (pollIntervalMs <= 0) return;
    const id = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(id);
  }, [refresh, pollIntervalMs]);

  const flush = useCallback((entityIds?: string[]) => {
    flushDeltaCache(entityIds);
    refresh();
  }, [refresh]);

  return { ...stats, flush };
}
