import { describe, it, expect, beforeEach } from 'vitest';
import { usePlantStore } from './plantStore';

describe('usePlantStore', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test if necessary
    usePlantStore.setState({
      selectedPlantId: null,
      unreadCount: 0,
      activeOperatorId: null,
    });
  });

  it('should have correct initial state', () => {
    const state = usePlantStore.getState();
    expect(state.selectedPlantId).toBeNull();
    expect(state.unreadCount).toBe(0);
    expect(state.activeOperatorId).toBeNull();
  });

  it('should update selectedPlantId', () => {
    usePlantStore.getState().setSelectedPlantId('plant-1');
    expect(usePlantStore.getState().selectedPlantId).toBe('plant-1');
  });

  it('should update unreadCount', () => {
    usePlantStore.getState().setUnreadCount(5);
    expect(usePlantStore.getState().unreadCount).toBe(5);
  });

  it('should update activeOperatorId', () => {
    usePlantStore.getState().setActiveOperatorId('operator-1');
    expect(usePlantStore.getState().activeOperatorId).toBe('operator-1');
  });
});
