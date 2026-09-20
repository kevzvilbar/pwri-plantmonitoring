/**
 * Freshness helpers for human-readable "last updated" labels.
 *
 * Thresholds (confirmed against RO-train logging cadence):
 *   fresh  — under 90 minutes  → green lamp, pulsing
 *   aging  — 90 min to 4 hours → amber lamp, static
 *   stale  — beyond 4 hours    → red/muted lamp, static
 *   unknown — null timestamp   → muted lamp, "No recent readings"
 *
 * The function is pure (no React, no Date.now() side-effects) so it is
 * trivially testable. Pass `now` explicitly in tests to avoid flakiness.
 */

export type FreshnessTone = 'fresh' | 'aging' | 'stale' | 'unknown';

export interface FreshnessResult {
  /** Human-readable display string, e.g. "Updated 2 h ago" */
  label: string;
  tone: FreshnessTone;
}

/** 90 minutes expressed in milliseconds */
const FRESH_MS = 90 * 60 * 1_000;
/** 4 hours expressed in milliseconds */
const AGING_MS = 4 * 60 * 60 * 1_000;

/**
 * Produce a `{ label, tone }` pair for a timestamp.
 *
 * @param ts  - The timestamp of the latest known reading, or `null` / `undefined` when unknown.
 * @param now - Current epoch milliseconds. Defaults to `Date.now()`. Override in tests.
 */
export function describeFreshness(
  ts: Date | null | undefined,
  now = Date.now(),
): FreshnessResult {
  if (!ts) {
    return { label: 'No recent readings', tone: 'unknown' };
  }

  const ageMs = Math.max(0, now - ts.getTime()); // clamp clock skew to 0

  if (ageMs < FRESH_MS) {
    const label = formatAge(ageMs);
    return { label: `Updated ${label}`, tone: 'fresh' };
  }

  if (ageMs < AGING_MS) {
    const label = formatAge(ageMs);
    return { label: `Updated ${label}`, tone: 'aging' };
  }

  const label = formatAge(ageMs);
  return { label: `Updated ${label}`, tone: 'stale' };
}

/** Format a duration in ms into "X min ago" or "X h ago". */
function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return minutes <= 1 ? '1 min ago' : `${minutes} min ago`;
  }
  const hours = Math.floor(ms / 3_600_000);
  return hours === 1 ? '1 h ago' : `${hours} h ago`;
}

