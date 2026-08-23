/**
 * hourlyReadingGuard.ts
 *
 * "One reading per clock hour" rule for RO Train and Pre-Treatment logging.
 *
 * PretreatmentAndROLog.tsx previously had a 1-hour-per-train duplicate rule
 * that was deliberately removed ("operators may log multiple readings per
 * hour"). Per plant policy this restores it, but bucketed rather than
 * rolling: exactly one reading is allowed per train per calendar hour — one
 * entry somewhere in 6:00–6:59, another in 7:00–7:59, and so on — no matter
 * what minute within the hour it's actually keyed in at. A rolling
 * "must be 60+ minutes since the last one" rule would let an operator drift
 * (6:55, then 7:54, then 8:53, …) until two readings land in the same clock
 * hour anyway; fixed buckets don't drift.
 *
 * Pure bucket math lives here so it's unit-testable without a DB. The actual
 * existence check is left to the caller (PretreatmentAndROLog.tsx) since it
 * needs a live Supabase client and runs against two different tables
 * (ro_train_readings, ro_pretreatment_readings).
 */

export interface HourBucket {
  /** Inclusive lower bound, UTC ISO string — pass to .gte(). */
  startISO: string;
  /** Exclusive upper bound, UTC ISO string — pass to .lt(). */
  endISO: string;
  /** Human label for error messages, e.g. "6:00–6:59". */
  label: string;
}

/**
 * Computes the [start, end) hour window containing `localDt`.
 *
 * `localDt` is expected in `datetime-local` input format
 * ("yyyy-MM-ddTHH:mm", no seconds or timezone offset) — exactly the string
 * PretreatmentAndROLog.tsx's `dt` state holds and later feeds through
 * `new Date(dt).toISOString()` when it writes reading_datetime. Bucketing
 * from that same local string (rather than from an already-UTC-converted
 * value) keeps the window aligned with the wall-clock hour the operator
 * actually sees on screen, and stays consistent with how the reading itself
 * gets saved.
 */
export function getHourBucket(localDt: string): HourBucket {
  const hourStart = new Date(`${localDt.slice(0, 13)}:00`);
  const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
  const h = hourStart.getHours();
  return {
    startISO: hourStart.toISOString(),
    endISO: hourEnd.toISOString(),
    label: `${h}:00–${h}:59`,
  };
}
