import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldDehydrateQuery,
  shouldDehydrateMutation,
  idbStorage,
  PERSIST_CACHE_KEY,
} from './queryPersister';
import type { Query, Mutation } from '@tanstack/react-query';
import * as idbKeyval from 'idb-keyval';

vi.mock('idb-keyval', () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

describe('queryPersister', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldDehydrateQuery', () => {
    const createMockQuery = (queryKey: unknown[], status: string, data?: unknown): Query =>
      ({
        queryKey,
        state: {
          status,
          data,
        },
      } as unknown as Query);

    it('allows reference and configuration queries', () => {
      const allowedKeys = [
        ['wells', 'plant-1'],
        ['well', 'well-123'],
        ['locators', 'plant-1'],
        ['locator', 'loc-1'],
        ['ro-trains', 'plant-1'],
        ['trains', 'plant-1'],
        ['ro_trains'],
        ['plant-meter-config', 'plant-1'],
        ['plant-meter-config-permeate', 'plant-1'],
        ['dash-compliance-thresholds', 'plant-1'],
        ['compliance-thresholds', 'plant-1'],
        ['thresholds', 'global'],
        ['chem-thresholds', ['chem-1']],
        ['plants'],
        ['plant-name', 'p1'],
        ['entity-names-wells'],
        ['custom-roles'],
        ['custom-role-overrides', 'r1'],
        ['daily-reading-limits'],
        ['blending-wells-tags', 'p1'],
      ];

      for (const key of allowedKeys) {
        const query = createMockQuery(key, 'success', { sample: true });
        expect(shouldDehydrateQuery(query), `Key ${JSON.stringify(key)} should be allowed`).toBe(true);
      }
    });

    it('rejects hot telemetry, readings, and live event queries', () => {
      const deniedKeys = [
        ['wellReadings', 'well-1'],
        ['well_readings', 'plant-1'],
        ['locator_readings', 'loc-1'],
        ['ro_train_readings', 'train-1'],
        ['power_readings', 'plant-1'],
        ['product_meter_readings', 'plant-1'],
        ['ro_pretreatment_readings', 'train-1'],
        ['reading-history'],
        ['well-raw-readings', 'w1'],
        ['well-pms', 'w1'],
        ['dash-ro-recent', ['t1']],
        ['dash-ro-history', ['t1']],
        ['dash-ro-permeate-today', ['t1']],
        ['dash-ro-permeate-yest', ['t1']],
        ['dash-loc-today', ['l1']],
        ['dash-loc-yest', ['l1']],
        ['dash-wells-today', ['w1']],
        ['dash-wells-yest', ['w1']],
        ['dash-power-today', ['p1']],
        ['dash-power-yest', ['p1']],
        ['dash-power-history', ['p1']],
        ['dash-product-meters-today', ['p1']],
        ['dash-product-meters-yest', ['p1']],
        ['dash-costs-today', ['p1']],
        ['dash-blending-today', ['p1']],
        ['dash-all-permeate-today', ['t1']],
        ['dash-pretreatment-recent', ['p1']],
        ['dash-pump-readings-recent', ['p1']],
        ['dash-server-aggregates', ['p1']],
        ['alerts-feed', 'all'],
        ['incidents-hist', 'p1'],
        ['incidents-open', 'p1'],
        ['open-incidents', 'p1'],
        ['manager-scorecard', '2026-01-01', '2026-01-31'],
        ['trend-ro', 'p1'],
        ['fleet-status', 'p1'],
      ];

      for (const key of deniedKeys) {
        const query = createMockQuery(key, 'success', { sample: true });
        expect(shouldDehydrateQuery(query), `Key ${JSON.stringify(key)} should be rejected`).toBe(false);
      }
    });

    it('rejects queries that are pending, errored, or have no data', () => {
      expect(shouldDehydrateQuery(createMockQuery(['wells'], 'pending', undefined))).toBe(false);
      expect(shouldDehydrateQuery(createMockQuery(['wells'], 'error', undefined))).toBe(false);
      expect(shouldDehydrateQuery(createMockQuery(['wells'], 'success', undefined))).toBe(false);
    });

    it('rejects non-array or empty query keys', () => {
      expect(shouldDehydrateQuery({ state: { status: 'success', data: {} }, queryKey: [] } as unknown as Query)).toBe(false);
    });
  });

  describe('shouldDehydrateMutation', () => {
    it('persists paused mutations and ignores unpaused ones', () => {
      const pausedMutation = { state: { isPaused: true } } as unknown as Mutation;
      const runningMutation = { state: { isPaused: false } } as unknown as Mutation;

      expect(shouldDehydrateMutation(pausedMutation)).toBe(true);
      expect(shouldDehydrateMutation(runningMutation)).toBe(false);
    });
  });

  describe('idbStorage adapter', () => {
    it('calls idb-keyval get and returns null on empty or error', async () => {
      vi.mocked(idbKeyval.get).mockResolvedValueOnce('{"data": 123}');
      const val = await idbStorage.getItem(PERSIST_CACHE_KEY);
      expect(val).toBe('{"data": 123}');

      vi.mocked(idbKeyval.get).mockResolvedValueOnce(undefined);
      const emptyVal = await idbStorage.getItem(PERSIST_CACHE_KEY);
      expect(emptyVal).toBeNull();

      vi.mocked(idbKeyval.get).mockRejectedValueOnce(new Error('IDB error'));
      const errVal = await idbStorage.getItem(PERSIST_CACHE_KEY);
      expect(errVal).toBeNull();
    });

    it('calls idb-keyval set and handles error gracefully', async () => {
      vi.mocked(idbKeyval.set).mockResolvedValueOnce(undefined);
      await idbStorage.setItem(PERSIST_CACHE_KEY, '{"test": 1}');
      expect(idbKeyval.set).toHaveBeenCalledWith(PERSIST_CACHE_KEY, '{"test": 1}');

      vi.mocked(idbKeyval.set).mockRejectedValueOnce(new Error('Disk full'));
      await expect(idbStorage.setItem(PERSIST_CACHE_KEY, '{"test": 1}')).resolves.not.toThrow();
    });

    it('calls idb-keyval del and handles error gracefully', async () => {
      vi.mocked(idbKeyval.del).mockResolvedValueOnce(undefined);
      await idbStorage.removeItem(PERSIST_CACHE_KEY);
      expect(idbKeyval.del).toHaveBeenCalledWith(PERSIST_CACHE_KEY);

      vi.mocked(idbKeyval.del).mockRejectedValueOnce(new Error('IDB locked'));
      await expect(idbStorage.removeItem(PERSIST_CACHE_KEY)).resolves.not.toThrow();
    });
  });
});
