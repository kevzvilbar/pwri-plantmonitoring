/**
 * apiHealth.ts — backend outage handling (FREE-PLAN-BUDGET-PLAN.md, Phase 6).
 *
 * WHY: on 2026-10-04 06:25–06:35 PHT the database restarted. Edge logs show ~675
 * HTTP 503s in 10 minutes and single browsers sending 340–410 requests/minute:
 * every failed query was retried (retry: 1, no delay), every realtime/background
 * refetch fired again, and each attempt cost a log row plus a CORS preflight row.
 * An outage should cost LESS quota than normal use, not several times more.
 *
 * Three pieces, all client-side:
 *  1. isTransientBackendError() — separates "server is down" from "this query is
 *     wrong" (400/42703 etc.). Wrong queries are never retried.
 *  2. queryRetry / queryRetryDelay — at most 2 retries, exponential backoff + jitter,
 *     and none at all while the breaker is open.
 *  3. A circuit breaker fed by supabaseFetch (lib/supabaseFetch.ts): after a burst
 *     of 5xx/network failures, REST reads are short-circuited locally (no network,
 *     no log row) for a cooldown that doubles on each failed probe, up to 5 min.
 *     Writes are never blocked.
 */

const WINDOW_MS = 20_000;
const TRIP_FAILURES = 8;
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 300_000;

let failures: number[] = [];
let openUntil = 0;
let trips = 0;
let probeInFlight = false;

type Listener = (open: boolean) => void;
const listeners = new Set<Listener>();
let lastNotified = false;

function notify(): void {
  const open = isBreakerOpen();
  if (open === lastNotified) return;
  lastNotified = open;
  listeners.forEach((l) => l(open));
}

export function subscribeBreaker(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while reads should not hit the network. */
export function isBreakerOpen(now: number = Date.now()): boolean {
  return now < openUntil;
}

/**
 * Called before a REST read. Returns 'allow' (normal), 'probe' (cooldown over:
 * let exactly one request through to test the backend) or 'block'.
 */
export function gateRead(now: number = Date.now()): 'allow' | 'probe' | 'block' {
  if (now < openUntil) return 'block';
  if (trips > 0) {
    // Half-open: single-flight probe.
    if (probeInFlight) return 'block';
    probeInFlight = true;
    return 'probe';
  }
  return 'allow';
}

export function recordBackendFailure(now: number = Date.now()): void {
  probeInFlight = false;
  failures = failures.filter((t) => now - t < WINDOW_MS);
  failures.push(now);
  if (trips > 0 || failures.length >= TRIP_FAILURES) {
    // A failed probe (trips > 0) or a fresh burst: (re)open with doubled cooldown.
    const cooldown = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** trips);
    trips += 1;
    openUntil = now + cooldown;
    failures = [];
  }
  notify();
  scheduleReopenNotice();
}

export function recordBackendSuccess(): void {
  probeInFlight = false;
  failures = [];
  if (trips !== 0 || openUntil !== 0) {
    trips = 0;
    openUntil = 0;
  }
  notify();
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReopenNotice(): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  const wait = Math.max(0, openUntil - Date.now()) + 5;
  noticeTimer = setTimeout(notify, wait);
}

/** Test helper. */
export function _resetApiHealth(): void {
  failures = [];
  openUntil = 0;
  trips = 0;
  probeInFlight = false;
  lastNotified = false;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  listeners.clear();
}

// ── error classification ────────────────────────────────────────────────────

const TRANSIENT_MESSAGE =
  /failed to fetch|networkerror|network request failed|load failed|timed? ?out|timeout|temporarily unavailable|service unavailable|bad gateway|gateway time-?out|schema cache|shutting down|upstream|circuit breaker|error code: ?5\d\d/i;

/** True when the failure says "the backend is unavailable", not "this request is wrong". */
export function isTransientBackendError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; message?: string; name?: string; status?: number };
  if (typeof e.status === 'number' && e.status >= 500) return true;
  if (typeof e.code === 'string' && /^PGRST00[0-3]$/.test(e.code)) return true;
  if (e.name === 'TypeError' && /fetch|network|load/i.test(e.message ?? '')) return true;
  return TRANSIENT_MESSAGE.test(e.message ?? '');
}

function isExpiredJwt(err: unknown): boolean {
  const e = err as { code?: string; status?: number } | null;
  return !!e && (e.code === 'PGRST301' || e.status === 401);
}

/** react-query `retry`: backend outages retry (bounded); everything else fails fast. */
export function queryRetry(failureCount: number, error: unknown): boolean {
  if (isBreakerOpen()) return false;
  if (isTransientBackendError(error)) return failureCount < 2;
  if (isExpiredJwt(error)) return failureCount < 1; // token refresh race
  return false; // 400/403/404/42703…: a retry cannot succeed, it only adds log rows
}

/** react-query `retryDelay`: 1s, 2s, 4s… capped at 30s, with ±50% jitter. */
export function backoffDelay(attempt: number, rand: () => number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.5 + rand()));
}

/** react-query passes (failureCount, error) — keep the signature exact. */
export function queryRetryDelay(attempt: number): number {
  return backoffDelay(attempt, Math.random);
}

