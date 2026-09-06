import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  /** Optional in-app route to navigate to on click — e.g. the train's log page. */
  linkPath?: string;
}

export type SnoozeMap = Record<string, number>;

export const isAlertSnoozed = (snoozeMap: SnoozeMap, id: string): boolean => {
  const expiry = snoozeMap[id];
  return expiry != null && expiry > Date.now();
};

export interface AlertState {
  plantAlerts: PlantAlert[];
  addAlerts: (alerts: PlantAlert[]) => void;
  removeAlerts: (ids: string[]) => void;
  clearAlerts: () => void;
  
  snoozeMap: SnoozeMap;
  snoozeAlert: (id: string, durationMs?: number) => void;
  unsnoozeAlert: (id: string) => void;
  pruneSnooze: () => void;
}

export const useAlertStore = create<AlertState>()(
  persist(
    (set) => ({
      plantAlerts: [],
      addAlerts: (incoming) =>
        set((s) => {
          const now = Date.now();
          const dedupedIncoming = new Map<string, typeof incoming[0]>();
          incoming.forEach((a) => dedupedIncoming.set(a.id, a));
          const active = Array.from(dedupedIncoming.values()).filter((a) => {
            const expiry = s.snoozeMap[a.id];
            return expiry == null || expiry <= now;
          });
          const kept = s.plantAlerts.filter((a) => !active.find((n) => n.id === a.id));
          return { plantAlerts: [...kept, ...active] };
        }),
      removeAlerts: (ids) =>
        set((s) => {
          const dismissSnoozeExpiry = Date.now() + 5 * 60 * 1000;
          const updatedSnooze: SnoozeMap = { ...s.snoozeMap };
          ids.forEach((id) => { updatedSnooze[id] = dismissSnoozeExpiry; });
          return {
            plantAlerts: s.plantAlerts.filter((a) => !ids.includes(a.id)),
            snoozeMap: updatedSnooze,
          };
        }),
      clearAlerts: () => set({ plantAlerts: [] }),

      snoozeMap: {},
      snoozeAlert: (id, durationMs = 60 * 60 * 1000) =>
        set((s) => ({
          snoozeMap: { ...s.snoozeMap, [id]: Date.now() + durationMs },
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
    }),
    {
      name: 'pwri-alert-state',
      partialize: (s) => ({
        snoozeMap: s.snoozeMap,
      }),
    }
  )
);
