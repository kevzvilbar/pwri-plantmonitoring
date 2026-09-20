import { useState, useEffect } from 'react';

/**
 * Returns a `Date` that advances on a fixed interval, so time-relative
 * labels (e.g. "Updated 4 min ago") tick forward without requiring a
 * network refetch.
 *
 * @param intervalMs - How often the date object is refreshed. Defaults to
 *   30 000 ms (30 seconds), which keeps labels accurate to the nearest
 *   half-minute without hammering the render loop.
 *
 * @example
 * const now = useNow(30_000);
 * const { label } = describeFreshness(lastReadingAt, now.getTime());
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

