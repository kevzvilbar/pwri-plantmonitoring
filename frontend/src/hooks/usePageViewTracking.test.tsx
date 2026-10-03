import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

const authState = { roles: ['Operator', 'Manager'], loading: false };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }));
const recordPageView = vi.fn();
vi.mock('@/lib/navTelemetry', async (orig) => ({
  ...(await orig<typeof import('@/lib/navTelemetry')>()),
  recordPageView: (...a: unknown[]) => recordPageView(...a),
  flushPageViews: vi.fn().mockResolvedValue(undefined),
}));

import { usePageViewTracking } from './usePageViewTracking';

const wrap = (initial: string) => ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
);

beforeEach(() => { recordPageView.mockReset(); authState.loading = false; });

describe('usePageViewTracking', () => {
  it('records the first view with the highest role', () => {
    renderHook(() => usePageViewTracking(), { wrapper: wrap('/costs?tab=budget') });
    expect(recordPageView).toHaveBeenCalledWith({ pathname: '/costs', search: '?tab=budget', role: 'Manager' });
  });
  it('waits for auth before recording', () => {
    authState.loading = true;
    renderHook(() => usePageViewTracking(), { wrapper: wrap('/alerts') });
    expect(recordPageView).not.toHaveBeenCalled();
  });
  it('records again when the route changes', () => {
    const { result } = renderHook(() => ({ nav: useNavigate(), _: usePageViewTracking() }), { wrapper: wrap('/alerts') });
    result.current.nav('/hydraulics');
    return vi.waitFor(() => expect(recordPageView).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: '/hydraulics' })));
  });
});
