import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { format, subDays } from 'date-fns';
import { DEFAULT_THEME_ID } from '@/lib/themes';

// Re-exported here so the store file is self-contained; TrendChart
// imports RangeKey from types.ts as before — this is just for typing.
type RangeKey = '7D' | '14D' | '30D' | '60D' | '90D' | 'CUSTOM';

// ── Plant Alert types ─────────────────────────────────────────────────────────
export type PlantAlertSeverity = 'critical' | 'warning' | 'info';

export interface PlantAlert {
  /** Stable unique key — e.g. "high-tds-<trainId>" so re-fires upsert, not duplicate */
  id: string;
  severity: PlantAlertSeverity;
  title: string;
  description: string;
  /** Human-readable source module, e.g. "RO Trains" */
  source: string;
  plantId: string;
  timestamp: number; // Date.now()
}

/** Map of alertId → Unix ms when the snooze expires */
export type SnoozeMap = Record<string, number>;

/** Returns true if the given alert id is currently snoozed */
export const isAlertSnoozed = (snoozeMap: SnoozeMap, id: string): boolean => {
  const expiry = snoozeMap[id];
  return expiry != null && expiry > Date.now();
};

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

  // ── Plant Alerts (in-memory, not persisted) ───────────────────────
  // Modules push alerts here; TopBar bell + PlantAlertPanel read from here.
  plantAlerts: PlantAlert[];
  /** Upsert alerts by id — replaces any existing alert with the same id */
  addAlerts: (alerts: PlantAlert[]) => void;
  /** Dismiss specific alert ids */
  removeAlerts: (ids: string[]) => void;
  /** Wipe all plant alerts (e.g. on plant switch) */
  clearAlerts: () => void;

  // ── Alert snooze ──────────────────────────────────────────────────
  // Snoozed alerts are hidden from the bell until their expiry passes.
  // Persisted so a page reload does not wake them up early.
  snoozeMap: SnoozeMap;
  /** Snooze an alert for durationMs (default = 1 hour) */
  snoozeAlert: (id: string, durationMs?: number) => void;
  /** Un-snooze a specific alert immediately */
  unsnoozeAlert: (id: string) => void;
  /** Purge expired entries from snoozeMap */
  pruneSnooze: () => void;

  // ── Color theme ───────────────────────────────────────────────────
  colorTheme: string;
  setColorTheme: (themeId: string) => void;
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

      // ── Plant alerts ──────────────────────────────────────────────
      plantAlerts: [],
      addAlerts: (incoming) =>
        set((s) => {
          const now = Date.now();
          // 1. Dedup the incoming batch by ID (last push wins — highest value in a
          //    single useEffect sweep, e.g. two readings for the same train).
          const dedupedIncoming = new Map<string, typeof incoming[0]>();
          incoming.forEach((a) => dedupedIncoming.set(a.id, a));
          // 2. Filter out snoozed / dismissed alerts so they don't reappear
          const active = Array.from(dedupedIncoming.values()).filter((a) => {
            const expiry = s.snoozeMap[a.id];
            return expiry == null || expiry <= now;
          });
          // 3. Upsert into existing list
          const kept = s.plantAlerts.filter((a) => !active.find((n) => n.id === a.id));
          return { plantAlerts: [...kept, ...active] };
        }),
      removeAlerts: (ids) =>
        set((s) => {
          // Auto-snooze dismissed alerts for 5 minutes so the next 60-second
          // refetch doesn't immediately re-add them while the condition persists.
          const dismissSnoozeExpiry = Date.now() + 5 * 60 * 1000;
          const updatedSnooze: SnoozeMap = { ...s.snoozeMap };
          ids.forEach((id) => { updatedSnooze[id] = dismissSnoozeExpiry; });
          return {
            plantAlerts: s.plantAlerts.filter((a) => !ids.includes(a.id)),
            snoozeMap: updatedSnooze,
          };
        }),
      clearAlerts: () => set({ plantAlerts: [] }),

      // ── Snooze ────────────────────────────────────────────────────
      snoozeMap: {},
      snoozeAlert: (id, durationMs = 60 * 60 * 1000) =>
        set((s) => ({
          snoozeMap: { ...s.snoozeMap, [id]: Date.now() + durationMs },
          // Also remove from visible alerts immediately
          plantAlerts: s.plantAlerts.filter((a) => a.id !== id),
        })),
      unsnoozeAlert: (id) =>
        set((s) => {
          const next = { ...s.snoozeMap };
          delete next[id];
          return { snoozeMap: next };
        }),
      pruneSnooze: () =>
        set((s) => {
          const now = Date.now();
          const next: SnoozeMap = {};
          for (const [k, v] of Object.entries(s.snoozeMap)) {
            if (v > now) next[k] = v;
          }
          return { snoozeMap: next };
        }),

      // ── Color theme ──────────────────────────────────────────────
      colorTheme: DEFAULT_THEME_ID,
      setColorTheme: (themeId) => set({ colorTheme: themeId }),
    }),
    {
      name: 'pwri-app-state',
      partialize: (s) => ({
        selectedPlantId: s.selectedPlantId,
        activeOperatorId: s.activeOperatorId,
        chartRange: s.chartRange,
        chartFrom: s.chartFrom,
        chartTo: s.chartTo,
        snoozeMap: s.snoozeMap,          // persisted so reload doesn't wake alerts early
        colorTheme: s.colorTheme,        // persisted so theme survives page reload
        // plantAlerts intentionally NOT persisted — re-derived on mount from live data
      }),
    },
  ),
);
