import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PlantState {
  selectedPlantId: string | null;
  setSelectedPlantId: (id: string | null) => void;
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  activeOperatorId: string | null;
  setActiveOperatorId: (id: string | null) => void;
}

export const usePlantStore = create<PlantState>()(
  persist(
    (set) => ({
      selectedPlantId: null,
      setSelectedPlantId: (id) => set((state) => (state.selectedPlantId === id ? state : { selectedPlantId: id })),
      unreadCount: 0,
      setUnreadCount: (n) => set((state) => (state.unreadCount === n ? state : { unreadCount: n })),
      activeOperatorId: null,
      setActiveOperatorId: (id) => set((state) => (state.activeOperatorId === id ? state : { activeOperatorId: id })),
    }),
    {
      name: 'pwri-plant-state',
      partialize: (s) => ({
        selectedPlantId: s.selectedPlantId,
        activeOperatorId: s.activeOperatorId,
      }),
    }
  )
);
