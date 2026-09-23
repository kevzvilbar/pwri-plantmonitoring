import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// P5-7: a well's own page links back to that well's row in Daily Readings.
// (Cards in the wells list already had this link; the page did not.)
// Real WellDetail, real permission matrix. The queries, the network client and
// the heavy children (charts, dialogs) are stubbed.

let mockRoles: string[] = ['Operator'];

vi.mock('@tanstack/react-query', () => ({
  // Only the well itself matters here; every other query is empty.
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === 'well'
      ? { data: { id: 'w1', plant_id: 'p1', name: 'Well 1', status: 'Active' }, isLoading: false, isError: false, refetch: vi.fn() }
      : { data: undefined, isLoading: false, isError: false },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: mockRoles, isManager: mockRoles.includes('Manager') }),
}));
vi.mock('@/hooks/useCustomRoles', () => ({
  useMyCustomRole: () => ({ data: null }),
  useCustomRoles: () => ({ data: [] }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/features/plants/components/charts/EntityHistoryChart/index', () => ({ EntityHistoryChart: () => null, MeterDetailButton: () => null }));
vi.mock('@/features/plants/components/locators/LocatorDialogs', () => ({ ReplaceMeterDialog: () => null }));
vi.mock('./WellDialogs', () => ({ EditElectricMeterDialog: () => null, EditHydraulicDialog: () => null, HydraulicHistoryDialog: () => null }));
vi.mock('@/components/readingHistory/MeterReplacementDetailDialog', () => ({ MeterReplacementDetailDialog: () => null }));
vi.mock('@/components/readingHistory/ReplPill', () => ({ ReplPill: () => null }));
vi.mock('@/lib/meterReplacementDelete', () => ({ deleteWellMeterReplacement: vi.fn() }));

import { WellDetail } from './WellDetail';

const renderDetail = (roles: string[]) => {
  mockRoles = roles;
  return render(
    <MemoryRouter>
      <WellDetail wellId="w1" plantId="p1" onBack={() => {}} />
    </MemoryRouter>,
  );
};

describe('WellDetail link to Daily Readings (P5-7)', () => {
  beforeEach(() => { mockRoles = ['Operator']; });

  it.each([['Operator'], ['Manager']])('for a %s: links to this well\u2019s row in Daily Readings', (role) => {
    renderDetail([role]);
    const link = screen.getByRole('link', { name: /Daily Readings/ });
    expect(link).toHaveAttribute('href', '/operations?tab=well&highlight=w1');
  });

  it('still has its Back to Wells button next to it', () => {
    renderDetail(['Operator']);
    expect(screen.getByRole('button', { name: /Back to Wells/ })).toBeInTheDocument();
  });
});
