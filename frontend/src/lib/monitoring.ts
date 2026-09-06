/**
 * monitoring.ts — centralized error monitoring (Sentry).
 *
 * Part of the 2026-09-06 architecture roadmap (Phase 1, item 4): before this
 * module, errors surfaced only as toasts and console.error calls that nobody
 * saw unless they happened to have DevTools open. This wraps Sentry behind a
 * tiny, dependency-light API so the rest of the app never imports Sentry
 * directly and the provider can be swapped later without a codebase-wide
 * refactor.
 *
 * Behavior when VITE_SENTRY_DSN is NOT set (local dev, PR preview builds,
 * anyone without a Sentry project): everything is a safe no-op that still
 * console.errors, so call sites never need to branch on "is monitoring
 * configured". This is deliberate — the free-tier DSN is a deployment secret
 * only in the sense of project routing, but we don't want noise or traffic
 * until a real project exists.
 *
 * Usage:
 *   import { initMonitoring, reportError, setMonitoringUser } from '@/lib/monitoring';
 *
 *   initMonitoring();                      // once, as early as possible (main.tsx)
 *   reportError(err, { where: 'submit-reading', plantId });   // anywhere
 *   setMonitoringUser({ id, role });       // after auth resolves (useAuth)
 */
import * as Sentry from '@sentry/react';
import { captureError } from './sentry';

let initialized = false;

/** Read once per initMonitoring() call; kept separate for testability. */
export function getSentryDsn(): string | undefined {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  return dsn && dsn.trim() !== '' ? dsn.trim() : undefined;
}

/**
 * Initialize Sentry. No-op when no DSN is configured or when already
 * initialized (safe to call from multiple entry points).
 */
export function initMonitoring(): void {
  if (initialized) return;
  const dsn = getSentryDsn();
  if (!dsn) {
    if (typeof console !== 'undefined') {
      console.info('[monitoring] VITE_SENTRY_DSN not set — error monitoring disabled (console-only).');
    }
    return;
  }
  initialized = true;
}

/**
 * Report an error with optional structured context. ALWAYS mirrors to
 * console.error so local dev and no-DSN deployments keep today's visibility.
 *
 * Context values should be small scalars (ids, role names, route paths) —
 * this is a monitoring breadcrumb, not a log dump.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  captureError(error, context);
}

/**
 * Attach the signed-in operator's identity to subsequent error events
 * (roadmap: "structured context — user role, plant ID, active page").
 * Pass undefined to clear on sign-out.
 */
export function setMonitoringUser(user: { id: string; role?: string } | undefined): void {
  if (!initialized) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id, role: user.role });
}

/**
 * Test-only: forget that initMonitoring() ran so a test can exercise the
 * no-op path or the DSN path from a clean slate. Not intended for app code.
 */
export function __resetMonitoringForTests(): void {
  initialized = false;
}
