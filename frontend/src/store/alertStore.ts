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
  /** Optional user who acknowledged this alert */
  acknowledgedBy?: string;
  /** When the alert was acknowledged */
  acknowledgedAt?: number;
  /** Optional user who resolved this alert */
  resolvedBy?: string;
  /** When the alert was resolved */
  resolvedAt?: number;
}

export type AlertStatus = 'active' | 'acknowledged' | 'resolved' | 'snoozed';

export function getAlertStatus(alert: PlantAlert, snoozeMap: SnoozeMap): AlertStatus {
  const snoozeExpiry = snoozeMap[alert.id];
  if (snoozeExpiry != null && snoozeExpiry > Date.now()) {
    return 'snoozed';
  }
  if (alert.resolvedAt != null) {
    return 'resolved';
  }
  if (alert.acknowledgedAt != null) {
    return 'acknowledged';
  }
  return 'active';
}

export type SnoozeMap = Record<string, number>;

export const isAlertSnoozed = (snoozeMap: SnoozeMap, id: string): boolean => {
  const expiry = snoozeMap[id];
  return expiry != null && expiry > Date.now();
};

export interface AlertState {
  plantAlerts: PlantAlert[];
  /** True once the first computation has run. P2-7: the bell empty state must
   *  say "Checking plant systems…" until then — never "operating normally". */
  alertsReady: boolean;
  addAlerts: (alerts: PlantAlert[]) => void;
  removeAlerts: (ids: string[]) => void;
  clearAlerts: () => void;
  
  snoozeMap: SnoozeMap;
  snoozeAlert: (id: string, durationMs?: number) => void;
  unsnoozeAlert: (id: string) => void;
  pruneSnooze: () => void;

  // New: Proper acknowledge/resolve actions
  acknowledgeAlert: (id: string, userId: string) => void;
  resolveAlert: (id: string, userId: string) => void;
  acknowledgeAll: (userId: string) => void;
  resolveAll: (userId: string) => void;
  
  // Selector for getting alert status
  getAlertStatus: (alert: PlantAlert) => AlertStatus;
}

export const useAlertStore = create<AlertState>()(
  persist(
    (set, get) => ({
      plantAlerts: [],
      alertsReady: false,
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
          return { plantAlerts: [...kept, ...active], alertsReady: true };
        }),
      removeAlerts: (ids) =>
        set((s) => {
          // NOTE: This function's name is misleading — it actually snoozes for 5 min
          // Consider renaming to snoozeAlertShort or refactoring to proper dismiss
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

      // New: Proper acknowledge — records who and when, no time limit
      acknowledgeAlert: (id, userId) =>
        set((s) => ({
          plantAlerts: s.plantAlerts.map((a) =>
            a.id === id
              ? { ...a, acknowledgedBy: userId, acknowledgedAt: Date.now() }
              : a
          ),
        })),
      // New: Proper resolve — records who and when, clears the alert
      resolveAlert: (id, userId) =>
        set((s) => ({
          plantAlerts: s.plantAlerts.map((a) =>
            a.id === id
              ? { ...a, resolvedBy: userId, resolvedAt: Date.now() }
              : a
          ),
        })),
      acknowledgeAll: (userId) =>
        set((s) => ({
          plantAlerts: s.plantAlerts.map((a) =>
            a.acknowledgedAt == null && a.resolvedAt == null
              ? { ...a, acknowledgedBy: userId, acknowledgedAt: Date.now() }
              : a
          ),
        })),
      resolveAll: (userId) =>
        set((s) => ({
          plantAlerts: s.plantAlerts.map((a) =>
            a.resolvedAt == null
              ? { ...a, resolvedBy: userId, resolvedAt: Date.now() }
              : a
          ),
        })),
      getAlertStatus: (alert) => getAlertStatus(alert, get().snoozeMap),
    }),
    {
      name: 'pwri-alert-state',
      partialize: (s) => ({
        snoozeMap: s.snoozeMap,
        // Note: plantAlerts themselves are NOT persisted — they're recomputed on mount
        // Only snoozeMap persists so snoozes survive page reloads
      }),
    }
  )
);
