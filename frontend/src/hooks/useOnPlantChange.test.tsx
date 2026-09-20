import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOnPlantChange } from './useOnPlantChange';

describe('useOnPlantChange (P5-2)', () => {
  it('does not fire on the first render', () => {
    const cb = vi.fn();
    renderHook(({ id }) => useOnPlantChange(id, cb), { initialProps: { id: 'a' } });
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires once when the plant changes, and not on re-renders with the same plant', () => {
    const cb = vi.fn();
    const { rerender } = renderHook(({ id }) => useOnPlantChange(id, cb), { initialProps: { id: 'a' } });
    rerender({ id: 'a' });
    expect(cb).not.toHaveBeenCalled();
    rerender({ id: 'b' });
    expect(cb).toHaveBeenCalledTimes(1);
    rerender({ id: 'b' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('always calls the latest callback (no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ id, cb }) => useOnPlantChange(id, cb), { initialProps: { id: 'a', cb: first } });
    rerender({ id: 'a', cb: second });
    rerender({ id: 'b', cb: second });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('fires when the plant is cleared ("" after a real plant)', () => {
    const cb = vi.fn();
    const { rerender } = renderHook(({ id }) => useOnPlantChange(id, cb), { initialProps: { id: 'a' } });
    rerender({ id: '' });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
