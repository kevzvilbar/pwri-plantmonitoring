import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// P5-7: the "Daily Readings" pill on a product-meter card opens that meter's
// row. It is built by readingsPath(): Product tab, this meter in ?highlight=.
// Real ProductMetersCard; queries, network client and auth are stubbed.

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === 'product-meters' ? [{ id: 'm1', name: 'Product Meter 1', status: 'Active', sort_order: 1 }] : undefined,
    isLoading: false,
    isFetching: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isManager: false, isAdmin: false, user: { id: 'u1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ProductMetersCard } from './ProductMeters';

describe('ProductMetersCard link to Daily Readings (P5-7)', () => {
  beforeEach(() => mockNavigate.mockClear());

  it('the pill navigates to this meter\u2019s row in Daily Readings', () => {
    render(
      <MemoryRouter>
        <ProductMetersCard plant={{ id: 'p1', name: 'Plant One' }} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open this meter in Daily Readings' }));
    expect(mockNavigate).toHaveBeenCalledWith('/operations?tab=product&highlight=m1');
  });
});
