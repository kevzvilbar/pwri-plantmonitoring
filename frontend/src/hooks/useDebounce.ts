import { useState, useEffect } from 'react';

/**
 * Custom hook to debounce any fast-changing value (e.g. search query inputs).
 * Delays updating the debounced value until after `delayMs` milliseconds have
 * elapsed since the last change.
 *
 * @param value The value to debounce
 * @param delayMs Delay in milliseconds (defaults to 250ms)
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delayMs: number = 250): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delayMs]);

  return debouncedValue;
}

