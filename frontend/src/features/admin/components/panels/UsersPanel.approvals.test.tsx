import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ rpc: vi.fn(), rows: {} as Record<string, unknown[]>, methods: [] as string[] }));
vi.mock('@/integrations/supabase/client', () => {
  const chain = (table: string): unknown =>
    new Proxy({}, {
      get: (_t, prop: string) => {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve({ data: h.rows[table] ?? [], error: null }).then(res, rej);
        }
        h.methods.push(`${table}.${prop}`);
        return () => chain(table);
      },
    });
  return { supabase: { from: (t: string) => chain(t), rpc: (...a: unknown[]) => h.rpc(...a) } };
});
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useCustomRoles: () => ({ data: [] }), useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, profile: null, roles: ['Admin'], isAdmin: true, isManager: true, isDataAnalyst: false, loading: false }),
}));
vi.mock('@/components/EmailChangeDialog', () => ({ EmailChangeDialog: () => null }));
vi.mock('@/components/ui/sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { UsersPanel } from './UsersPanel';
import { PENDING_APPROVALS_COUNT_KEY } from '@/hooks/usePendingApprovalsCount';

const person = (id: string, first: string, last: string, extra: object = {}) => ({
  id, first_name: first, last_name: last, username: first.toLowerCase(), designation: 'Operator',
  status: 'Active', confirmed: true, plant_assignments: [], ...extra,
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(<QueryClientProvider client={qc}><MemoryRouter><UsersPanel /></MemoryRouter></QueryClientProvider>);
  return { invalidate };
}

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ error: null });
  h.methods.length = 0;
  h.rows.user_profiles = [person('u1', 'Ana', 'Cruz'), person('u2', 'Ben', 'Reyes', { status: 'Pending', confirmed: false })];
  h.rows.user_roles = [{ user_id: 'u1', role: 'Operator' }, { user_id: 'u2', role: 'Operator' }];
});

describe('Admin → Users approval queue (P5-5)', () => {
  it('shows accounts waiting for approval at the top of the tab', async () => {
    renderPanel();
    const queue = await screen.findByTestId('pending-approvals');
    expect(within(queue).getByText('1 waiting')).toBeInTheDocument();
    expect(within(queue).getByText('Ben Reyes')).toBeInTheDocument();
    expect(within(queue).queryByText('Ana Cruz')).toBeNull();
  });

  it('is absent when nobody is waiting', async () => {
    h.rows.user_profiles = [person('u1', 'Ana', 'Cruz')];
    renderPanel();
    await screen.findByText('Ana Cruz');  // the list has loaded: absence below is not just "not loaded yet"
    expect(screen.queryByTestId('pending-approvals')).toBeNull();
  });

  it('approves through the approve_user RPC, not a raw table update', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('pending-approve-u2'));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('approve_user', { _user_id: 'u2', _approve: true }));
    expect(h.methods.filter((m) => m.endsWith('.update'))).toEqual([]);
  });

  it('refreshes the Admin Console nav badge after an approval', async () => {
    const { invalidate } = renderPanel();
    fireEvent.click(await screen.findByTestId('pending-approve-u2'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: PENDING_APPROVALS_COUNT_KEY }));
  });
});
