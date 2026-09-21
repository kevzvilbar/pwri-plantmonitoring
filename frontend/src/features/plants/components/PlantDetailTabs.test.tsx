import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlantDetailTabs, plantTabId, plantTabPanelId, type PlantTab } from './PlantDetailTabs';

const ALL: PlantTab[] = ['locators', 'wells', 'product', 'trains', 'power', 'configuration'];

/**
 * P5-11: this bar used to be <button>s with no roles at all, so a screen reader
 * read six unrelated buttons and the keyboard could not arrow between them.
 */
describe('PlantDetailTabs is a real tab bar (P5-11)', () => {
  it('is a labelled tablist holding one tab per section, in order', () => {
    render(<PlantDetailTabs tab="locators" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Plant section');
    expect(screen.getAllByRole('tab')).toHaveLength(ALL.length);
  });

  it('names each tab after its full label, not the two-letter mobile one', () => {
    render(<PlantDetailTabs tab="wells" onTabChange={vi.fn()} />);
    // Not "Wells WELL" — both spans are in the DOM, one hidden per breakpoint.
    expect(screen.getByRole('tab', { name: 'Wells' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /WELL/ })).toBeNull();
  });

  it('marks only the selected tab selected', () => {
    render(<PlantDetailTabs tab="product" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Product' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Wells' })).toHaveAttribute('aria-selected', 'false');
  });

  it('leaves a single Tab stop, on the selected tab', () => {
    render(<PlantDetailTabs tab="power" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Power & Energy' })).toHaveAttribute('tabindex', '0');
    for (const other of ['Locators', 'Wells', 'Product', 'RO Trains', 'Configuration']) {
      expect(screen.getByRole('tab', { name: other })).toHaveAttribute('tabindex', '-1');
    }
  });

  /**
   * The panels are rendered by PlantsPage, not here, so the only thing keeping
   * them attached is that both files build the ids the same way. If one side is
   * renamed the tab is announced as controlling nothing — this test is what
   * catches that, by checking the tab's aria-controls against the helper
   * PlantsPage actually calls.
   */
  it.each(ALL)('%s: aria-controls points at the panel id PlantsPage renders', (id) => {
    const { container } = render(<PlantDetailTabs tab="locators" onTabChange={vi.fn()} />);
    const btn = container.querySelector(`#${plantTabId(id)}`);
    expect(btn).not.toBeNull();
    expect(btn).toHaveAttribute('aria-controls', plantTabPanelId(id));
    expect(btn).toHaveAttribute('aria-selected', id === 'locators' ? 'true' : 'false');
  });

  it('reports arrow-key navigation through onTabChange', () => {
    const onTabChange = vi.fn();
    render(<PlantDetailTabs tab="locators" onTabChange={onTabChange} />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenLastCalledWith('wells');
    fireEvent.keyDown(list, { key: 'End' });
    expect(onTabChange).toHaveBeenLastCalledWith('configuration');
  });

  it('still reports a click, so the URL keeps up', () => {
    const onTabChange = vi.fn();
    render(<PlantDetailTabs tab="locators" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'RO Trains' }));
    expect(onTabChange).toHaveBeenCalledWith('trains');
  });
});
