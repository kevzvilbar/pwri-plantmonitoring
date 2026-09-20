import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ calls: [] as unknown[], result: { count: 3, error: null } as { count: number | null; error: unknown } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string, opts: unknown) => ({
        or: (filter: string) => { h.calls.push({ table, cols, opts, filter }); return Promise.resolve(h.result); },
      }),
    }),
  },
}));

import { usePendingApprovalsCount } from './usePendingApprovalsCount';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { h.calls.length = 0; h.result = { count: 3, error: null }; });

describe('usePendingApprovalsCount', () => {
  it('is a head-only count using the same test as the Users tab "Pending" filter', async () => {
    const { result } = renderHook(() => usePendingApprovalsCount(), { wrapper });
    await waitFor(() => expect(result.current).toBe(3));
    expect(h.calls).toEqual([{
      table: 'user_profiles',
      cols: 'id',
      opts: { count: 'exact', head: true },
      filter: 'confirmed.eq.false,status.eq.Pending',
    }]);
  });

  it('does not query at all when disabled (a user who cannot approve)', async () => {
    const { result } = renderHook(() => usePendingApprovalsCount(false), { wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.calls).toHaveLength(0);
    expect(result.current).toBe(0);
  });

  it('is 0 when the query fails, never a stale or invented number', async () => {
    h.result = { count: null, error: new Error('rls') };
    const { result } = renderHook(() => usePendingApprovalsCount(), { wrapper });
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(result.current).toBe(0);
  });
});
