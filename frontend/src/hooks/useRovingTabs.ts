import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface UseRovingTabsOptions<T extends string> {
  /** Tab ids in visual order — the order Arrow Left/Right walks. */
  ids: readonly T[];
  selected: T;
  onSelect: (id: T) => void;
  /**
   * Prefix for the generated ids. A tab becomes `${idPrefix}-tab-${id}` and its
   * panel `${idPrefix}-tabpanel-${id}`, so the panel can point back with
   * aria-labelledby and the tab forward with aria-controls.
   */
  idPrefix: string;
  /**
   * True when the caller renders ONE panel whose content is swapped, rather
   * than one panel per tab. Then every tab points aria-controls at that single
   * panel. Without this the tabs you are not on would name a panel id that is
   * not in the DOM, which is worse than omitting aria-controls altogether.
   *
   * One panel per tab (all mounted, the inactive ones `hidden`) is the other
   * supported shape — see PlantDetailTabs.
   */
  singlePanel?: boolean;
}

export interface RovingTabs<T extends string> {
  /** Spread onto the bar itself. */
  tablistProps: {
    role: 'tablist';
    'aria-orientation': 'horizontal';
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
  /** Spread onto each tab button. */
  tabProps: (id: T) => {
    role: 'tab';
    id: string;
    tabIndex: number;
    'aria-selected': boolean;
    'aria-controls': string;
    ref: (el: HTMLButtonElement | null) => void;
  };
  /** Spread onto the panel showing `id`. */
  panelProps: (id: T) => {
    role: 'tabpanel';
    id: string;
    'aria-labelledby': string;
  };
}

/**
 * Keyboard and ARIA behaviour for a tab bar built from plain <button>s (P5-11).
 *
 * Radix's <Tabs> supplies role="tablist" / role="tab" / aria-selected and a
 * roving tabindex for free. The custom bars on Daily Readings and the plant
 * detail page render their own buttons, so before this they announced nothing
 * to a screen reader and could not be arrowed through.
 *
 * Adding the roles alone is not enough — role="tab" on every button while all
 * of them stay tabbable leaves one Tab stop per tab, which is exactly the cost
 * arrow-key navigation exists to remove. So the selected tab is the single Tab
 * stop, and Arrow/Home/End move selection and focus together, per the ARIA
 * tabs pattern. Selection is still reported through `onSelect`, so it lands in
 * the URL via useUrlTab() as before; focus follows it because the buttons stay
 * mounted (they are keyed by id, not remounted).
 *
 * `ids` may be rebuilt on each render by the caller (`.map()` over a config
 * table is the normal shape) — the join key below keeps the callbacks stable
 * anyway, so this does not force a new handler every render.
 */
export function useRovingTabs<T extends string>({
  ids,
  selected,
  onSelect,
  idPrefix,
  singlePanel = false,
}: UseRovingTabsOptions<T>): RovingTabs<T> {
  const nodes = useRef(new Map<T, HTMLButtonElement>());
  const idsKey = ids.join('\u0000');

  // One shared panel id in singlePanel mode, otherwise one per tab.
  const panelId = singlePanel ? `${idPrefix}-tabpanel` : null;

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const order = idsKey.split('\u0000') as T[];
      const i = order.indexOf(selected);
      if (i < 0 || order.length === 0) return;

      let next: number;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (i + 1) % order.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (i - 1 + order.length) % order.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = order.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      const id = order[next];
      onSelect(id);
      nodes.current.get(id)?.focus();
    },
    [idsKey, selected, onSelect],
  );

  // If the selected tab is not in `ids` (a role lost access to it between
  // renders), fall back to the first tab so the bar keeps exactly one Tab stop
  // instead of becoming unreachable.
  const selectedIsPresent = idsKey.split('\u0000').includes(selected);
  const firstId = idsKey.split('\u0000')[0] as T | undefined;

  const tabProps = useCallback(
    (id: T) => ({
      role: 'tab' as const,
      id: `${idPrefix}-tab-${id}`,
      tabIndex: id === selected || (!selectedIsPresent && id === firstId) ? 0 : -1,
      'aria-selected': id === selected,
      'aria-controls': panelId ?? `${idPrefix}-tabpanel-${id}`,
      ref: (el: HTMLButtonElement | null) => {
        // React 18 callback ref: block body, so nothing is returned.
        if (el) nodes.current.set(id, el);
        else nodes.current.delete(id);
      },
    }),
    [idPrefix, selected, selectedIsPresent, firstId, panelId],
  );

  const panelProps = useCallback(
    (id: T) => ({
      role: 'tabpanel' as const,
      id: panelId ?? `${idPrefix}-tabpanel-${id}`,
      'aria-labelledby': `${idPrefix}-tab-${id}`,
    }),
    [idPrefix, panelId],
  );

  return {
    tablistProps: { role: 'tablist', 'aria-orientation': 'horizontal', onKeyDown },
    tabProps,
    panelProps,
  };
}
