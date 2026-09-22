import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// cmdk measures its list with ResizeObserver and scrolls the highlighted row
// into view; jsdom has neither. Same ResizeObserver shim the other
// cmdk/recharts-adjacent tests use (BlendingVolumeCard.test.tsx).
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => cleanup());

vi.mock('@/hooks/usePermission', () => ({ useCan: () => () => true }));
vi.mock('@/hooks/useNavGroups', () => ({
  useNavGroups: () => [
    { label: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', route: '/', icon: () => null, modules: ['dashboard'] }] },
    { label: 'Daily Logs', items: [{ id: 'operations', label: 'Daily Readings', route: '/operations', icon: () => null, modules: ['operations'] }] },
  ],
}));
vi.mock('@/hooks/useVisiblePlants', () => ({
  useVisiblePlants: () => ({ plants: [{ id: 'p1', name: 'Mambaling' }], plantIds: ['p1'] }),
}));
vi.mock('@/features/wells/hooks/useWells', () => ({
  useWells: () => ({ data: [{ id: 'w1', name: 'Well 1', plant_id: 'p1' }] }),
}));
vi.mock('@/hooks/useLocators', () => ({
  useLocators: () => ({ data: [{ id: 'l1', name: 'Locator 1', plant_id: 'p1' }] }),
}));

import { CommandPalette } from './CommandPalette';

function renderOpen() {
  return render(
    <MemoryRouter>
      <CommandPalette open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
}

describe('CommandPalette (P5-10)', () => {
  it('lists nav pages the user may open', () => {
    renderOpen();
    expect(screen.getByText('Daily Readings')).toBeTruthy();
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('lists visible plants', () => {
    renderOpen();
    expect(screen.getByText('Mambaling')).toBeTruthy();
  });

  it('offers a well in both P5-7 directions: its page and its readings row', () => {
    renderOpen();
    // One hit under "Wells & locators" (→ the well page), one under
    // "Daily Readings rows" (→ the readings row).
    expect(screen.getAllByText('Well 1')).toHaveLength(2);
    expect(screen.getByText('Wells & locators')).toBeTruthy();
    expect(screen.getByText('Daily Readings rows')).toBeTruthy();
  });

  it('offers a locator in both P5-7 directions', () => {
    renderOpen();
    expect(screen.getAllByText('Locator 1')).toHaveLength(2);
  });
});
