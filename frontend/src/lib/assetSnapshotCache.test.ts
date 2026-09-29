import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveAssetSnapshot,
  getAssetSnapshot,
  clearAssetSnapshots,
  type AssetBaselineSnapshot,
} from './assetSnapshotCache';
import * as idbKeyval from 'idb-keyval';

vi.mock('idb-keyval', () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
}));

describe('assetSnapshotCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves an asset baseline snapshot to IndexedDB with entity key prefix', async () => {
    const snapshot: AssetBaselineSnapshot = {
      entityId: 'well-123',
      entityType: 'well',
      reading: 4520.5,
      readingDatetime: '2026-09-30T06:00:00.000Z',
      fetchedAt: Date.now(),
      multiplierAtReading: 1.0,
      unit: 'm³',
      source: 'server',
    };

    await saveAssetSnapshot(snapshot);
    expect(idbKeyval.set).toHaveBeenCalledWith('pwri_asset_snapshot_well-123', snapshot);
  });

  it('retrieves an asset snapshot by entityId', async () => {
    const snapshot: AssetBaselineSnapshot = {
      entityId: 'well-123',
      entityType: 'well',
      reading: 4520.5,
      readingDatetime: '2026-09-30T06:00:00.000Z',
      fetchedAt: Date.now(),
      source: 'server',
    };

    vi.mocked(idbKeyval.get).mockResolvedValueOnce(snapshot);

    const res = await getAssetSnapshot('well-123');
    expect(idbKeyval.get).toHaveBeenCalledWith('pwri_asset_snapshot_well-123');
    expect(res).toEqual(snapshot);
  });

  it('returns null when snapshot does not exist or read fails', async () => {
    vi.mocked(idbKeyval.get).mockResolvedValueOnce(undefined);
    const res = await getAssetSnapshot('unknown-well');
    expect(res).toBeNull();
  });

  it('clears all asset snapshots on sign-out / operator switch', async () => {
    vi.mocked(idbKeyval.keys).mockResolvedValueOnce([
      'pwri_asset_snapshot_well-1',
      'pwri_asset_snapshot_well-2',
      'other_key',
    ]);

    await clearAssetSnapshots();
    expect(idbKeyval.del).toHaveBeenCalledWith('pwri_asset_snapshot_well-1');
    expect(idbKeyval.del).toHaveBeenCalledWith('pwri_asset_snapshot_well-2');
    expect(idbKeyval.del).not.toHaveBeenCalledWith('other_key');
  });
});
