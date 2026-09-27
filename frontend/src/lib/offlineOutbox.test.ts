// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePendingOutboxCount } from './offlineOutbox';
import * as rq from '@tanstack/react-query';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useMutationState: vi.fn(),
  };
});

describe('usePendingOutboxCount', () => {
  it('returns count of paused mutations', () => {
    vi.mocked(rq.useMutationState).mockReturnValue([true, true, false, true]);

    const { result } = renderHook(() => usePendingOutboxCount());
    expect(result.current).toBe(3);
  });

  it('returns 0 when no mutations are paused', () => {
    vi.mocked(rq.useMutationState).mockReturnValue([]);

    const { result } = renderHook(() => usePendingOutboxCount());
    expect(result.current).toBe(0);
  });
});
