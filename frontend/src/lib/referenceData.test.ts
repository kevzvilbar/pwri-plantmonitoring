import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const fetchWells = vi.hoisted(() => vi.fn(async () => [{ id: 'w1', status: 'Active' }]));
vi.mock('@/features/wells/hooks/useWells', () => ({ fetchWells }));
vi.mock('@/hooks/useLocators', () => ({ fetchLocators: vi.fn(async () => []) }));
vi.mock('@/hooks/useROTrains', () => ({ fetchROTrains: vi.fn(async () => []) }));

import { ensureWells } from './referenceData';

describe('referenceData', () => {
  it('fetches a catalog once for repeated and reordered plant lists', async () => {
    const qc = new QueryClient();
    await Promise.all([ensureWells(qc, ['b', 'a']), ensureWells(qc, ['a', 'b']), ensureWells(qc, ['a', 'b'])]);
    expect(fetchWells).toHaveBeenCalledTimes(1);
  });

  it('refetches after invalidation (mutations keep working)', async () => {
    const qc = new QueryClient();
    fetchWells.mockClear();
    await ensureWells(qc, ['a']);
    await qc.invalidateQueries({ queryKey: ['wells'] });
    await ensureWells(qc, ['a']);
    expect(fetchWells).toHaveBeenCalledTimes(2);
  });

  it('never makes an unscoped request for an empty plant list', async () => {
    const qc = new QueryClient();
    fetchWells.mockClear();
    expect(await ensureWells(qc, [])).toEqual([]);
    expect(fetchWells).not.toHaveBeenCalled();
  });
});
