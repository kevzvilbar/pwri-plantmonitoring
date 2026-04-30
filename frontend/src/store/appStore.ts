import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  selectedPlantId: string | null; // null = all plants
  setSelectedPlantId: (id: string | null) => void;
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  /** The profile ID of the currently active shift operator.
   *  null means "use the authenticated user's own profile". */
  activeOperatorId: string | null;
  setActiveOperatorId: (id: string | null) => void;
}

export const useAppStore = create<AppState>()(
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
      name: 'pwri-app-state',
      partialize: (s) => ({ selectedPlantId: s.selectedPlantId, activeOperatorId: s.activeOperatorId }),
    },
  ),
);
