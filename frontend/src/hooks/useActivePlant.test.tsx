import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const visible = vi.hoisted(() => ({
  value: {
    plants: [] as Array<{ id: string; name: string }>,
    plantIds: [] as string[],
    seesAll: false,
    isLoading: false,
    needsAssignment: false,
  },
}));
vi.mock('@/hooks/useVisiblePlants', () => ({ useVisiblePlants: () => visible.value }));

import { useActivePlant } from './useActivePlant';
import { usePlantStore } from '@/store/plantStore';

const A = { id: 'a', name: 'Alpha' };
const B = { id: 'b', name: 'Bravo' };

function setVisible(over: Partial<typeof visible.value>) {
  visible.value = { plants: [], plantIds: [], seesAll: false, isLoading: false, needsAssignment: false, ...over };
  if (over.plants) visible.value.plantIds = over.plants.map((p) => p.id);
}

describe('useActivePlant (P5-2)', () => {
  beforeEach(() => {
    usePlantStore.setState({ selectedPlantId: null });
    setVisible({});
  });

  it('resolves the globally selected plant', () => {
    setVisible({ plants: [A, B] });
    usePlantStore.setState({ selectedPlantId: 'b' });
    const { result } = renderHook(() => useActivePlant());
    expect(result.current.plant).toEqual(B);
    expect(result.current.plantId).toBe('b');
    expect(result.current.needsSelection).toBe(false);
  });

  it('does NOT fall back to the first plant: with several visible and none chosen it asks', () => {
    setVisible({ plants: [A, B] });
    const { result } = renderHook(() => useActivePlant());
    expect(result.current.plantId).toBe('');
    expect(result.current.needsSelection).toBe(true);
    expect(result.current.plants).toEqual([A, B]);
  });

  it('resolves the only visible plant without asking', () => {
    setVisible({ plants: [B] });
    const { result } = renderHook(() => useActivePlant());
    expect(result.current.plantId).toBe('b');
    expect(result.current.needsSelection).toBe(false);
  });

  it('ignores a stored selection the user cannot see', () => {
    setVisible({ plants: [A, B] });
    usePlantStore.setState({ selectedPlantId: 'zzz' });
    const { result } = renderHook(() => useActivePlant());
    expect(result.current.plantId).toBe('');
    expect(result.current.needsSelection).toBe(true);
  });

  it('reports no plant while loading, even if a selection is stored', () => {
    setVisible({ isLoading: true });
    usePlantStore.setState({ selectedPlantId: 'a' });
    const { result } = renderHook(() => useActivePlant());
    expect(result.current.plantId).toBe('');
    expect(result.current.isLoading).toBe(true);
    expect(result.current.needsSelection).toBe(false);
  });

  it('a user with no plants gets needsAssignment and no plant', () => {
    setVisible({ needsAssignment: true });
    usePlantStore.setState({ selectedPlantId: 'a' });
    const { result } = renderHook(() => useActivePlant());
    expect(result.current.needsAssignment).toBe(true);
    expect(result.current.plantId).toBe('');
  });

  it('offline: when the plant list cannot be read, it trusts the stored selection so data entry keeps working', () => {
    setVisible({ plants: [], needsAssignment: false, isLoading: false });
    usePlantStore.setState({ selectedPlantId: 'a' });
    const { result } = renderHook(() => useActivePlant());
    expect(result.current.plantId).toBe('a');
    expect(result.current.plant).toBeNull();
    expect(result.current.needsSelection).toBe(false);
  });

  it('select() writes the global selection, the same one the TopBar shows', () => {
    setVisible({ plants: [A, B] });
    const { result } = renderHook(() => useActivePlant());
    act(() => result.current.select('b'));
    expect(usePlantStore.getState().selectedPlantId).toBe('b');
    expect(result.current.plantId).toBe('b');
  });
});
