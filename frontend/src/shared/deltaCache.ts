/**
 * deltaCache.ts — Hybrid Strategy: Backend + Frontend Delta Handling
 *
 * Tier 1 (Backend/Storage Layer)
 *   Stored columns: `daily_volume` (locator_readings, well_readings),
 *   `permeate_meter_delta` (ro_train_readings).  Written at insert time and
 *   recomputed on-demand by Plants.tsx `recomputePermeateDeltas`.
 *   Invalidation: every mutating operation (insert / update / delete / import)
 *   calls `deltaCache.invalidate(entityId)` so the in-memory shortcut is
 *   cleared and the next render re-derives from raw meter values.
 *
 * Tier 2 (Frontend Cache Layer)
 *   This module: an in-memory Map keyed by "entityId::yyyy-MM-dd".
 *   Dashboard and TrendChart check the cache before recomputing from raw rows.
 *   A hit returns immediately (no recomputation).  A miss recomputes from raw
 *   readings and stores the result here for subsequent renders in the same
 *   session.  TTL defaults to 5 minutes; each insert call resets affected keys.
 *
 * Tier 3 (Raw Fallback)
 *   If a cache entry is absent or expired, the caller computes the delta from
 *   raw current_reading / permeate_meter values exactly as before.  This
 *   guarantees correctness even when the backend delta column is stale.
 *
 * Usage:
 *   import { deltaCache } from '@/lib/deltaCache';
 *
 *   // Read
 *   const cached = deltaCache.get(locatorId, '2026-05-21');
 *   if (cached !== null) return cached;          // fast path
 *   const computed = computeFromRaw(...);
 *   deltaCache.set(locatorId, '2026-05-21', computed);
 *   return computed;
 *
 *   // Invalidate after mutation
 *   deltaCache.invalidate(locatorId);            // one entity
 *   deltaCache.invalidateMany([id1, id2]);       // batch
 *   deltaCache.invalidateAll();                  // full flush (e.g. plant switch)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeltaSource = 'computed' | 'stored';

export interface DeltaCacheEntry {
  value: number;
  computedAt: number;   // Date.now() timestamp
  source: DeltaSource;
}

// ─── Configuration ────────────────────────────────────────────────────────────

/** Cache entry lifetime in milliseconds (default: 5 minutes). */
const DEFAULT_TTL_MS = 5 * 60 * 1_000;

// ─── DeltaCache class ─────────────────────────────────────────────────────────

class DeltaCache {
  private store = new Map<string, DeltaCacheEntry>();
  private ttl: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttl = ttlMs;
  }

  // ── Key helpers ─────────────────────────────────────────────────────────────

  /** Canonical cache key: "<entityId>::<yyyy-MM-dd>" */
  private cacheKey(entityId: string, dateKey: string): string {
    return `${entityId}::${dateKey}`;
  }

  /** Normalise an ISO datetime or date string to yyyy-MM-dd. */
  static normDateKey(isoOrDate: string): string {
    return isoOrDate.slice(0, 10);
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  /**
   * Returns the cached delta for (entityId, dateKey), or `null` if absent /
   * expired.  Callers should fall back to raw computation on null.
   */
  get(entityId: string, dateKey: string): number | null {
    const k = this.cacheKey(entityId, dateKey);
    const entry = this.store.get(k);
    if (!entry) return null;
    if (Date.now() - entry.computedAt > this.ttl) {
      this.store.delete(k);
      return null;
    }
    return entry.value;
  }

  /**
   * Returns all cached date→delta pairs for a given entity.
   * Used by TrendChart to short-circuit series computation.
   */
  getAll(entityId: string): Map<string, number> {
    const result = new Map<string, number>();
    const prefix = `${entityId}::`;
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (!k.startsWith(prefix)) continue;
      if (now - v.computedAt > this.ttl) { this.store.delete(k); continue; }
      result.set(k.slice(prefix.length), v.value);  // dateKey → value
    }
    return result;
  }

  // ── Write ───────────────────────────────────────────────────────────────────

  /**
   * Store a computed delta for (entityId, dateKey).
   * `source` distinguishes freshly-computed values from stored-column values
   * so diagnostic tooling can tell which path was taken.
   */
  set(
    entityId: string,
    dateKey: string,
    value: number,
    source: DeltaSource = 'computed',
  ): void {
    this.store.set(this.cacheKey(entityId, dateKey), {
      value,
      computedAt: Date.now(),
      source,
    });
  }

  /**
   * Populate the cache from a pre-built pivot (Map<dateKey, Map<entityId, delta>>).
   * Called by computePivotFromReadings and computeRoPermPivot after they build
   * the full pivot so subsequent renders skip recomputation.
   */
  populateFromPivot(
    pivot: Map<string, Map<string, number>>,
    source: DeltaSource = 'computed',
  ): void {
    const now = Date.now();
    pivot.forEach((entityMap, dateKey) => {
      entityMap.forEach((delta, entityId) => {
        this.store.set(this.cacheKey(entityId, dateKey), {
          value: delta,
          computedAt: now,
          source,
        });
      });
    });
  }

  /**
   * Populate from a flat array of { entityId, dateKey, delta } objects.
   * Convenience form used by the DataSummaryModal batch-load path.
   */
  populateFromArray(
    entries: Array<{ entityId: string; dateKey: string; delta: number; source?: DeltaSource }>,
  ): void {
    const now = Date.now();
    for (const { entityId, dateKey, delta, source = 'computed' } of entries) {
      this.store.set(this.cacheKey(entityId, dateKey), {
        value: delta,
        computedAt: now,
        source,
      });
    }
  }

  // ── Invalidation ─────────────────────────────────────────────────────────────

  /**
   * Remove all cached entries for a single entity (e.g. one locator / one RO
   * train).  Call this immediately after any insert, update, or delete that
   * affects this entity's readings so the next render recomputes from raw data.
   */
  invalidate(entityId: string): void {
    const prefix = `${entityId}::`;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  /** Batch-invalidate multiple entities (e.g. after a multi-train CSV import). */
  invalidateMany(entityIds: string[]): void {
    entityIds.forEach((id) => this.invalidate(id));
  }

  /**
   * Invalidate a specific date range for one entity.
   * Useful when a row is edited — only the affected interval is cleared instead
   * of flushing the entire entity history.
   */
  invalidateRange(entityId: string, fromDate: string, toDate: string): void {
    const from = new Date(fromDate).getTime();
    const to   = new Date(toDate).getTime();
    const prefix = `${entityId}::`;
    for (const k of this.store.keys()) {
      if (!k.startsWith(prefix)) continue;
      const t = new Date(k.slice(prefix.length)).getTime();
      if (t >= from && t <= to) this.store.delete(k);
    }
  }

  /**
   * Full cache flush.  Call when the active plant selection changes or when a
   * bulk re-normalisation is run from the Admin panel.
   */
  invalidateAll(): void {
    this.store.clear();
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────────

  /** Number of currently live (non-expired) cache entries. */
  get size(): number {
    const now = Date.now();
    let count = 0;
    for (const v of this.store.values()) {
      if (now - v.computedAt <= this.ttl) count++;
    }
    return count;
  }

  /** Snapshot of all live entries (useful for devtools / unit tests). */
  snapshot(): Array<{ entityId: string; dateKey: string } & DeltaCacheEntry> {
    const now = Date.now();
    const result: Array<{ entityId: string; dateKey: string } & DeltaCacheEntry> = [];
    for (const [k, v] of this.store) {
      if (now - v.computedAt > this.ttl) continue;
      const [entityId, dateKey] = k.split('::');
      result.push({ entityId, dateKey, ...v });
    }
    return result;
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

/**
 * Shared singleton used across Dashboard, TrendChart, ROTrains, Operations, and
 * Plants.  A single instance guarantees invalidations from one page are
 * immediately visible to queries on another (e.g. Operations saves a locator
 * reading → Dashboard re-renders with fresh data without a refetch).
 */
export const deltaCache = new DeltaCache();

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Helper used by invalidateDashboard (Operations, ROTrains) to flush the
 * in-memory delta cache at the same time as React Query keys are invalidated.
 * Pass `entityIds` to do a targeted flush; omit to flush everything.
 */
export function flushDeltaCache(entityIds?: string[]): void {
  if (!entityIds || entityIds.length === 0) {
    deltaCache.invalidateAll();
  } else {
    deltaCache.invalidateMany(entityIds);
  }
}

/**
 * Hydrate the cache from stored column values (the Tier-1 backend shortcut).
 * Call this inside useQuery `onSuccess` callbacks so that if the DB delta
 * columns are populated and fresh, the frontend never needs to recompute.
 *
 * @param rows    - Raw DB rows (must contain entityKey + deltaField + dateField).
 * @param entityKey - Row field that identifies the entity (e.g. 'locator_id').
 * @param deltaField - Row field holding the stored delta (e.g. 'daily_volume').
 * @param dateField  - Row field holding the reading datetime (e.g. 'reading_datetime').
 */
export function hydrateFromStoredDeltas(
  rows: any[],
  entityKey: string,
  deltaField: string,
  dateField: string,
): void {
  for (const r of rows) {
    const entityId = r[entityKey];
    const raw      = r[deltaField];
    const dateKey  = DeltaCache.normDateKey(r[dateField]);
    if (entityId && raw != null && !isNaN(+raw)) {
      // Only hydrate if not already in cache (computed values take precedence).
      if (deltaCache.get(entityId, dateKey) === null) {
        deltaCache.set(entityId, dateKey, Math.max(0, +raw), 'stored');
      }
    }
  }
}
