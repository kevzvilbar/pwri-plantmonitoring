import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { OPERATOR_ALLOWED_PATHS } from '@/components/ProtectedRoute';

const START = '/__start';

/** Would ProtectedRoute let an Operator in? Same rule the guard applies. */
export function operatorCanOpen(url: string): boolean {
  const pathname = url.split(/[?#]/)[0];
  return OPERATOR_ALLOWED_PATHS.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)));
}

async function mount(makeUi: () => ReactElement, ready?: () => Promise<unknown>) {
  const nav = { where: START, go: (_to: string) => {} };
  function Probe() {
    const l = useLocation();
    const go = useNavigate();
    nav.where = l.pathname + l.search;
    nav.go = go;
    return null;
  }
  const view = render(<MemoryRouter initialEntries={[START]}>{makeUi()}<Probe /></MemoryRouter>);
  if (ready) await ready();
  return Object.assign(view, { nav });
}

/**
 * "Can this user hit a dead end?" Renders the UI, clicks every element in it,
 * and returns every URL those clicks navigated to (path + query, sorted).
 *
 * It clicks elements rather than looking for buttons and links, because a
 * clickable <div onClick> is invisible to any selector. Clicks on a disabled
 * control do nothing, as in a browser. When a click changes what is on screen
 * (a tab switch) the original tree is rebuilt, so the controls after it are
 * still reached.
 */
export async function clickEverything(makeUi: () => ReactElement, ready?: () => Promise<unknown>): Promise<string[]> {
  const visited = new Set<string>();
  let view = await mount(makeUi, ready);
  let elements = Array.from(view.container.querySelectorAll<HTMLElement>('*'));

  for (let i = 0; i < elements.length; i++) {
    const before = view.container.innerHTML;
    fireEvent.click(elements[i]);
    if (view.nav.where !== START) {
      visited.add(view.nav.where);
      act(() => view.nav.go(START));
    }
    if (view.container.innerHTML !== before) {
      view.unmount();
      view = await mount(makeUi, ready);
      elements = Array.from(view.container.querySelectorAll<HTMLElement>('*'));
    }
  }
  view.unmount();
  return [...visited].sort();
}
