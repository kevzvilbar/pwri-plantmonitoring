import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** P5-2: OperationsPage used to fall back to `plants?.[0]`, so with "All
 *  plants" selected the tab counts silently described the first plant while
 *  the forms below showed nothing. */

const active = vi.hoisted(() => ({ plantId: '' }));
const queries = vi.hoisted(() => ({ calls: [] as Array<{ queryKey: unknown[]; enabled?: boolean }> }));

vi.mock('@/hooks/useActivePlant', () => ({
  useActivePlant: () => ({ plantId: active.plantId, plant: null, plants: [], isLoading: false, needsAssignment: false, needsSelection: !active.plantId, select: vi.fn() }),
}));
vi.mock('@/hooks/usePermission', () => ({ useCan: () => () => false, usePermission: () => false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, isManager: false, isDataAnalyst: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({}) }) }) } }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[]; enabled?: boolean }) => {
    queries.calls.push({ queryKey: opts.queryKey, enabled: opts.enabled });
    return { data: 0 };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/features/wells', () => ({ WellReadingForm: () => null }));
vi.mock('../components/locators/LocatorSection', () => ({ LocatorReadingForm: () => null }));
vi.mock('../components/blending/BlendingSection', () => ({ BlendingForm: () => null }));
vi.mock('../components/product/ProductSection', () => ({ ProductForm: () => null }));
vi.mock('../components/power/PowerSection', () => ({ PowerForm: () => null }));
vi.mock('@/lib/shifts', () => ({ getCurrentShift: () => ({ name: 'Shift', timeRange: '' }) }));

import Operations from './OperationsPage';

const countQueries = () => queries.calls.filter((c) => String(c.queryKey[0]).startsWith('operations-'));

describe('OperationsPage active plant (P5-2)', () => {
  beforeEach(() => { queries.calls = []; });

  it('with no active plant, runs NO count query (no first-plant fallback)', () => {
    active.plantId = '';
    render(<MemoryRouter><Operations /></MemoryRouter>);
    const counts = countQueries();
    expect(counts.length).toBe(3);
    for (const c of counts) expect(c.enabled).toBe(false);
  });

  it('with an active plant, counts are enabled and keyed by that plant', () => {
    active.plantId = 'p2';
    render(<MemoryRouter><Operations /></MemoryRouter>);
    const counts = countQueries();
    expect(counts.length).toBe(3);
    for (const c of counts) {
      expect(c.enabled).toBe(true);
      expect(c.queryKey[1]).toBe('p2');
    }
  });
});
