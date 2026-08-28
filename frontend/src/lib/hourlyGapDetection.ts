/**
 * lib/hourlyGapDetection.ts
 *
 * Flags stretches of consecutive missing hourly readings for an RO Train /
 * Pre-Treatment log, so the operator gets asked why — the hourly-cadence
 * counterpart to the existing daily reading_gap_reasons/TrainCard pattern.
 *
 * Deliberately a separate file from lib/gapDetection.ts, which is a
 * same-named-sounding but unrelated concern: that one builds day-grained
 * interpolated pseudo-rows for DataAnalysis.tsx's regression correction
 * feature. This one never fabricates a reading — it only ever decides
 * whether an hour *should* have had one and didn't.
 *
 * Shares getHourBucket with hourlyReadingGuard.ts (the save-time "one
 * reading per hour" guard) on purpose: both need the exact same definition
 * of "which hour does this timestamp belong to", and calling the same
 * function is the only way to guarantee they can't drift apart later.
 */

import { getHourBucket, type HourBucket } from './hourlyReadingGuard';
import type { StatusSegment, DisplayItem } from './trainStatusTimeline';

export interface FlaggedGap {
  /** ISO start of the first missing hour bucket in this span. */
  gapStartAt: string;
  /** ISO end of the last missing hour bucket in this span (exclusive). */
  gapEndAt: string;
  missedHours: number;
}

/** HH:59 + 30min = HH+1:29, i.e. 89 minutes after the bucket opens. */
const GRACE_MINUTES_PAST_HOUR_END = 89;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "yyyy-MM-ddTHH:00" in local time — the format getHourBucket expects. */
function toLocalHourString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:00`;
}

/**
 * Every hour bucket from the hour containing `rangeStart` up to (excluding)
 * `rangeEndExclusive`, walked in local wall-clock time — same convention
 * getHourBucket itself uses, so a bucket built here and one built at
 * save-time for the same reading always agree.
 */
function enumerateHourBuckets(rangeStart: Date, rangeEndExclusive: Date): HourBucket[] {
  const buckets: HourBucket[] = [];
  let cursor = new Date(
    rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate(), rangeStart.getHours(), 0, 0, 0,
  );
  while (cursor < rangeEndExclusive) {
    buckets.push(getHourBucket(toLocalHourString(cursor)));
    cursor = new Date(cursor.getTime() + 3_600_000);
  }
  return buckets;
}

/**
 * @param readingTimestamps  reading_datetime values for this train/tab, any order.
 * @param statusTimeline     the train's FULL status timeline (all statuses,
 *   not pre-filtered) — this function does its own Running/non-Running
 *   split, matching the defensive pattern in trainStatusTimeline.ts's
 *   mergeSegmentsForDisplay.
 * @param rangeStart          inclusive lower bound of the scan window.
 * @param rangeEnd             upper bound of the scan window — will be
 *   clamped to `now` internally, since a future hour can't be "missing" yet.
 * @param now                current time; overridable for tests.
 */
export function detectHourlyGaps(params: {
  readingTimestamps: (string | null | undefined)[];
  statusTimeline: StatusSegment[];
  rangeStart: Date;
  rangeEnd: Date;
  now?: Date;
}): FlaggedGap[] {
  const { readingTimestamps, statusTimeline, rangeStart, rangeEnd, now = new Date() } = params;

  const nonRunning = statusTimeline.filter((s) => s.status !== 'Running');

  const bucketsWithReadings = new Set<string>();
  for (const ts of readingTimestamps) {
    if (!ts) continue;
    bucketsWithReadings.add(getHourBucket(toLocalHourString(new Date(ts))).startISO);
  }

  const scanEnd = rangeEnd.getTime() < now.getTime() ? rangeEnd : now;
  const missing: HourBucket[] = [];

  for (const bucket of enumerateHourBuckets(rangeStart, scanEnd)) {
    const bucketStartMs = new Date(bucket.startISO).getTime();
    const eligibleAtMs = bucketStartMs + GRACE_MINUTES_PAST_HOUR_END * 60_000;
    if (now.getTime() < eligibleAtMs) continue; // grace period hasn't elapsed yet
    if (bucketsWithReadings.has(bucket.startISO)) continue; // a reading exists in this bucket

    const bucketEndMs = new Date(bucket.endISO).getTime();
    const explainedByShutdown = nonRunning.some((s) => {
      const segStartMs = new Date(s.startAt).getTime();
      const segEndMs = s.endAt ? new Date(s.endAt).getTime() : now.getTime();
      return segStartMs < bucketEndMs && segEndMs > bucketStartMs; // any overlap at all
    });
    if (explainedByShutdown) continue;

    missing.push(bucket);
  }

  // missing is already in chronological order (enumerateHourBuckets walks
  // forward), so adjacent missing buckets can be merged in a single pass.
  const gaps: FlaggedGap[] = [];
  for (const bucket of missing) {
    const last = gaps[gaps.length - 1];
    if (last && last.gapEndAt === bucket.startISO) {
      last.gapEndAt = bucket.endISO;
      last.missedHours += 1;
    } else {
      gaps.push({ gapStartAt: bucket.startISO, gapEndAt: bucket.endISO, missedHours: 1 });
    }
  }
  return gaps;
}

export interface GapReason {
  reasonCategory: string;
  reasonDetail: string | null;
}

export type DisplayItemWithGaps<T> =
  | DisplayItem<T>
  | { kind: 'gap'; gap: FlaggedGap; existingReason: GapReason | null };

/**
 * Layers gap badges onto a list that's already been through
 * trainStatusTimeline.ts's mergeSegmentsForDisplay (readings + shutdown
 * banners). Kept as a second pass rather than folded into one combined
 * function so trainStatusTimeline.ts's own tests didn't need to grow a
 * third, unrelated concept (gap resolution state) to stay green — banners
 * and gap badges are populated from genuinely different queries
 * (train_status_log vs ro_train_data_gaps) and have different lifecycles
 * (a banner is just a fact; a gap badge is either unresolved or carries a
 * logged reason).
 */
export function mergeGapsForDisplay<T>(
  items: DisplayItem<T>[],
  gaps: FlaggedGap[],
  existingReasons: Map<string, GapReason>,
  getTimestamp: (row: T) => string | null | undefined,
): DisplayItemWithGaps<T>[] {
  const gapItems: DisplayItemWithGaps<T>[] = gaps.map((gap) => ({
    kind: 'gap', gap, existingReason: existingReasons.get(gap.gapStartAt) ?? null,
  }));
  const merged: DisplayItemWithGaps<T>[] = [...items, ...gapItems];
  return merged.sort((a, b) => {
    const aAt = a.kind === 'banner' ? (a.segment.endAt ?? new Date().toISOString())
      : a.kind === 'gap' ? a.gap.gapEndAt
      : getTimestamp(a.row);
    const bAt = b.kind === 'banner' ? (b.segment.endAt ?? new Date().toISOString())
      : b.kind === 'gap' ? b.gap.gapEndAt
      : getTimestamp(b.row);
    return new Date(bAt ?? 0).getTime() - new Date(aAt ?? 0).getTime();
  });
}
