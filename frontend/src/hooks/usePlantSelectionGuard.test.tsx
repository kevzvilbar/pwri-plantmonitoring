import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const visible = vi.hoisted(() => ({
  value: { plants: [] as Array<{ id: string }>, isLoading: false, needsAssignment: false },
}));
vi.mock('@/hooks/useVisiblePlants', () => ({ useVisiblePlants: () => visible.value }));

import { usePlantSelectionGuard } from './usePlantSelectionGuard';
import { usePlantStore } from '@/store/plantStore';

describe('usePlantSelectionGuard (P5-2)', () => {
  beforeEach(() => {
    visible.value = { plants: [], isLoading: false, needsAssignment: false };
    usePlantStore.setState({ selectedPlantId: null });
  });

  it('clears a stored selection the user cannot see', () => {
    visible.value = { plants: [{ id: 'a' }, { id: 'b' }], isLoading: false, needsAssignment: false };
    usePlantStore.setState({ selectedPlantId: 'zzz' });
    renderHook(() => usePlantSelectionGuard());
    expect(usePlantStore.getState().selectedPlantId).toBeNull();
  });

  it('keeps a valid selection', () => {
    visible.value = { plants: [{ id: 'a' }, { id: 'b' }], isLoading: false, needsAssignment: false };
    usePlantStore.setState({ selectedPlantId: 'b' });
    renderHook(() => usePlantSelectionGuard());
    expect(usePlantStore.getState().selectedPlantId).toBe('b');
  });

  it('does nothing while loading (an Admin would momentarily look unassigned)', () => {
    visible.value = { plants: [], isLoading: true, needsAssignment: false };
    usePlantStore.setState({ selectedPlantId: 'a' });
    renderHook(() => usePlantSelectionGuard());
    expect(usePlantStore.getState().selectedPlantId).toBe('a');
  });

  it('does not clear on an empty list that may simply not have loaded (offline)', () => {
    visible.value = { plants: [], isLoading: false, needsAssignment: false };
    usePlantStore.setState({ selectedPlantId: 'a' });
    renderHook(() => usePlantSelectionGuard());
    expect(usePlantStore.getState().selectedPlantId).toBe('a');
  });

  it('clears the selection for a user known to have no plants', () => {
    visible.value = { plants: [], isLoading: false, needsAssignment: true };
    usePlantStore.setState({ selectedPlantId: 'a' });
    renderHook(() => usePlantSelectionGuard());
    expect(usePlantStore.getState().selectedPlantId).toBeNull();
  });
});
