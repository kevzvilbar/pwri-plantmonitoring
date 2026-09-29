import { get, set, del, keys } from 'idb-keyval';

export type AssetEntityType = 'well' | 'locator' | 'ro_train' | 'product_meter' | 'power' | 'blending';

export interface AssetBaselineSnapshot {
  entityId: string;
  entityType: AssetEntityType;
  reading: number;
  readingDatetime: string;
  fetchedAt: number; // Unix timestamp ms
  multiplierAtReading?: number | null;
  isMeterReplacement?: boolean;
  isMeterRollover?: boolean;
  unit?: string;
  source: 'server' | 'local-pending';
}

const SNAPSHOT_KEY_PREFIX = 'pwri_asset_snapshot_';

function getSnapshotKey(entityId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${entityId}`;
}

/**
 * Saves or updates a verified last-known baseline snapshot for an asset.
 * This runs in an isolated IndexedDB key space separate from TanStack Query's cache.
 */
export async function saveAssetSnapshot(snapshot: AssetBaselineSnapshot): Promise<void> {
  try {
    const key = getSnapshotKey(snapshot.entityId);
    await set(key, snapshot);
  } catch (err) {
    console.warn('[assetSnapshotCache] Failed to save asset snapshot:', err);
  }
}

/**
 * Retrieves the cached last-known baseline snapshot for an asset.
 */
export async function getAssetSnapshot(entityId: string): Promise<AssetBaselineSnapshot | null> {
  try {
    const key = getSnapshotKey(entityId);
    const val = await get<AssetBaselineSnapshot>(key);
    return val ?? null;
  } catch (err) {
    console.warn('[assetSnapshotCache] Failed to read asset snapshot:', err);
    return null;
  }
}

/**
 * Clears all asset baseline snapshots.
 * Should be invoked on operator switch or user sign-out to prevent showing
 * stale or unauthorized readings to another operator on a shared terminal.
 */
export async function clearAssetSnapshots(): Promise<void> {
  try {
    const allKeys = await keys();
    const snapshotKeys = allKeys.filter((k) => typeof k === 'string' && k.startsWith(SNAPSHOT_KEY_PREFIX));
    await Promise.all(snapshotKeys.map((k) => del(k)));
  } catch (err) {
    console.warn('[assetSnapshotCache] Failed to clear asset snapshots:', err);
  }
}
