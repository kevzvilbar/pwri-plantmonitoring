import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [{ id: 'p1', name: 'Plant One' }] }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isManager: false, user: { id: 'u1' } }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/supabaseErrors', () => ({ friendlyError: (e: unknown) => String(e) }));
vi.mock('../shared', () => ({ logPlantEdit: vi.fn() }));

import { usePlantDetail } from './usePlantDetail';

let seenPath = '';
let seenSearch = '';
function wrapperFor(start: string) {
  function Probe() {
    const l = useLocation();
    seenPath = l.pathname;
    seenSearch = l.search;
    return null;
  }
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[start]}>
        <Probe />
        {children}
      </MemoryRouter>
    );
  };
}

describe('usePlantDetail on the well route (P5-3)', () => {
  it('without a well: defaults to Locators, and honours ?tab=', () => {
    const a = renderHook(() => usePlantDetail('p1', null), { wrapper: wrapperFor('/plants/p1') });
    expect(a.result.current.tab).toBe('locators');
    const b = renderHook(() => usePlantDetail('p1', null), { wrapper: wrapperFor('/plants/p1?tab=power') });
    expect(b.result.current.tab).toBe('power');
  });

  it('on a well route the Wells tab is active by definition, even though the URL has no ?tab=', () => {
    const { result } = renderHook(() => usePlantDetail('p1', 'w1'), { wrapper: wrapperFor('/plants/p1/wells/w1') });
    expect(result.current.tab).toBe('wells');
  });

  it('on a well route, a stray ?tab= cannot pull the page onto another tab', () => {
    const { result } = renderHook(() => usePlantDetail('p1', 'w1'), { wrapper: wrapperFor('/plants/p1/wells/w1?tab=power') });
    expect(result.current.tab).toBe('wells');
  });

  it('on a well route, picking another tab leaves the well and goes to that tab of the plant', () => {
    const { result } = renderHook(() => usePlantDetail('p1', 'w1'), { wrapper: wrapperFor('/plants/p1/wells/w1') });
    act(() => result.current.setTab('locators'));
    expect(seenPath).toBe('/plants/p1');
    expect(seenSearch).toBe('?tab=locators');
  });

  it('on a well route, picking Wells returns to the wells list of the plant', () => {
    const { result } = renderHook(() => usePlantDetail('p1', 'w1'), { wrapper: wrapperFor('/plants/p1/wells/w1') });
    act(() => result.current.setTab('wells'));
    expect(seenPath).toBe('/plants/p1');
    expect(seenSearch).toBe('?tab=wells');
  });

  it('without a well, picking a tab only rewrites the query string (no new history path)', () => {
    const { result } = renderHook(() => usePlantDetail('p1', null), { wrapper: wrapperFor('/plants/p1') });
    act(() => result.current.setTab('power'));
    expect(seenPath).toBe('/plants/p1');
    expect(seenSearch).toBe('?tab=power');
  });
});
