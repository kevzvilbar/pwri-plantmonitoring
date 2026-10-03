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

export const IDLE_APPLY_MS = 10 * 60_000;
export const CHECK_INTERVAL_MS = 30 * 60_000;
const MIN_CHECK_GAP_MS = 10 * 60_000;

let lastActivityTime = Date.now();

export function recordUserActivity(): void {
  lastActivityTime = Date.now();
}

export function _resetPwaUpdateState(): void {
  lastActivityTime = Date.now();
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
      void deps.applyUpdate();
    }
  };

  const check = () => {
    if (!registration) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (now() - lastCheck < MIN_CHECK_GAP_MS) return;
    lastCheck = now();
    void registration.update().catch(() => {});
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
    timers.push(setInterval(check, CHECK_INTERVAL_MS));
  };

  return {
    onNeedRefresh() {
      waiting = true;
      if (canApplyUpdateSilently({ idleMs: now() - lastActivityTime, hasActiveMutations: checkHasMutations })) {
        waiting = false;
        void deps.applyUpdate();
        return;
      }
      if (!prompted && promptFn) {
        prompted = true;
        promptFn(() => {
          waiting = false;
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

