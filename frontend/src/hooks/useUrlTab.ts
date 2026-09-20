import { useSearchParams } from 'react-router-dom';

export interface UseUrlTabOptions<T extends string> {
  /** Other spellings of the param that map to a current tab, for links and
   *  bookmarks made before a tab was renamed. Matched case-insensitively. */
  aliases?: Readonly<Record<string, T>>;
  /** Query params to remove when the user picks a tab by hand: the ones that
   *  belong to the tab being left (a `?train=` or `?highlight=` deep link). */
  clearOnChange?: readonly string[];
}

/**
 * The active tab, kept in the URL (`?tab=history`) so it can be linked to,
 * survives a reload, and works with the browser's Back button.
 *
 * - An unknown or missing value falls back to `defaultValue`, so a stale link,
 *   or a tab this user's role cannot see, never leaves the page empty.
 *   `validValues` may differ per render (per role) for that reason.
 * - Other query params (`?plant=`, `?highlight=`) are kept on change, except
 *   those named in `clearOnChange`.
 * - A change replaces the history entry: switching tabs is not navigation.
 *
 * `setTab` takes a plain string, which is what Radix `onValueChange` hands
 * over, and ignores anything that is not a valid tab.
 */
export function useUrlTab<T extends string>(
  key: string,
  validValues: readonly T[],
  defaultValue: T,
  options: UseUrlTabOptions<T> = {},
): readonly [T, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const { aliases, clearOnChange } = options;

  const resolve = (raw: string | null): T | undefined => {
    if (raw == null) return undefined;
    const value = raw.trim().toLowerCase();
    // Own keys only: `?tab=constructor` must not find Object.prototype.constructor.
    const candidate =
      aliases && Object.prototype.hasOwnProperty.call(aliases, value) ? aliases[value] : value;
    return validValues.find((v) => v.toLowerCase() === candidate.toLowerCase());
  };

  const tab = resolve(searchParams.get(key)) ?? defaultValue;

  const setTab = (next: string) => {
    const resolved = resolve(next);
    if (resolved === undefined) return;
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.set(key, resolved);
        clearOnChange?.forEach((param) => sp.delete(param));
        return sp;
      },
      { replace: true },
    );
  };

  return [tab, setTab] as const;
}
