/**
 * useDraft — auto-saves form state to localStorage and restores it on mount.
 *
 * Usage:
 *   const { draft, setDraft, hasDraft, clearDraft, discardDraft } = useDraft(
 *     `incident-report:${user?.id}`,   // unique key per form + per user
 *     initialFormState,
 *   );
 *
 *   // Use `draft` instead of your local state value.
 *   // Use `setDraft` instead of your local setState.
 *   // After a successful save: call clearDraft() — wipes storage and resets form.
 *   // "Discard" button: call discardDraft() — wipes storage and resets form.
 *   // Show <DraftBanner> when hasDraft === true.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const STORAGE_PREFIX = 'pwri-draft:';

export function useDraft<T extends Record<string, unknown>>(
  key: string,
  initial: T,
  options?: { debounceMs?: number },
) {
  const storageKey = STORAGE_PREFIX + key;
  const debounceMs = options?.debounceMs ?? 400;

  // Capture initial once — avoids stale-closure issues when caller
  // passes an inline object literal that changes reference each render.
  const initialRef = useRef<T>(initial);

  // Seed state from localStorage if a draft exists, otherwise use initial.
  const [draft, _setDraft] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return { ...initialRef.current, ...JSON.parse(raw) } as T;
    } catch { /* corrupt JSON — fall through */ }
    return initialRef.current;
  });

  const [hasDraft, setHasDraft] = useState<boolean>(() => {
    try { return !!localStorage.getItem(storageKey); } catch { return false; }
  });

  // Prevent writing on the very first render (we just read from storage).
  const isMounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(draft));
        setHasDraft(true);
      } catch {
        // Quota exceeded or private-browsing restriction — fail silently.
      }
    }, debounceMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Drop-in replacement for a regular useState setter. */
  const setDraft = useCallback(
    (updater: T | ((prev: T) => T)) =>
      _setDraft((prev) =>
        typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater,
      ),
    [],
  );

  /**
   * Call after a successful save.
   * Removes the stored draft and resets the form.
   * Optionally pass a custom reset value (e.g. to keep plant_id selected).
   */
  const clearDraft = useCallback(
    (resetTo?: Partial<T>) => {
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      setHasDraft(false);
      _setDraft({ ...initialRef.current, ...resetTo });
    },
    [storageKey],
  );

  /**
   * "Discard draft" action — removes storage and resets form to initial.
   */
  const discardDraft = useCallback(() => {
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    setHasDraft(false);
    _setDraft(initialRef.current);
  }, [storageKey]);

  return { draft, setDraft, hasDraft, clearDraft, discardDraft };
}
