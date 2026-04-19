import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  selectedPlantId: string | null; // null = all plants
  setSelectedPlantId: (id: string | null) => void;
  unreadCount: number;
  setUnreadCount: (n: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedPlantId: null,
      setSelectedPlantId: (id) => set({ selectedPlantId: id }),
      unreadCount: 0,
      setUnreadCount: (n) => set({ unreadCount: n }),
    }),
    { name: 'pwri-app-state', partialize: (s) => ({ selectedPlantId: s.selectedPlantId }) },
  ),
);
