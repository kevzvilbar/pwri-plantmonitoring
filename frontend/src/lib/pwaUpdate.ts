/**
 * pwaUpdate.ts — get new builds onto long-lived tabs without yanking operators
 * out of a form. FREE-PLAN-BUDGET-PLAN.md, Phase 7.
 *
 * WHY: with `registerType: "autoUpdate"` and no registration call, an open tab
 * keeps the bundle it started with until someone closes and reopens it. On
 * 2026-10-04 four browsers were still running the pre-fix bundle hours after
 * deploy (live logs: old `ro_trains?select=*,plants!inner(*)` requests, none of
 * the new shape), so quota fixes never reached field devices.
 *
 * Policy (registerType is now "prompt", so a new service worker WAITS until we
 * activate it):
 *  - apply automatically only when the tab has seen no input for IDLE_APPLY_MS
 *    AND nothing is mid-save (no pending/paused mutations);
 *  - otherwise show one persistent "Update" toast the operator can click when
 *    convenient;
 *  - re-check for a new version every CHECK_INTERVAL_MS while the tab is visible,
 *    and when it returns to the foreground. These requests go to the static host
 *    (sw.js), not to Supabase.
 */

import { useSyncExternalStore } from 'react';

declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD_DATE__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '1.0.0';

export const APP_BUILD_DATE: string =
  typeof __APP_BUILD_DATE__ !== 'undefined' && __APP_BUILD_DATE__ ? __APP_BUILD_DATE__ : '2026-10-17';

export const IDLE_APPLY_MS = 10 * 60_000;
export const CHECK_INTERVAL_MS = 30 * 60_000;
const MIN_CHECK_GAP_MS = 10 * 60_000;

let lastActivityTime = Date.now();

// ── Reactive PWA Update Store for UI Controls (More Drawer & Profile Menu) ──
export interface PwaUpdateSnapshot {
  appVersion: string;
  buildDate: string;
  updateAvailable: boolean;
  isChecking: boolean;
  newVersion?: string;
}

export interface ServerVersionInfo {
  version: string;
  versionCore?: string;
  buildDate?: string;
  commit?: string;
  timestamp?: number;
}

export async function fetchServerVersion(): Promise<ServerVersionInfo | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const rawBase = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : '/';
    const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
    const url = `${base}version.json?t=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerVersionInfo;
    return data && typeof data.version === 'string' ? data : null;
  } catch {
    return null;
  }
}

let snapshot: PwaUpdateSnapshot = {
  appVersion: APP_VERSION,
  buildDate: APP_BUILD_DATE,
  updateAvailable: false,
  isChecking: false,
};

const listeners = new Set<() => void>();
let activeApplyUpdate: (() => Promise<void> | void) | null = null;
let activeRegistration: ServiceWorkerRegistration | undefined;

function setSnapshot(partial: Partial<PwaUpdateSnapshot>) {
  snapshot = { ...snapshot, ...partial };
  listeners.forEach((l) => l());
}

function subscribePwaUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaUpdateSnapshot(): PwaUpdateSnapshot {
  return snapshot;
}

export async function applyWaitingPwaUpdate(): Promise<boolean> {
  setSnapshot({ updateAvailable: false });

  if (activeApplyUpdate) {
    try {
      await activeApplyUpdate();
      return true;
    } catch (e) {
      console.warn('[pwaUpdate] activeApplyUpdate error, falling back to cache purge:', e);
    }
  }

  // Fallback: post SKIP_WAITING to waiting worker, clear all CacheStorage, and reload
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = activeRegistration ?? await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn('[pwaUpdate] cache clear error:', err);
  }

  if (typeof window !== 'undefined') {
    window.location.reload();
    return true;
  }
  return false;
}

export async function checkForPwaUpdate(): Promise<'available' | 'up-to-date' | 'unsupported' | 'error'> {
  if (snapshot.updateAvailable && (activeApplyUpdate || snapshot.newVersion)) {
    return 'available';
  }

  setSnapshot({ isChecking: true });
  try {
    // 1. Check live deployed version from static version.json (always bypasses cache)
    const serverInfo = await fetchServerVersion();
    const isNewVersionOnServer =
      !!serverInfo?.version &&
      serverInfo.version.trim() !== APP_VERSION.trim();

    // 2. Query service worker registration
    let reg = activeRegistration;
    if (!reg && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      reg = await navigator.serviceWorker.getRegistration();
      if (reg) activeRegistration = reg;
    }

    if (reg) {
      try {
        await reg.update();
      } catch (err) {
        console.warn('[pwaUpdate] reg.update() failed:', err);
      }
    }

    // If server has a newer or different version, an update is DEFINITELY available!
    if (isNewVersionOnServer) {
      setSnapshot({
        updateAvailable: true,
        isChecking: false,
        newVersion: serverInfo.version,
      });

      // If worker is currently installing assets, give it up to 8s to finish precaching
      if (reg?.installing) {
        const worker = reg.installing;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 8000);
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
              clearTimeout(timer);
              resolve();
            }
          });
        });
      }

      return 'available';
    }

    // 3. Fallback: inspect Service Worker states
    if (reg?.waiting || snapshot.updateAvailable) {
      setSnapshot({ updateAvailable: true, isChecking: false });
      return 'available';
    }

    if (reg?.installing) {
      const worker = reg.installing;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 8000);
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      if (reg.waiting || snapshot.updateAvailable) {
        setSnapshot({ updateAvailable: true, isChecking: false });
        return 'available';
      }
    }

    if (!reg && !serverInfo) {
      setSnapshot({ isChecking: false });
      return 'unsupported';
    }

    setSnapshot({ isChecking: false });
    return snapshot.updateAvailable ? 'available' : 'up-to-date';
  } catch {
    setSnapshot({ isChecking: false });
    return 'error';
  }
}

export function usePwaUpdate() {
  const state = useSyncExternalStore(subscribePwaUpdate, getPwaUpdateSnapshot, getPwaUpdateSnapshot);
  return {
    ...state,
    checkForUpdate: checkForPwaUpdate,
    applyUpdate: applyWaitingPwaUpdate,
  };
}

export function recordUserActivity(): void {
  lastActivityTime = Date.now();
}

export function _resetPwaUpdateState(): void {
  lastActivityTime = Date.now();
  activeApplyUpdate = null;
  activeRegistration = undefined;
  setSnapshot({
    appVersion: APP_VERSION,
    buildDate: APP_BUILD_DATE,
    updateAvailable: false,
    isChecking: false,
    newVersion: undefined,
  });
}

export interface SilentUpdateCheckOptions {
  hasActiveMutations?: () => boolean;
  pendingMutations?: () => number;
  idleMs?: number;
}

/** Pure decision, unit-tested. */
export function canApplyUpdateSilently(options: SilentUpdateCheckOptions): boolean {
  const hasMutations = options.hasActiveMutations
    ? options.hasActiveMutations()
    : options.pendingMutations !== undefined
      ? options.pendingMutations() > 0
      : false;

  if (hasMutations) return false;

  const idle = options.idleMs !== undefined ? options.idleMs : Date.now() - lastActivityTime;
  return idle >= IDLE_APPLY_MS;
}

export interface PwaUpdateDeps {
  /** Activates the waiting worker and reloads (from virtual:pwa-register). */
  applyUpdate: () => Promise<void> | void;
  /** Shows a persistent prompt; `onAccept` applies the update. */
  showPrompt?: (onAccept: () => void) => void;
  promptUser?: (onAccept: () => void) => void;
  /** Check if any saves are in progress or paused. */
  hasActiveMutations?: () => boolean;
  pendingMutations?: () => number;
  now?: () => number;
}

/**
 * Returns `{ onNeedRefresh, onRegistered, onRegisteredSW, dispose }` to hand to registerSW().
 */
export function createPwaUpdateController(deps: PwaUpdateDeps) {
  const now = deps.now ?? Date.now;
  let lastCheck = 0;
  let waiting = false;
  let prompted = false;
  let registration: ServiceWorkerRegistration | undefined;
  let timers: ReturnType<typeof setInterval>[] = [];

  activeApplyUpdate = () => {
    waiting = false;
    setSnapshot({ updateAvailable: false });
    return deps.applyUpdate();
  };

  const markInput = () => {
    recordUserActivity();
  };
  const inputEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

  const checkHasMutations = (): boolean => {
    if (deps.hasActiveMutations) return deps.hasActiveMutations();
    if (deps.pendingMutations) return deps.pendingMutations() > 0;
    return false;
  };

  const tryApply = () => {
    if (!waiting) return;
    if (canApplyUpdateSilently({ idleMs: now() - lastActivityTime, hasActiveMutations: checkHasMutations })) {
      waiting = false;
      setSnapshot({ updateAvailable: false });
      void deps.applyUpdate();
    }
  };

  const check = async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (now() - lastCheck < MIN_CHECK_GAP_MS) return;
    lastCheck = now();

    try {
      const serverInfo = await fetchServerVersion();
      if (serverInfo?.version && serverInfo.version.trim() !== APP_VERSION.trim()) {
        waiting = true;
        setSnapshot({ updateAvailable: true, newVersion: serverInfo.version });
        if (canApplyUpdateSilently({ idleMs: now() - lastActivityTime, hasActiveMutations: checkHasMutations })) {
          waiting = false;
          setSnapshot({ updateAvailable: false });
          void deps.applyUpdate();
          return;
        }
        if (!prompted && promptFn) {
          prompted = true;
          promptFn(() => {
            waiting = false;
            setSnapshot({ updateAvailable: false });
            void deps.applyUpdate();
          });
        }
      }
    } catch {
      // ignore network errors during periodic check
    }

    if (registration) {
      void registration.update().catch(() => {});
    }
  };

  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      check();
      tryApply();
    }
  };

  if (typeof window !== 'undefined') {
    inputEvents.forEach((e) => window.addEventListener(e, markInput, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
  }

  // Idle-apply evaluation runs periodically; cheap, purely internal.
  timers.push(setInterval(tryApply, 60_000));

  const promptFn = deps.showPrompt ?? deps.promptUser;

  const handleRegistered = (reg: ServiceWorkerRegistration | undefined) => {
    registration = reg;
    activeRegistration = reg;
    if (reg?.waiting) {
      waiting = true;
      setSnapshot({ updateAvailable: true });
    }
    timers.push(setInterval(check, CHECK_INTERVAL_MS));
  };

  return {
    onNeedRefresh() {
      waiting = true;
      setSnapshot({ updateAvailable: true });
      if (canApplyUpdateSilently({ idleMs: now() - lastActivityTime, hasActiveMutations: checkHasMutations })) {
        waiting = false;
        setSnapshot({ updateAvailable: false });
        void deps.applyUpdate();
        return;
      }
      if (!prompted && promptFn) {
        prompted = true;
        promptFn(() => {
          waiting = false;
          setSnapshot({ updateAvailable: false });
          void deps.applyUpdate();
        });
      }
    },
    onRegistered(reg: ServiceWorkerRegistration | undefined) {
      handleRegistered(reg);
    },
    onRegisteredSW(_url: string, reg: ServiceWorkerRegistration | undefined) {
      handleRegistered(reg);
    },
    dispose() {
      timers.forEach(clearInterval);
      timers = [];
      if (typeof window !== 'undefined') {
        inputEvents.forEach((e) => window.removeEventListener(e, markInput));
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
}


