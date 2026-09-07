import { sanitizeReadings } from '@/lib/readingSanitizer';
import { deltaCache, hydrateFromStoredDeltas } from '@/lib/deltaCache';
import { format } from 'date-fns';

/**
 * Replacement-aware delta pivot — mirrors TrendChart.tsx `computeEntityDeltas`.
 *
 * ── HYBRID STRATEGY (Tier 1 → Tier 2 → Tier 3) ──────────────────────────────
 * Tier 1: Per (entity, date) pair the function first checks `deltaCache`.
 *         If a fresh entry exists it is used directly — no row-walking needed.
 * Tier 2: Cache miss → walk raw readings and derive the delta mathematically.
 *         The result is written back to `deltaCache` for the current session.
 * Tier 3: Raw fallback — `hydrateFromStoredDeltas` is called by the query's
 *         `onSuccess` handler to pre-seed the cache from DB stored values
 *         (daily_volume, permeate_meter_delta) before this function runs.
 *         If the stored value is stale (was invalidated by a mutation), the
 *         cache entry is absent and Tier 2 takes over automatically.
 *
 * Groups readings by entityKeyField, walks them chronologically per entity:
 *   • is_meter_replacement row     → delta 0, set afterRepl flag
 *   • first row after replacement  → delta 0, clear flag
 *   • normal row w/ dailyVolumeField → use that value (clamped ≥ 0)
 *   • normal row w/o dailyVolumeField → current − last (clamped ≥ 0)
 *   • no predecessor yet (first in range) → current − previous_reading (DB field)
 *
 * Returns Map<dateKey yyyy-MM-dd, Map<entityKey, summed volume>>.
 * After building the full pivot, populates deltaCache for the session.
 */
export function computePivotFromReadingsNoCache(
  readings: any[],
  entityKeyField: string,
  dailyVolumeField: string | null,
  directModeIds?: Set<string>,
): Map<string, Map<string, number>> {
  const byEntity = new Map<string, any[]>();
  const cleanReadings = sanitizeReadings(readings, entityKeyField, directModeIds);
  cleanReadings.forEach((r) => {
    const k = r[entityKeyField] ?? '__';
    if (!byEntity.has(k)) byEntity.set(k, []);
    byEntity.get(k)!.push(r);
  });
  const pivot = new Map<string, Map<string, number>>();
  byEntity.forEach((rows, entityKey) => {
    const isDirect = directModeIds?.has(entityKey) ?? false;
    const sorted = rows;
    const lastReading = new Map<string, number>();
    const afterRepl   = new Set<string>();
    sorted.forEach((r) => {
      const isMR    = !!r.is_meter_replacement;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
      if (isMR) {
        lastReading.set(entityKey, +r.current_reading);
        afterRepl.add(entityKey);
        return;
      }
      if (afterRepl.has(entityKey)) {
        lastReading.set(entityKey, +r.current_reading);
        afterRepl.delete(entityKey);
        return;
      }
      let delta = 0;
      if (isDirect) {
        delta = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
        lastReading.set(entityKey, +r.current_reading);
      } else if (lastReading.has(entityKey)) {
        delta = +r.current_reading - lastReading.get(entityKey)!;
        lastReading.set(entityKey, +r.current_reading);
      } else if (dailyVolumeField && r[dailyVolumeField] != null) {
        delta = +r[dailyVolumeField];
        lastReading.set(entityKey, +r.current_reading);
      } else {
        if (r.previous_reading != null && r.current_reading != null)
          delta = +r.current_reading - +r.previous_reading;
        lastReading.set(entityKey, +r.current_reading);
      }
      const prev = pivot.get(dateKey)!.get(entityKey) ?? 0;
      pivot.get(dateKey)!.set(entityKey, prev + delta);
    });
  });
  return pivot;
}

/**
 * Replacement-aware delta pivot — mirrors TrendChart.tsx `computeEntityDeltas`.
 *
 * ── HYBRID STRATEGY (Tier 1 → Tier 2 → Tier 3) ──────────────────────────────
 * Tier 1: Per (entity, date) pair the function first checks `deltaCache`.
 *         If a fresh entry exists it is used directly — no row-walking needed.
 * Tier 2: Cache miss → walk raw readings and derive the delta mathematically.
 *         The result is written back to `deltaCache` for the current session.
 * Tier 3: Raw fallback — `hydrateFromStoredDeltas` is called by the query's
 *         `onSuccess` handler to pre-seed the cache from DB stored values
 *         (daily_volume, permeate_meter_delta) before this function runs.
 *         If the stored value is stale (was invalidated by a mutation), the
 *         cache entry is absent and Tier 2 takes over automatically.
 *
 * Groups readings by entityKeyField, walks them chronologically per entity:
 *   • is_meter_replacement row     → delta 0, set afterRepl flag
 *   • first row after replacement  → delta 0, clear flag
 *   • normal row w/ dailyVolumeField → use that value (clamped ≥ 0)
 *   • normal row w/o dailyVolumeField → current − last (clamped ≥ 0)
 *   • no predecessor yet (first in range) → current − previous_reading (DB field)
 *
 * Returns Map<dateKey yyyy-MM-dd, Map<entityKey, summed volume>>.
 * After building the full pivot, populates deltaCache for the session.
 */
export function computePivotFromReadings(
  readings: any[],
  entityKeyField: string,
  dailyVolumeField: string | null,
  directModeIds?: Set<string>,
): Map<string, Map<string, number>> {
  const byEntity = new Map<string, any[]>();
  const cleanReadings = sanitizeReadings(readings, entityKeyField, directModeIds);
  cleanReadings.forEach((r) => {
    const k = r[entityKeyField] ?? '__';
    if (!byEntity.has(k)) byEntity.set(k, []);
    byEntity.get(k)!.push(r);
  });
  const pivot = new Map<string, Map<string, number>>();
  byEntity.forEach((rows, entityKey) => {
    const isDirect = directModeIds?.has(entityKey) ?? false;
    const sorted = rows;
    const lastReading = new Map<string, number>();
    const afterRepl   = new Set<string>();
    sorted.forEach((r) => {
      const isMR    = !!r.is_meter_replacement;
      const dateKey = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!pivot.has(dateKey)) pivot.set(dateKey, new Map());
      if (isMR) {
        lastReading.set(entityKey, +r.current_reading);
        afterRepl.add(entityKey);
        return;
      }
      if (afterRepl.has(entityKey)) {
        lastReading.set(entityKey, +r.current_reading);
        afterRepl.delete(entityKey);
        return;
      }

      if (isDirect) {
        const delta = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
        lastReading.set(entityKey, +r.current_reading);
        deltaCache.set(entityKey, dateKey, delta, 'computed');
        const prev = pivot.get(dateKey)!.get(entityKey) ?? 0;
        pivot.get(dateKey)!.set(entityKey, prev + delta);
        return;
      }

      const cachedDelta = deltaCache.get(entityKey, dateKey);
      if (cachedDelta !== null) {
        if (r.current_reading != null) lastReading.set(entityKey, +r.current_reading);
        const prev = pivot.get(dateKey)!.get(entityKey) ?? 0;
        pivot.get(dateKey)!.set(entityKey, prev + cachedDelta);
        return;
      }

      let delta = 0;
      if (lastReading.has(entityKey)) {
        delta = +r.current_reading - lastReading.get(entityKey)!;
        lastReading.set(entityKey, +r.current_reading);
      } else if (dailyVolumeField && r[dailyVolumeField] != null) {
        delta = +r[dailyVolumeField];
        lastReading.set(entityKey, +r.current_reading);
      } else {
        if (r.previous_reading != null && r.current_reading != null)
          delta = +r.current_reading - +r.previous_reading;
        lastReading.set(entityKey, +r.current_reading);
      }
      deltaCache.set(entityKey, dateKey, delta, 'computed');

      const prev = pivot.get(dateKey)!.get(entityKey) ?? 0;
      pivot.get(dateKey)!.set(entityKey, prev + delta);
    });
  });
  return pivot;
}

/** Sum all entity values in a pivot for one date key. */
export function pivotDayTotal(pivot: Map<string, Map<string, number>>, dateKey: string): number {
  let total = 0;
  pivot.get(dateKey)?.forEach((v) => { total += v; });
  return total;
}
