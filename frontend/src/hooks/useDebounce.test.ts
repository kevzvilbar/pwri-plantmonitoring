import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from './useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 250));
    expect(result.current).toBe('initial');
  });

  it('updates value only after delay has passed', () => {
    const { result, rerender } = renderHook(
      ({ val, delay }) => useDebounce(val, delay),
      { initialProps: { val: 'first', delay: 250 } }
    );

    expect(result.current).toBe('first');

    // Change value
    rerender({ val: 'second', delay: 250 });

    // Before timer fires, value is still 'first'
    expect(result.current).toBe('first');

    // Advance halfway
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe('first');

    // Advance past delay
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('second');
  });

  it('resets timer if value changes rapidly within the delay window', () => {
    const { result, rerender } = renderHook(
      ({ val, delay }) => useDebounce(val, delay),
      { initialProps: { val: 'a', delay: 300 } }
    );

    rerender({ val: 'ab', delay: 300 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('a');

    rerender({ val: 'abc', delay: 300 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('a');

    // Now advance remaining 100ms for 'abc'
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('abc');
  });
});
