import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/usePermission', () => ({ useCan: () => () => false, usePermission: () => false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, isManager: false, isDataAnalyst: false }) }));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({}) }) }) } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 0 }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/features/wells', () => ({ WellReadingForm: ({ highlightId }: { highlightId?: string | null }) => <div data-testid="well-form">{highlightId}</div> }));
vi.mock('../components/locators/LocatorSection', () => ({ LocatorReadingForm: ({ highlightId }: { highlightId?: string | null }) => <div data-testid="locator-form">{highlightId}</div> }));
vi.mock('../components/blending/BlendingSection', () => ({ BlendingForm: () => <div data-testid="blending-form" /> }));
vi.mock('../components/product/ProductSection', () => ({ ProductForm: ({ highlightId }: { highlightId?: string | null }) => <div data-testid="product-form">{highlightId}</div> }));
vi.mock('../components/power/PowerSection', () => ({ PowerForm: () => <div data-testid="power-form" /> }));
vi.mock('@/lib/shifts', () => ({ getCurrentShift: () => ({ name: 'Shift', timeRange: '' }) }));

import Operations from './OperationsPage';

const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><Operations /></MemoryRouter>);

/**
 * P5-11: the bar is hand-rolled buttons, so before this it carried no roles at
 * all — six unrelated buttons to a screen reader, and the keyboard had to Tab
 * through every one of them. These tests pin the wiring that fixes it, most of
 * all the pairing between a tab and the form it opens.
 */
describe('OperationsPage tab bar is a real tab bar (P5-11)', () => {
  it('is a labelled tablist with one tab per reading type', () => {
    renderAt('/operations');
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Reading type');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    for (const name of ['Locators', 'Wells', 'Product', 'Blending', 'Power']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('marks only the open tab selected', () => {
    renderAt('/operations?tab=product');
    expect(screen.getByRole('tab', { name: 'Product' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Locators' })).toHaveAttribute('aria-selected', 'false');
  });

  it('leaves a single Tab stop, on the open tab', () => {
    renderAt('/operations?tab=blending');
    expect(screen.getByRole('tab', { name: 'Blending' })).toHaveAttribute('tabindex', '0');
    for (const other of ['Locators', 'Wells', 'Product', 'Power']) {
      expect(screen.getByRole('tab', { name: other })).toHaveAttribute('tabindex', '-1');
    }
  });

  /**
   * Only the open tab's form is mounted, so there is one panel. Every tab has
   * to point at that one id — a tab naming a panel that is not in the DOM is
   * worse than one with no aria-controls at all.
   */
  it('points every tab at the single panel, which names the open tab', () => {
    renderAt('/operations?tab=well');
    for (const name of ['Locators', 'Wells', 'Product', 'Blending', 'Power']) {
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-controls', 'operations-tabpanel');
    }
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'operations-tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'operations-tab-well');
    expect(screen.getByRole('tab', { name: 'Wells' })).toHaveAttribute('id', 'operations-tab-well');
  });

  it('Arrow Right opens the next tab, moves focus, and keeps the URL in step', () => {
    renderAt('/operations');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByTestId('well-form')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Wells' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Wells' }));
  });

  it('End jumps to the last tab', () => {
    renderAt('/operations');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(screen.getByTestId('power-form')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Power' })).toHaveAttribute('aria-selected', 'true');
  });

  it('still opens a tab on click', () => {
    renderAt('/operations');
    fireEvent.click(screen.getByRole('tab', { name: 'Blending' }));
    expect(screen.getByTestId('blending-form')).toBeInTheDocument();
  });
});
