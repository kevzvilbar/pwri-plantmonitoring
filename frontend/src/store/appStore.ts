import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { format, subDays } from 'date-fns';

// Re-exported here so the store file is self-contained; TrendChart
// imports RangeKey from types.ts as before — this is just for typing.
type RangeKey = '7D' | '14D' | '30D' | '60D' | '90D' | 'CUSTOM';

interface AppState {
  selectedPlantId: string | null; // null = all plants
  setSelectedPlantId: (id: string | null) => void;
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  /** The profile ID of the currently active shift operator.
   *  null means "use the authenticated user's own profile". */
  activeOperatorId: string | null;
  setActiveOperatorId: (id: string | null) => void;

  // ── Shared chart range ────────────────────────────────────────────
  // All TrendChart instances on the dashboard read from and write to
  // these three fields so that selecting 14D on one chart instantly
  // syncs every other chart to the same window.
  chartRange: RangeKey;
  chartFrom: string; // yyyy-MM-dd — only used when chartRange === 'CUSTOM'
  chartTo: string;   // yyyy-MM-dd — only used when chartRange === 'CUSTOM'
  setChartRange: (range: RangeKey) => void;
  setChartCustomDates: (from: string, to: string) => void;
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

      chartRange: '7D',
      chartFrom: format(subDays(new Date(), 7), 'yyyy-MM-dd'),
      chartTo: format(new Date(), 'yyyy-MM-dd'),
      setChartRange: (range) => set({ chartRange: range }),
      setChartCustomDates: (from, to) => set({ chartFrom: from, chartTo: to }),
    }),
    {
      name: 'pwri-app-state',
      partialize: (s) => ({
        selectedPlantId: s.selectedPlantId,
        activeOperatorId: s.activeOperatorId,
        chartRange: s.chartRange,
        chartFrom: s.chartFrom,
        chartTo: s.chartTo,
      }),
    },
  ),
);
