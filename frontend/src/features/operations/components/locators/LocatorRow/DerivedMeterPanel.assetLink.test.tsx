import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let canViewPlants = true;
vi.mock('@/hooks/usePermission', () => ({
  useCan: () => (module: string) => (module === 'plants' ? canViewPlants : true),
}));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: ['Operator'] }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@tanstack/react-query', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: null }),
}));

import { DerivedMeterPanel } from './DerivedMeterPanel';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <DerivedMeterPanel
          locator={{ id: 'l1', name: 'Locator 1', is_derived: true }}
          plantId="p1"
          latestReading={null}
          userId="u1"
          isManagerOrAdmin={false}
          recalcSaving={false}
          overrideSaving={false}
          overrideOpen={false}
          importOverrideOpen={false}
          reviewFlag={null}
          actorLabel="op"
          showHistory={false}
          onRecalcNow={() => {}}
          onSaveOverride={() => {}}
          onSetShowHistory={() => {}}
          onSetOverrideOpen={() => {}}
          onSetImportOverrideOpen={() => {}}
          onSaved={() => {}}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// P5-7: a derived locator row carries the same asset link as a physical row —
// the name goes to the locator's card in Plants.
describe('DerivedMeterPanel asset link (P5-7)', () => {
  it('links the derived name to the locator card in Plants', () => {
    canViewPlants = true;
    renderPanel();
    const link = screen.getByRole('link', { name: 'Open Locator 1 in Plants' });
    expect(link).toHaveAttribute('href', '/plants/p1?tab=locators&highlight=l1');
  });
});
