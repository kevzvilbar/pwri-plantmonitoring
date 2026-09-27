import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query, DehydratedState, Mutation } from '@tanstack/react-query';

/**
 * IndexedDB AsyncStorage adapter for TanStack Query persister.
 * Uses idb-keyval for promise-based async IndexedDB key-value storage.
 */
export const idbStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const value = await get<string>(key);
      return value ?? null;
    } catch (err) {
      console.warn('[queryPersister] Failed to read from IndexedDB:', err);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await set(key, value);
    } catch (err) {
      console.warn('[queryPersister] Failed to write to IndexedDB:', err);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await del(key);
    } catch (err) {
      console.warn('[queryPersister] Failed to delete from IndexedDB:', err);
    }
  },
};

/**
 * Key under which query cache is stored in IndexedDB.
 */
export const PERSIST_CACHE_KEY = 'PWRI_QUERY_OFFLINE_CACHE';

/**
 * Cache max age: 24 hours. Stale items within maxAge hydrate instantly on app reopen.
 */
export const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * Cache buster: tied to app build / environment version so deploys with schema changes
 * automatically invalidate obsolete persisted query caches.
 */
export const CACHE_BUSTER =
  import.meta.env.VITE_APP_VERSION ||
  import.meta.env.VITE_RELEASE ||
  'pwri-cache-v2';

/**
 * Query key prefixes explicitly allowed to dehydrate to IndexedDB.
 * Reference, topology, and configuration data only.
 *
 * NEVER include hot realtime telemetry data (e.g., well_readings, locator_readings,
 * ro_train_readings, power_readings, product_meter_readings, alerts, downtime).
 */
const PERSIST_ALLOWLIST_PREFIXES = [
  'wells',
  'well',
  'locators',
  'locator',
  'ro-trains',
  'trains',
  'ro_trains',
  'plant-meter-config',
  'plant-meter-config-permeate',
  'dash-compliance-thresholds',
  'compliance-thresholds',
  'thresholds',
  'chem-thresholds',
  'plants',
  'plant-name',
  'entity-names',
  'custom-roles',
  'custom-role-overrides',
  'daily-reading-limits',
  'blending-wells-tags',
];

/**
 * Denylist patterns to prevent any accidental persistence of telemetry/readings
 * even if nested or named similarly to an allowlisted entity.
 */
const PERSIST_DENYLIST_PREFIXES = [
  'wellReadings',
  'well_readings',
  'locator_readings',
  'ro_train_readings',
  'power_readings',
  'product_meter_readings',
  'ro_pretreatment_readings',
  'reading-history',
  'well-raw-readings',
  'well-pms',
  'dash-ro-recent',
  'dash-ro-history',
  'dash-ro-permeate-today',
  'dash-ro-permeate-yest',
  'dash-loc-today',
  'dash-loc-yest',
  'dash-wells-today',
  'dash-wells-yest',
  'dash-power-today',
  'dash-power-yest',
  'dash-power-history',
  'dash-product-meters-today',
  'dash-product-meters-yest',
  'dash-costs-today',
  'dash-blending-today',
  'dash-all-permeate-today',
  'dash-pretreatment-recent',
  'dash-pump-readings-recent',
  'dash-server-aggregates',
  'alerts-feed',
  'incidents-',
  'incidents',
  'open-incidents',
  'manager-scorecard',
  'trend-',
  'fleet-status',
];

/**
 * Predicate to decide whether a TanStack Query entry should be persisted to IndexedDB.
 */
export function shouldDehydrateQuery(query: Query): boolean {
  // Only persist successful queries that contain actual data
  if (query.state.status !== 'success' || query.state.data === undefined) {
    return false;
  }

  const queryKey = query.queryKey;
  if (!Array.isArray(queryKey) || queryKey.length === 0) {
    return false;
  }

  const firstKey = String(queryKey[0]);

  // Denylist check — always reject hot telemetry / readings / live feeds
  for (const denied of PERSIST_DENYLIST_PREFIXES) {
    if (firstKey === denied || firstKey.startsWith(denied)) {
      return false;
    }
  }

  // Allowlist check — only accept audited reference and configuration datasets
  for (const allowed of PERSIST_ALLOWLIST_PREFIXES) {
    if (firstKey === allowed || firstKey.startsWith(allowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Predicate to decide whether a Mutation should be persisted to IndexedDB.
 * Defaults to persisting paused mutations so offline actions survive app reloads.
 */
export function shouldDehydrateMutation(mutation: Mutation): boolean {
  // Persist paused mutations (networkMode: 'online' / 'offlineFirst' when offline)
  return mutation.state.isPaused;
}

/**
 * The configured async persister for TanStack Query using IndexedDB via idb-keyval.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: PERSIST_CACHE_KEY,
  throttleTime: 1000,
});
