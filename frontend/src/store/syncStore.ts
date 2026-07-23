/**
 * syncStore
 *
 * Lightweight Zustand slice that holds background-sync runtime state.
 * Intentionally NOT persisted — it is re-derived on every mount.
 *
 * Consumers:
 *   • useBackgroundSync  — writes status / lastSynced / error
 *   • SyncIndicator      — reads and renders sync state in the TopBar
 */

import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'error';

interface SyncState {
  status: SyncStatus;
  lastSynced: Date | null;
  error: string | null;

  setStatus: (s: SyncStatus) => void;
  setLastSynced: (d: Date) => void;
  setError: (msg: string | null) => void;
}

export const useSyncStore = create<SyncState>()((set) => ({
  status:      'idle',
  lastSynced:  null,
  error:       null,

  setStatus:     (status)     => set({ status }),
  setLastSynced: (lastSynced) => set({ lastSynced, status: 'idle', error: null }),
  setError:      (error)      => set({ error, status: error ? 'error' : 'idle' }),
}));
