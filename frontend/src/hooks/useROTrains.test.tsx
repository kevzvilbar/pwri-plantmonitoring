import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useROTrains, useROTrainsForPlant } from './useROTrains';
import { supabase } from '@/integrations/supabase/client';

const fromMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: any[]) => fromMock(...args),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function mockChain() {
  const inSpy = vi.fn().mockResolvedValue({ data: [{ id: 't1', plant_id: 'p1' }], error: null });
  const orderSpy = vi.fn(() => ({ in: inSpy, then: (resolve: any) => resolve({ data: [{ id: 't1', plant_id: 'p1' }], error: null }) }));
  const selectSpy = vi.fn(() => ({ order: orderSpy }));
  fromMock.mockReturnValue({ select: selectSpy });
  return { selectSpy, orderSpy, inSpy };
}

describe('useROTrains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('regression: an explicitly empty plant-id array returns [] and never calls the network', async () => {
    // Reproduces the scoping bug: plantIds commonly comes from
    // useVisiblePlants().visiblePlants, which is legitimately [] for a
    // user with no plant assigned (P5-1). The old `plantId ? ... : null`
    // check treated [] as truthy, so the `.in()` filter was skipped and
    // every train in the system was fetched instead of none.
    mockChain();
    const { result } = renderHook(() => useROTrains([]), { wrapper: createWrapper() });

    expect(result.current.data).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('plantId: undefined fetches every train with no .in() filter ("All plants" view)', async () => {
    const { inSpy } = mockChain();
    const { result } = renderHook(() => useROTrains(undefined), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fromMock).toHaveBeenCalledWith('ro_trains');
    expect(inSpy).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([{ id: 't1', plant_id: 'p1' }]);
  });

  it('a non-empty plant-id array filters with .in(plant_id, ids)', async () => {
    const { inSpy } = mockChain();
    const { result } = renderHook(() => useROTrains(['p1', 'p2']), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inSpy).toHaveBeenCalledWith('plant_id', ['p1', 'p2']);
  });

  it('useROTrainsForPlant(undefined) behaves like the "All plants" view, not an empty selection', async () => {
    const { inSpy } = mockChain();
    renderHook(() => useROTrainsForPlant(undefined), { wrapper: createWrapper() });

    await waitFor(() => expect(fromMock).toHaveBeenCalled());
    expect(inSpy).not.toHaveBeenCalled();
  });

  it('useROTrainsForPlant(id) wraps a single id into a one-element array', async () => {
    const { inSpy } = mockChain();
    renderHook(() => useROTrainsForPlant('p1'), { wrapper: createWrapper() });

    await waitFor(() => expect(inSpy).toHaveBeenCalledWith('plant_id', ['p1']));
  });
});
