import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useUrlTab, type UseUrlTabOptions } from './useUrlTab';

const TABS = ['pending', 'inbox', 'history'] as const;
type Tab = (typeof TABS)[number];

function setup(entries: string | string[], options?: UseUrlTabOptions<Tab>) {
  const list = Array.isArray(entries) ? entries : [entries];
  return renderHook(
    () => ({ tab: useUrlTab('tab', TABS, 'pending', options), loc: useLocation(), nav: useNavigate() }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={list} initialIndex={list.length - 1}>{children}</MemoryRouter>
      ),
    },
  );
}
const value = (r: ReturnType<typeof setup>) => r.result.current.tab[0];
const set = (r: ReturnType<typeof setup>, next: string) => act(() => r.result.current.tab[1](next));
const params = (r: ReturnType<typeof setup>) => new URLSearchParams(r.result.current.loc.search);

describe('useUrlTab: reading', () => {
  it('reads a valid ?tab=, ignoring case and surrounding space', () => {
    expect(value(setup('/x?tab=history'))).toBe('history');
    expect(value(setup('/x?tab=HISTORY'))).toBe('history');
    expect(value(setup('/x?tab=%20inbox%20'))).toBe('inbox');
  });

  it('falls back to the default for an unknown, missing or empty value', () => {
    expect(value(setup('/x?tab=nonsense'))).toBe('pending');
    expect(value(setup('/x'))).toBe('pending');
    expect(value(setup('/x?tab='))).toBe('pending');
  });

  it('follows the URL when it changes (no separate local state to drift)', () => {
    const r = setup('/x?tab=inbox');
    act(() => r.result.current.nav('/x?tab=history'));
    expect(value(r)).toBe('history');
  });

  it('uses a different key when asked', () => {
    const r = renderHook(() => useUrlTab('view', TABS, 'pending'), {
      wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/x?view=inbox&tab=history']}>{children}</MemoryRouter>,
    });
    expect(r.result.current[0]).toBe('inbox');
  });

  it('honours a valid set that changes between renders (a role gained or lost)', () => {
    const r = renderHook(({ valid }: { valid: readonly string[] }) => useUrlTab('tab', valid, 'a'), {
      initialProps: { valid: ['a', 'b'] as readonly string[] },
      wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/x?tab=b']}>{children}</MemoryRouter>,
    });
    expect(r.result.current[0]).toBe('b');
    r.rerender({ valid: ['a'] });
    expect(r.result.current[0]).toBe('a');
  });
});

describe('useUrlTab: aliases', () => {
  const options = { aliases: { hist: 'history', old: 'inbox' } } as const;

  it('maps an old spelling to the current tab, case-insensitively', () => {
    expect(value(setup('/x?tab=hist', options))).toBe('history');
    expect(value(setup('/x?tab=OLD', options))).toBe('inbox');
  });

  it('falls back when an alias points at a tab that is not valid', () => {
    expect(value(setup('/x?tab=gone', { aliases: { gone: 'missing' as Tab } }))).toBe('pending');
  });

  it('does not treat Object.prototype members as aliases', () => {
    for (const evil of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(value(setup(`/x?tab=${evil}`, options)), evil).toBe('pending');
    }
  });

  it('writes the current name when set with an old one', () => {
    const r = setup('/x', options);
    set(r, 'hist');
    expect(params(r).get('tab')).toBe('history');
  });
});

describe('useUrlTab: writing', () => {
  it('writes the tab and keeps the other params', () => {
    const r = setup('/x?tab=history&plant=p1');
    set(r, 'inbox');
    expect(value(r)).toBe('inbox');
    expect(params(r).get('plant')).toBe('p1');
    expect(r.result.current.loc.pathname).toBe('/x');
  });

  it('ignores a value that is not a valid tab', () => {
    const r = setup('/x?tab=history');
    set(r, 'bogus');
    expect(r.result.current.loc.search).toBe('?tab=history');
  });

  it('drops only the params named in clearOnChange', () => {
    const r = setup('/x?tab=history&train=t1&plant=p1', { clearOnChange: ['train', 'absent'] });
    set(r, 'inbox');
    expect(params(r).get('train')).toBeNull();
    expect(params(r).get('plant')).toBe('p1');
    expect(params(r).get('tab')).toBe('inbox');
  });

  it('replaces the history entry: Back leaves the page, not the previous tab', () => {
    const r = setup(['/before', '/x?tab=history']);
    set(r, 'inbox');
    act(() => r.result.current.nav(-1));
    expect(r.result.current.loc.pathname).toBe('/before');
  });
});
