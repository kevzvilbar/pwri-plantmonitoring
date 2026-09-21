import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createRef } from 'react';

// P5-7: the well's name is a real link to the well's own page. It used to be a
// "Plant detail" item in the "..." menu that opened the wells LIST with the
// card highlighted, which went stale when P5-3 gave a well a page of its own.

let mockRoles: string[] = ['Operator'];

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: mockRoles }),
}));
vi.mock('@/hooks/useCustomRoles', () => ({
  useMyCustomRole: () => ({ data: null }),
  useCustomRoles: () => ({ data: [] }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

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
vi.mock('@/pages/operations/shared', () => ({ WELL_MAX_READINGS_PER_DAY: 4 }));

import { WellRowHeader } from './WellRowHeader';

function renderHeader(roles: string[]) {
  mockRoles = roles;
  return render(
    <MemoryRouter>
      <WellRowHeader
        well={{ id: 'w1', name: 'Well 1' }}
        plantId="p1"
        todayCount={1}
        atLimit={false}
        customDt="2026-09-21T08:00"
        onCustomDtChange={() => {}}
        dtInputRef={createRef<HTMLInputElement>()}
        editingId={null}
        lastToday={null}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onShowHistory={() => {}}
        isManagerOrAdmin={roles.includes('Manager')}
        isBlending={false}
        isInSharedPowerGroup={false}
        gapReason={null}
        onGapReasonClick={() => {}}
      />
    </MemoryRouter>,
  );
}

describe('WellRowHeader asset link (P5-7)', () => {
  it.each([['Manager'], ['Operator']])('for a %s: the well name links to the well\u2019s own page', (role) => {
    renderHeader([role]);
    const link = screen.getByRole('link', { name: 'Open Well 1 in Plants' });
    expect(link).toHaveAttribute('href', '/plants/p1/wells/w1');
    expect(screen.queryByText('Plant detail')).toBeNull();
  });
});
