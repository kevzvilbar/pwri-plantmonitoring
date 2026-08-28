/**
 * lib/trainStatusTimeline.ts
 *
 * Reconstructs an RO train's Running / Offline / Maintenance timeline from
 * ordered train_status_log rows, and merges the non-Running stretches into a
 * reading list as banner rows for TrainLogModal.tsx.
 *
 * Written as three small pure functions rather than one — each stage
 * (segment reconstruction, range filtering, list merge) is independently
 * unit-testable without a DB or a component, matching hourlyReadingGuard.ts
 * / gapDetection.ts's split in this same codebase.
 *
 * train_status_log only ever gets a new row on an actual transition (see the
 * guards in PretreatmentAndROLog.tsx and TrainsList.tsx), so between two
 * consecutive rows the train's status holds at the earlier row's value —
 * that's the whole reconstruction: each row opens a segment that the next
 * row closes.
 */

export type TrainRunStatus = 'Running' | 'Offline' | 'Maintenance';

export interface TrainStatusRow {
  status: string;
  confirmed_at: string;
  reason: string | null;
}

export interface StatusSegment {
  status: TrainRunStatus;
  /** ISO timestamp this segment started. */
  startAt: string;
  /** ISO timestamp the next row supersedes this one, or null if it's the train's current status (no later row). */
  endAt: string | null;
  reason: string | null;
}

/**
 * rows need not be pre-sorted — sorted here so callers can pass a raw
 * Supabase result straight through. Unrecognized status strings fall back
 * to 'Running' rather than being dropped, so a bad/legacy row can't hide a
 * later Offline/Maintenance segment that closes it.
 */
export function buildStatusTimeline(rows: TrainStatusRow[]): StatusSegment[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.confirmed_at).getTime() - new Date(b.confirmed_at).getTime(),
  );
  return sorted.map((row, i) => ({
    status: (row.status === 'Offline' || row.status === 'Maintenance') ? row.status : 'Running',
    startAt: row.confirmed_at,
    endAt: sorted[i + 1]?.confirmed_at ?? null,
    reason: row.reason ?? null,
  }));
}

/**
 * Non-Running segments overlapping [rangeStart, rangeEnd) — the set that
 * should render as banners for a given visible date range. An ongoing
 * segment (endAt === null) is treated as extending to "now" for the overlap
 * check, since the train really is still Offline/Maintenance right now.
 */
export function nonRunningSegmentsInRange(
  segments: StatusSegment[],
  rangeStart: string,
  rangeEnd: string,
): StatusSegment[] {
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  return segments.filter((s) => {
    if (s.status === 'Running') return false;
    const segStartMs = new Date(s.startAt).getTime();
    const segEndMs = s.endAt ? new Date(s.endAt).getTime() : Date.now();
    return segStartMs < endMs && segEndMs > startMs;
  });
}

export type DisplayItem<T> =
  | { kind: 'reading'; row: T }
  | { kind: 'banner'; segment: StatusSegment };

/**
 * Interleaves banner segments into a reading list, both ending up sorted
 * newest-first — matching how TrainLogModal already orders and paginates
 * `logs`/`preLogs`. A banner sorts by its end time (or "now" if still
 * ongoing) so it lands exactly where a reading taken at that moment would:
 * everything above it in the list is newer than the shutdown ended,
 * everything below is older than it started.
 *
 * `readings` is expected pre-sorted descending by `getTimestamp` (as
 * TrainLogModal's queries already return); this only needs to place the
 * (typically far fewer) banners into that existing order.
 */
export function mergeSegmentsForDisplay<T>(
  readings: T[],
  segments: StatusSegment[],
  getTimestamp: (row: T) => string | null | undefined,
): DisplayItem<T>[] {
  // Defensive, not just a convenience: a caller that forgets to run
  // nonRunningSegmentsInRange first would otherwise render a "Running"
  // banner, which makes no sense as a display concept — Running is the
  // absence of a banner, not a kind of one.
  const items: DisplayItem<T>[] = [
    ...segments.filter((s) => s.status !== 'Running').map((segment): DisplayItem<T> => ({ kind: 'banner', segment })),
    ...readings.map((row): DisplayItem<T> => ({ kind: 'reading', row })),
  ];
  return items.sort((a, b) => {
    const aAt = a.kind === 'banner' ? (a.segment.endAt ?? new Date().toISOString()) : getTimestamp(a.row);
    const bAt = b.kind === 'banner' ? (b.segment.endAt ?? new Date().toISOString()) : getTimestamp(b.row);
    return new Date(bAt ?? 0).getTime() - new Date(aAt ?? 0).getTime();
  });
}

/** "3h 32m" / "3h" / "45m" — for the banner's duration label. Ongoing segments measure against now. */
export function formatSegmentDuration(startAt: string, endAt: string | null): string {
  const startMs = new Date(startAt).getTime();
  const endMs = endAt ? new Date(endAt).getTime() : Date.now();
  const totalMin = Math.max(0, Math.round((endMs - startMs) / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
