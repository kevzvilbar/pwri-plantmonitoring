import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('@/hooks/usePermission', () => ({
  useCan: () => () => false,
  usePermission: () => false,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: false, isManager: false, isDataAnalyst: false }),
}));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({}) }) }) },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: 0 }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/features/wells', () => ({ WellReadingForm: () => null }));
vi.mock('../components/locators/LocatorSection', () => ({ LocatorReadingForm: () => null }));
vi.mock('../components/blending/BlendingSection', () => ({ BlendingForm: () => null }));
vi.mock('../components/product/ProductSection', () => ({ ProductForm: () => null }));
vi.mock('../components/power/PowerSection', () => ({ PowerForm: () => null }));
vi.mock('@/lib/shifts', () => ({ getCurrentShift: () => ({ name: 'Shift', timeRange: '' }) }));

import Operations from '@/features/operations/pages/OperationsPage';

/** P2-1: an Operator (no smart_import/data_exports/... view) must never see a
 *  button or ribbon link that ends in an "Access restricted" toast. */
describe('OperationsPage permission gating (P2-1)', () => {
  beforeEach(() => mockNavigate.mockClear());

  it('hides Import, Export and the whole Operations Tools ribbon', () => {
    render(
      <MemoryRouter>
        <Operations />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
    expect(screen.queryByText('Operations Tools:')).toBeNull();
    expect(screen.queryByRole('button', { name: /data corrections/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /manager scorecard/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /plant topology/i })).toBeNull();
  });

  it('never fires a navigation to a forbidden page (no toast to trigger)', () => {
    render(
      <MemoryRouter>
        <Operations />
      </MemoryRouter>,
    );
    for (const el of screen.queryAllByRole('button')) {
      fireEvent.click(el);
    }
    for (const call of mockNavigate.mock.calls) {
      const to = String(call[0]);
      expect(['/import', '/exports', '/data-corrections', '/manager-scorecard', '/topology']).not.toContain(to);
    }
  });
});
