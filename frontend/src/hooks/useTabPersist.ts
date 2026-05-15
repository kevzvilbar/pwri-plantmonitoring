import { useState, useCallback } from 'react';

/**
 * Drop-in replacement for `useState` for tab values.
 * Persists the active tab to sessionStorage so it survives page refreshes
 * and back-navigation without any auto-refresh triggers.
 *
 * @param key        Unique sessionStorage key, e.g. 'tab:maintenance'
 * @param defaultTab Fallback when nothing is stored yet
 */
export function useTabPersist<T extends string>(
  key: string,
  defaultTab: T,
): [T, (tab: T) => void] {
  const [tab, setTabState] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return (stored as T) ?? defaultTab;
    } catch {
      return defaultTab;
    }
  });

  const setTab = useCallback(
    (next: T) => {
      try {
        sessionStorage.setItem(key, next);
      } catch { /* ignore quota errors */ }
      setTabState(next);
    },
    [key],
  );

  return [tab, setTab];
}
