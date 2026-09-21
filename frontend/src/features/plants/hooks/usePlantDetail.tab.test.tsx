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
import { assetPath } from '@/shared/assetLinks';

const setup = (start: string) =>
  renderHook(() => ({ d: usePlantDetail('p1', null), loc: useLocation() }), {
    wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[start]}>{children}</MemoryRouter>,
  });

/** P5-4: the plant tab is read from the URL through useUrlTab. */
describe('usePlantDetail tab (P5-4)', () => {
  it('an unknown ?tab= falls back to Locators instead of leaving no tab active', () => {
    expect(setup('/plants/p1?tab=bogus').result.current.d.tab).toBe('locators');
  });

  it('follows the URL when it changes from outside (no stale local copy)', () => {
    const { result } = renderHook(() => ({ d: usePlantDetail('p1', null), loc: useLocation() }), {
      wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/plants/p1?tab=power']}>{children}</MemoryRouter>,
    });
    expect(result.current.d.tab).toBe('power');
  });

  it('picking a tab drops ?highlight=, which named a row on the tab being left', () => {
    const { result } = setup('/plants/p1?tab=locators&highlight=loc-9');
    expect(result.current.d.highlightId).toBe('loc-9');
    act(() => result.current.d.setTab('wells'));
    const sp = new URLSearchParams(result.current.loc.search);
    expect(sp.get('tab')).toBe('wells');
    expect(sp.get('highlight')).toBeNull();
    expect(result.current.d.highlightId).toBeNull();
  });

  it('keeps unrelated params when picking a tab', () => {
    const { result } = setup('/plants/p1?tab=locators&foo=1');
    act(() => result.current.d.setTab('power'));
    expect(new URLSearchParams(result.current.loc.search).get('foo')).toBe('1');
  });
});

/**
 * P5-7: the links on a Daily Readings row are built by assetPath(). Run what it
 * builds through the real hook, so a change to a tab name here can't leave the
 * link landing on the wrong tab with nothing highlighted.
 */
describe('usePlantDetail understands assetPath() links (P5-7)', () => {
  it.each([
    ['locator', 'locators'],
    ['product', 'product'],
  ] as const)('a %s link opens the %s tab with that card highlighted', (kind, tab) => {
    const { result } = setup(assetPath(kind, 'p1', 'row-7'));
    expect(result.current.d.tab).toBe(tab);
    expect(result.current.d.highlightId).toBe('row-7');
  });
});
