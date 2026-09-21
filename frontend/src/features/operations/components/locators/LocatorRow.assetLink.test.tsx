import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// P5-7: the locator's name is a real link to its card in Plants. It replaces
// the "Plant detail" item that used to sit inside the row's "..." menu.
// Real LocatorRow and real permission matrix; only auth, the custom-role
// lookup, and the network client are mocked (same harness as the product row).

let mockRoles: string[] = ['Operator'];

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
vi.mock('@/hooks/useCustomRoles', () => ({
  useMyCustomRole: () => ({ data: null }),
  useCustomRoles: () => ({ data: [] }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

// The `@/components/operations/*` shims re-export the whole operations barrel,
// which is a cycle with wells/locators. Under vitest a leaf imported first sees
// `ControlCluster` as undefined (the app is fine: Rollup keeps live bindings).
// Point the shims at the real leaf modules; the components are still the real ones.
vi.mock('@/components/operations/ControlCluster', async () => ({
  ControlCluster: (await import('@/features/operations/components/ControlCluster')).ControlCluster,
}));
vi.mock('@/components/operations/MetaStrip', async () => ({
  MetaStrip: (await import('@/features/operations/components/MetaStrip')).MetaStrip,
}));

import { LocatorRow } from './LocatorRow';

function renderRow(roles: string[]) {
  mockRoles = roles;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LocatorRow
          locator={{ id: 'l1', name: 'Locator 1' }}
          plantId="p1"
          previous={100}
          previousDt={null}
          latestReading={null}
          todayReadings={[]}
          avgVol={null}
          userId="u1"
          onSaved={() => {}}
          isManagerOrAdmin={roles.includes('Manager')}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LocatorRow asset link (P5-7)', () => {
  it.each([['Manager'], ['Operator']])('for a %s: the locator name links to the locator in Plants', (role) => {
    renderRow([role]);
    const link = screen.getByRole('link', { name: 'Open Locator 1 in Plants' });
    expect(link).toHaveAttribute('href', '/plants/p1?tab=locators&highlight=l1');
    expect(screen.queryByText('Plant detail')).toBeNull();
  });
});
