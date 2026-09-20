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

/** alert_key → status derived from the `alert_events` audit trail (P3-2). */
export type ServerStatusMap = Record<string, AlertStatus>;

export function getAlertStatus(
  alert: PlantAlert,
  snoozeMap: SnoozeMap,
  serverStatusByKey: ServerStatusMap = {},
): AlertStatus {
  // 1. A live local snooze wins: the user just tapped it and the write may
  //    still be in flight (or queued offline), so this is the freshest signal.
  const snoozeExpiry = snoozeMap[alert.id];
  if (snoozeExpiry != null && snoozeExpiry > Date.now()) {
    return 'snoozed';
  }
  // 2. Otherwise the server's latest event is the truth — it is what lets an
  //    acknowledgement survive a reload and be visible to a second user, and
  //    it can also send an alert back to 'active' (a 'reopened' event).
  const server = serverStatusByKey[alert.id];
  if (server) return server;
  // 3. Fall back to whatever this browser set locally (pre-migration, or the
  //    statuses query hasn't landed yet).
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
  /** P3-6: removes alerts whose *condition* has cleared. Renamed from the old
   *  `removeAlerts`, which snoozed for 5 minutes under a name that read like a
   *  delete. This one really does remove — no snooze side effect — because the
   *  caller has already re-evaluated the underlying reading. */
  clearConditionAlerts: (ids: string[]) => void;
  clearAlerts: () => void;

  /** alert_key → status from the alert_events audit trail (P3-2). Written by
   *  AlertsRuntime; read by getAlertStatus so the nav badge counts only
   *  unacknowledged alerts without every consumer fetching the table. */
  serverStatusByKey: ServerStatusMap;
  setServerStatuses: (next: ServerStatusMap) => void;

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
      serverStatusByKey: {},
      setServerStatuses: (next) => set({ serverStatusByKey: next }),
      addAlerts: (incoming) =>
        set((s) => {
          const now = Date.now();
          const dedupedIncoming = new Map<string, typeof incoming[0]>();
          incoming.forEach((a) => dedupedIncoming.set(a.id, a));
          // P3-4/P3-5 (D2): drop alerts the user already acted on. The recompute
          // only knows the live condition, so without this an acknowledged or
          // resolved alert would re-enter the list on the very next tick —
          // which is exactly why "Resolve all" looked cosmetic before.
          const active = Array.from(dedupedIncoming.values()).filter((a) => {
            const expiry = s.snoozeMap[a.id];
            if (expiry != null && expiry > now) return false;
            return !s.serverStatusByKey[a.id] || s.serverStatusByKey[a.id] === 'active';
          });
          // P3-4: merge by id and preserve status set on the stored object.
          // The recompute only knows live conditions, so a fresh copy of an
          // id we already hold would wipe acknowledgedBy/resolvedBy. Keep the
          // stored status fields; refresh everything else (title, severity…).
          const byId = new Map(s.plantAlerts.map((a) => [a.id, a]));
          const merged = active.map((a) => {
            const prev = byId.get(a.id);
            if (!prev) return a;
            return {
              ...a,
              acknowledgedBy: prev.acknowledgedBy,
              acknowledgedAt: prev.acknowledgedAt,
              resolvedBy: prev.resolvedBy,
              resolvedAt: prev.resolvedAt,
              // P3-5 (D2): a resolve suppresses re-firing until the value
              // changes. The recompute pushes a new timestamp each tick; if
              // the condition were still true and we kept the new timestamp,
              // a resolved alert would look fresh again. Keep the stored
              // timestamp for acknowledged/resolved alerts.
              timestamp:
                prev.acknowledgedAt != null || prev.resolvedAt != null
                  ? prev.timestamp
                  : a.timestamp,
            };
          });
          const mergedIds = new Set(merged.map((a) => a.id));
          const kept = s.plantAlerts.filter((a) => !mergedIds.has(a.id));
          return { plantAlerts: [...kept, ...merged], alertsReady: true };
        }),
      clearConditionAlerts: (ids) =>
        set((s) => {
          // The caller has re-evaluated the reading and the condition is gone,
          // so the alarm should leave the list outright. The old `removeAlerts`
          // instead snoozed for 5 minutes, which both hid a still-true alarm
          // and silently punched a hole in the list.
          const gone = new Set(ids);
          return { plantAlerts: s.plantAlerts.filter((a) => !gone.has(a.id)) };
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
      getAlertStatus: (alert) => getAlertStatus(alert, get().snoozeMap, get().serverStatusByKey),
    }),
    {
      name: 'pwri-alert-state',
      partialize: (s) => ({
        snoozeMap: s.snoozeMap,
        // Note: plantAlerts themselves are NOT persisted — they're recomputed on mount.
        // Only snoozeMap persists so snoozes survive page reloads.
        // serverStatusByKey is always refetched from alert_events on mount, so
        // persisting it would only risk showing a stale acknowledgement.
      }),
    }
  )
);
