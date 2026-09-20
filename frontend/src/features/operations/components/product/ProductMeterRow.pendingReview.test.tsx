import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The "Pending review" chip on a product meter row used to navigate to
// /corrections?tab=inbox, a route that does not exist. It now goes to
// /data-corrections?tab=pending for roles that can open Data Corrections, and
// is a plain label for the ones that cannot (Operators), so it never ends in
// an "Access restricted" toast.
//
// Real ProductMeterRow, real permission matrix (useCan/usePermission). Only
// auth, the custom-role lookup, the network client and useNavigate are mocked.

const mockNavigate = vi.fn();
let mockRoles: string[] = ['Manager'];

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    profile: { id: 'u1' },
    activeOperator: null,
    roles: mockRoles,
    isAdmin: false,
    isManager: mockRoles.includes('Manager'),
  }),
}));
// No custom role: useCan falls back to the base permission matrix.
vi.mock('@/hooks/useCustomRoles', () => ({
  useMyCustomRole: () => ({ data: null }),
  useCustomRoles: () => ({ data: [] }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { ProductMeterRow } from './ProductMeterRow';

function renderRow(roles: string[]) {
  mockRoles = roles;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProductMeterRow
          meter={{ id: 'm1', name: 'Product Meter 1' }}
          plantId="p1"
          latest={{
            id: 'r1',
            current_reading: 1000,
            reading_datetime: new Date().toISOString(),
            norm_status: 'pending_review',
          }}
          userId="u1"
          canEdit={false}
          onSaved={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProductMeterRow "Pending review" chip', () => {
  beforeEach(() => mockNavigate.mockClear());

  it('for a Manager: is a button that opens the Pending tab of Data Corrections', () => {
    renderRow(['Manager']);
    const chip = screen.getByText('Pending review').closest('button');
    expect(chip).not.toBeNull();

    fireEvent.click(chip!);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/data-corrections?tab=pending');
  });

  it('for an Operator: is shown but is not clickable, so it cannot hit "Access restricted"', () => {
    renderRow(['Operator']);
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('Pending review').closest('button')).toBeNull();

    fireEvent.click(screen.getByText('Pending review'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
