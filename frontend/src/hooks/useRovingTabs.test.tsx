import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { useState } from 'react';
import { useRovingTabs } from './useRovingTabs';

const TABS = ['a', 'b', 'c'] as const;
type Tab = (typeof TABS)[number];

/** The shape the real callers use: selected lives in the URL, so the hook only
 *  reports the choice and the component re-renders with the new value.
 *  One panel, content swapped — the shape OperationsPage uses. */
function Bar({ ids = TABS as readonly Tab[], onSelect }: { ids?: readonly Tab[]; onSelect?: (t: Tab) => void }) {
  const [selected, setSelected] = useState<Tab>('a');
  const tabs = useRovingTabs({
    ids,
    selected,
    onSelect: (t) => {
      setSelected(t);
      onSelect?.(t);
    },
    idPrefix: 'x',
    singlePanel: true,
  });
  return (
    <>
      <div {...tabs.tablistProps} aria-label="Test tabs">
        {ids.map((t) => (
          <button key={t} {...tabs.tabProps(t)} type="button">
            {t}
          </button>
        ))}
      </div>
      <div {...tabs.panelProps(selected)}>{selected}</div>
    </>
  );
}

/** One panel per tab, all mounted — the shape PlantDetailTabs uses. */
function PerTabBar() {
  const tabs = useRovingTabs({
    ids: TABS,
    selected: 'b',
    onSelect: () => {},
    idPrefix: 'y',
  });
  return (
    <>
      <div {...tabs.tablistProps} aria-label="Per-tab">
        {TABS.map((t) => (
          <button key={t} {...tabs.tabProps(t)} type="button">
            {t}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t} {...tabs.panelProps(t)} hidden={t !== 'b'}>
          {t}
        </div>
      ))}
    </>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });
const tablist = () => screen.getByRole('tablist');
const key = (k: string) => {
  const ev = createEvent.keyDown(tablist(), { key: k });
  fireEvent(tablist(), ev);
  return ev;
};

describe('useRovingTabs: roles', () => {
  it('announces the bar as a tablist and one Tab stop per button', () => {
    render(<Bar />);
    expect(tablist()).toHaveAttribute('aria-orientation', 'horizontal');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks only the selected tab aria-selected', () => {
    render(<Bar />);
    expect(tab('a')).toHaveAttribute('aria-selected', 'true');
    expect(tab('b')).toHaveAttribute('aria-selected', 'false');
    expect(tab('c')).toHaveAttribute('aria-selected', 'false');
  });

  // The point of the roving tabindex: the bar is ONE Tab stop. Without this,
  // role="tab" on every button would add three Tab stops, which is the cost
  // arrow-key navigation exists to remove.
  it('leaves one tabbable tab — the selected one', () => {
    render(<Bar />);
    expect(tab('a')).toHaveAttribute('tabindex', '0');
    expect(tab('b')).toHaveAttribute('tabindex', '-1');
    expect(tab('c')).toHaveAttribute('tabindex', '-1');
  });

  // singlePanel: every tab controls the one panel that is in the DOM. Without
  // this the tabs you are not on would name a panel id that does not exist.
  it('single panel: every tab points at that panel, which points back at the selected tab', () => {
    render(<Bar />);
    for (const t of TABS) expect(tab(t)).toHaveAttribute('aria-controls', 'x-tabpanel');
    expect(tab('a')).toHaveAttribute('id', 'x-tab-a');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'x-tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'x-tab-a');
  });

  it('per-tab panels: each tab controls its own, and each panel names its tab', () => {
    render(<PerTabBar />);
    for (const t of TABS) {
      expect(tab(t)).toHaveAttribute('aria-controls', `y-tabpanel-${t}`);
      expect(tab(t)).toHaveAttribute('id', `y-tab-${t}`);
      expect(document.getElementById(`y-tabpanel-${t}`)).toHaveAttribute('aria-labelledby', `y-tab-${t}`);
    }
  });

  // A role can lose access to the selected tab between renders. The bar must
  // still keep exactly one Tab stop instead of becoming unreachable.
  it('falls back to the first tab when the selected id is not shown', () => {
    render(<Bar ids={['b', 'c'] as readonly Tab[]} />);
    expect(tab('b')).toHaveAttribute('tabindex', '0');
    expect(tab('c')).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('tab', { name: 'a' })).toBeNull();
  });
});

describe('useRovingTabs: keyboard', () => {
  it('ArrowRight selects the next tab and moves focus with it', () => {
    const onSelect = vi.fn();
    render(<Bar onSelect={onSelect} />);
    key('ArrowRight');
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(document.activeElement).toBe(tab('b'));
    expect(tab('b')).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowRight wraps past the last tab', () => {
    const onSelect = vi.fn();
    render(<Bar onSelect={onSelect} />);
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowRight');
    expect(onSelect).toHaveBeenLastCalledWith('a');
    expect(document.activeElement).toBe(tab('a'));
  });

  it('ArrowLeft from the first tab wraps to the last', () => {
    const onSelect = vi.fn();
    render(<Bar onSelect={onSelect} />);
    key('ArrowLeft');
    expect(onSelect).toHaveBeenCalledWith('c');
    expect(document.activeElement).toBe(tab('c'));
  });

  it('ArrowDown and ArrowUp walk the bar too', () => {
    render(<Bar />);
    key('ArrowDown');
    expect(document.activeElement).toBe(tab('b'));
    key('ArrowUp');
    expect(document.activeElement).toBe(tab('a'));
  });

  it('Home and End jump to the ends', () => {
    render(<Bar />);
    key('End');
    expect(document.activeElement).toBe(tab('c'));
    key('Home');
    expect(document.activeElement).toBe(tab('a'));
  });

  it('takes over the arrow keys it handles, and leaves the others alone', () => {
    render(<Bar />);
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expect(key('Home').defaultPrevented).toBe(true);
    // Tab must still leave the bar, so it is never swallowed.
    expect(key('Tab').defaultPrevented).toBe(false);
    expect(key('a').defaultPrevented).toBe(false);
  });

  it('keeps the tabbable tab in step with the selection', () => {
    render(<Bar />);
    key('ArrowRight');
    expect(tab('b')).toHaveAttribute('tabindex', '0');
    expect(tab('a')).toHaveAttribute('tabindex', '-1');
  });
});
