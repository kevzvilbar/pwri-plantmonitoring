/**
 * Unit tests for the Sentry monitoring wrapper (lib/monitoring.ts).
 *
 * The two behaviors that matter and that we can actually break by accident:
 *   1. Without VITE_SENTRY_DSN, nothing is sent anywhere — the app must keep
 *      working (console-only) so a missing env var can never crash bootstrap.
 *   2. With a DSN, reportError reaches captureException with its structured
 *      context, and the console mirror still happens (today's visibility).
 *
 * vi.resetModules() + dynamic import per test keeps the module-level
 * `initialized` flag from leaking between cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captureException = vi.fn();
const sentryInit = vi.fn();
const setUser = vi.fn();

vi.mock('@sentry/react', () => ({
  init: sentryInit,
  captureException,
  setUser,
}));

async function loadModule() {
  return await import('@/lib/monitoring');
}

describe('lib/monitoring', () => {
  beforeEach(() => {
    vi.resetModules();
    captureException.mockClear();
    sentryInit.mockClear();
    setUser.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is a safe no-op when VITE_SENTRY_DSN is not set', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const monitoring = await loadModule();

    expect(() => monitoring.initMonitoring()).not.toThrow();
    expect(sentryInit).not.toHaveBeenCalled();

    // reportError still mirrors to console and never throws or sends.
    const err = new Error('boom');
    expect(() => monitoring.reportError(err, { where: 'test' })).not.toThrow();
    expect(console.error).toHaveBeenCalledWith('[monitoring]', err, { where: 'test' });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('initializes Sentry once when a DSN is configured', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://examplePublicKey@o0.ingest.sentry.io/1234');
    const monitoring = await loadModule();

    monitoring.initMonitoring();
    expect(sentryInit).toHaveBeenCalledTimes(1);
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://examplePublicKey@o0.ingest.sentry.io/1234',
        tracesSampleRate: 0,
      }),
    );

    // Second call must be a no-op (no duplicate clients).
    monitoring.initMonitoring();
    expect(sentryInit).toHaveBeenCalledTimes(1);
  });

  it('forwards reportError to captureException with structured context after init', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://examplePublicKey@o0.ingest.sentry.io/1234');
    const monitoring = await loadModule();
    monitoring.initMonitoring();

    const err = new Error('submit failed');
    monitoring.reportError(err, { where: 'submit-reading', plantId: 'p1' });

    expect(captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ extra: { where: 'submit-reading', plantId: 'p1' } }),
    );
    // Console mirror still happens — grep-able in DevTools with monitoring on.
    expect(console.error).toHaveBeenCalledWith('[monitoring]', err, {
      where: 'submit-reading',
      plantId: 'p1',
    });
  });

  it('setMonitoringUser is a no-op before init and clears with undefined after init', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://examplePublicKey@o0.ingest.sentry.io/1234');
    const monitoring = await loadModule();

    // Before init: must not throw and must not touch Sentry.
    expect(() => monitoring.setMonitoringUser({ id: 'u1' })).not.toThrow();
    expect(setUser).not.toHaveBeenCalled();

    monitoring.initMonitoring();
    monitoring.setMonitoringUser({ id: 'u1', role: 'Manager' });
    expect(setUser).toHaveBeenLastCalledWith({ id: 'u1', role: 'Manager' });

    monitoring.setMonitoringUser(undefined);
    expect(setUser).toHaveBeenLastCalledWith(null);
  });

  it('treats a whitespace-only DSN as unset', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '   ');
    const monitoring = await loadModule();

    monitoring.initMonitoring();
    expect(sentryInit).not.toHaveBeenCalled();
  });
});
