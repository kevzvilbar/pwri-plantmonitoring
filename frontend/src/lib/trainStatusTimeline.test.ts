import { describe, it, expect } from 'vitest';
import {
  buildStatusTimeline, nonRunningSegmentsInRange, mergeSegmentsForDisplay, formatSegmentDuration,
  reconcileOngoingSegmentWithReadings, flagConflictingClosedSegments, dropBogusOpenAutoFlag,
  preserveAutoFlagReason,
} from './trainStatusTimeline';

describe('buildStatusTimeline', () => {
  it('turns ordered rows into segments where each row closes the previous one', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-26T05:10:00Z', reason: 'Operator Shutdown' },
      { status: 'Running', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
    ]);
    expect(segments).toEqual([
      { status: 'Offline', startAt: '2026-08-26T05:10:00Z', endAt: '2026-08-26T08:42:00Z', reason: 'Operator Shutdown' },
      { status: 'Running', startAt: '2026-08-26T08:42:00Z', endAt: null, reason: null },
    ]);
  });

  it('sorts unordered input before reconstructing', () => {
    const segments = buildStatusTimeline([
      { status: 'Running', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
      { status: 'Offline', confirmed_at: '2026-08-26T05:10:00Z', reason: 'Operator Shutdown' },
    ]);
    expect(segments[0].status).toBe('Offline');
    expect(segments[1].status).toBe('Running');
  });

  it('the last row is ongoing (endAt null)', () => {
    const segments = buildStatusTimeline([
      { status: 'Maintenance', confirmed_at: '2026-08-26T05:10:00Z', reason: null },
    ]);
    expect(segments[0].endAt).toBeNull();
  });

  it('falls back unrecognized status strings to Running rather than dropping the row', () => {
    const segments = buildStatusTimeline([
      { status: 'Decommissioned', confirmed_at: '2026-08-26T05:10:00Z', reason: null },
    ]);
    expect(segments[0].status).toBe('Running');
  });
});

describe('nonRunningSegmentsInRange', () => {
  const segments = buildStatusTimeline([
    { status: 'Offline', confirmed_at: '2026-08-26T05:10:00Z', reason: 'Operator Shutdown' },
    { status: 'Running', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
    { status: 'Maintenance', confirmed_at: '2026-08-27T10:00:00Z', reason: 'Scheduled' },
    { status: 'Running', confirmed_at: '2026-08-27T14:00:00Z', reason: null },
  ]);

  it('excludes Running segments entirely', () => {
    const result = nonRunningSegmentsInRange(segments, '2026-08-26T00:00:00Z', '2026-08-28T00:00:00Z');
    expect(result.every((s) => s.status !== 'Running')).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('excludes segments entirely outside the range', () => {
    const result = nonRunningSegmentsInRange(segments, '2026-08-26T00:00:00Z', '2026-08-27T00:00:00Z');
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('Operator Shutdown');
  });

  it('includes a segment that only partially overlaps the range', () => {
    // range starts mid-shutdown (06:00), shutdown itself started 05:10
    const result = nonRunningSegmentsInRange(segments, '2026-08-26T06:00:00Z', '2026-08-26T07:00:00Z');
    expect(result).toHaveLength(1);
  });

  it('treats an ongoing (endAt null) segment as extending to now', () => {
    const ongoing = buildStatusTimeline([
      { status: 'Offline', confirmed_at: new Date(Date.now() - 60_000).toISOString(), reason: null },
    ]);
    const result = nonRunningSegmentsInRange(ongoing, new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString());
    expect(result).toHaveLength(1);
  });
});

describe('mergeSegmentsForDisplay', () => {
  const readings = [
    { id: 'r1', reading_datetime: '2026-08-26T09:03:00Z' },
    { id: 'r2', reading_datetime: '2026-08-26T04:23:00Z' },
  ];
  const fullTimeline = buildStatusTimeline([
    { status: 'Offline', confirmed_at: '2026-08-26T05:10:00Z', reason: 'Operator Shutdown' },
    { status: 'Running', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
  ]);

  it('places a banner between the readings that bracket it, newest-first', () => {
    const nonRunning = fullTimeline.filter((s) => s.status !== 'Running');
    const merged = mergeSegmentsForDisplay(readings, nonRunning, (r) => r.reading_datetime);
    expect(merged.map((m) => (m.kind === 'banner' ? 'banner' : m.row.id))).toEqual(['r1', 'banner', 'r2']);
  });

  it('never renders a Running segment as a banner, even if the caller forgot to pre-filter', () => {
    const merged = mergeSegmentsForDisplay(readings, fullTimeline, (r) => r.reading_datetime);
    expect(merged.filter((m) => m.kind === 'banner')).toHaveLength(1);
    expect(merged.map((m) => (m.kind === 'banner' ? 'banner' : m.row.id))).toEqual(['r1', 'banner', 'r2']);
  });

  it('an empty segment list is a no-op', () => {
    const merged = mergeSegmentsForDisplay([readings[0]], [], (r) => r.reading_datetime);
    expect(merged).toEqual([{ kind: 'reading', row: readings[0] }]);
  });

  it('places a restart reading at banner endAt ABOVE the banner in descending order', () => {
    // A reading at 20:38 taken when the train resumed operation should come next
    // after the offline period chronologically, meaning above the banner in descending list.
    const offlineSegment = {
      status: 'Offline' as const,
      startAt: '2026-09-11T18:38:00Z',
      endAt: '2026-09-11T20:38:00Z',
      reason: 'Power Outage',
    };
    const testReadings = [
      { id: 'restart-reading', reading_datetime: '2026-09-11T20:38:00Z' },
      { id: 'prior-reading', reading_datetime: '2026-09-11T17:02:00Z' },
    ];
    const merged = mergeSegmentsForDisplay(testReadings, [offlineSegment], (r) => r.reading_datetime);
    expect(merged.map((m) => (m.kind === 'banner' ? 'banner' : m.row.id))).toEqual([
      'restart-reading',
      'banner',
      'prior-reading',
    ]);
  });

  it('places a reading at banner startAt BELOW the banner in descending order', () => {
    const offlineSegment = {
      status: 'Offline' as const,
      startAt: '2026-09-11T18:38:00Z',
      endAt: '2026-09-11T20:38:00Z',
      reason: 'Power Outage',
    };
    const testReadings = [
      { id: 'shutdown-reading', reading_datetime: '2026-09-11T18:38:00Z' },
    ];
    const merged = mergeSegmentsForDisplay(testReadings, [offlineSegment], (r) => r.reading_datetime);
    expect(merged.map((m) => (m.kind === 'banner' ? 'banner' : m.row.id))).toEqual([
      'banner',
      'shutdown-reading',
    ]);
  });
});

describe('formatSegmentDuration', () => {
  it('formats hours and minutes together', () => {
    expect(formatSegmentDuration('2026-08-26T05:10:00Z', '2026-08-26T08:42:00Z')).toBe('3h 32m');
  });
  it('omits minutes when exactly on the hour', () => {
    expect(formatSegmentDuration('2026-08-26T05:00:00Z', '2026-08-26T08:00:00Z')).toBe('3h');
  });
  it('omits hours when under one', () => {
    expect(formatSegmentDuration('2026-08-26T05:00:00Z', '2026-08-26T05:45:00Z')).toBe('45m');
  });
});

describe('reconcileOngoingSegmentWithReadings', () => {
  it('clips an ongoing Offline segment to a later reading, marking it inferred', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-28T02:50:00Z', reason: 'Auto-flagged: no reading for 2.1h' },
    ]);
    const result = reconcileOngoingSegmentWithReadings(segments, '2026-08-29T07:33:00Z');
    expect(result).toEqual([
      { status: 'Offline', startAt: '2026-08-28T02:50:00Z', endAt: '2026-08-29T07:33:00Z', reason: 'Auto-flagged: no reading for 2.1h', inferredEnd: true },
    ]);
  });

  it('leaves an already-closed segment alone — only the ongoing one is ever a candidate', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-26T05:10:00Z', reason: 'Operator Shutdown' },
      { status: 'Running', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
    ]);
    const result = reconcileOngoingSegmentWithReadings(segments, '2026-08-27T00:00:00Z');
    expect(result).toEqual(segments);
  });

  it('leaves an ongoing Running segment alone — nothing to reconcile', () => {
    const segments = buildStatusTimeline([
      { status: 'Running', confirmed_at: '2026-08-26T05:10:00Z', reason: null },
    ]);
    const result = reconcileOngoingSegmentWithReadings(segments, '2026-08-27T00:00:00Z');
    expect(result).toEqual(segments);
  });

  it('does not clip when the latest reading is before the segment even started', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-28T02:50:00Z', reason: null },
    ]);
    const result = reconcileOngoingSegmentWithReadings(segments, '2026-08-28T01:00:00Z');
    expect(result[0].endAt).toBeNull();
    expect(result[0].inferredEnd).toBeUndefined();
  });

  it('is a no-op with no readings at all', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-28T02:50:00Z', reason: null },
    ]);
    const result = reconcileOngoingSegmentWithReadings(segments, null);
    expect(result).toEqual(segments);
  });

  it('is a no-op on an empty timeline', () => {
    expect(reconcileOngoingSegmentWithReadings([], '2026-08-28T02:50:00Z')).toEqual([]);
  });
});

describe('dropBogusOpenAutoFlag', () => {
  // Regression for Train 7 / RO7, 2026-09-12: a device with a drifted clock
  // wrote "Auto-flagged: no reading for >24h" at 14:03, only 59 minutes after
  // the 13:04 production reading. reconcileOngoingSegmentWithReadings can't
  // touch this (the reading is BEFORE the flag start, not after), so the
  // bogus "Offline — ongoing" banner sat at the top of the Operator Log.
  it('drops an open Auto-flagged Offline flag when a production reading existed within the 2h threshold before its start', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-09-12T14:03:00Z', reason: 'Auto-flagged: no reading for >24h' },
    ]);
    // Newest production reading is 59 min before the flag start — well inside
    // the 2h auto-offline threshold, so the flag violated its own rule.
    const result = dropBogusOpenAutoFlag(segments, ['2026-09-12T13:04:00Z']);
    expect(result).toEqual([]);
  });

  it('keeps an open Auto-flagged Offline flag when the last production reading is older than the threshold', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-09-12T14:03:00Z', reason: 'Auto-flagged: no reading for 2.3h' },
    ]);
    // Last reading 3h before the flag start → the flag is legitimate.
    const result = dropBogusOpenAutoFlag(segments, ['2026-09-12T11:03:00Z']);
    expect(result).toEqual(segments);
  });

  it('never touches a closed segment, even a bogus-looking auto-flag', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-09-12T14:03:00Z', reason: 'Auto-flagged: no reading for >24h' },
      { status: 'Running', confirmed_at: '2026-09-12T15:00:00Z', reason: null },
    ]);
    const result = dropBogusOpenAutoFlag(segments, ['2026-09-12T13:04:00Z']);
    expect(result).toEqual(segments); // closed segments are annotation-only territory
  });

  it('never touches an operator/manual Offline flag (reason not Auto-flagged)', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-09-12T14:03:00Z', reason: 'Operator Shutdown' },
    ]);
    const result = dropBogusOpenAutoFlag(segments, ['2026-09-12T13:58:00Z']);
    expect(result).toEqual(segments);
  });

  it('keeps the flag when there are no production readings at all', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-09-12T14:03:00Z', reason: 'Auto-flagged: no reading for >24h' },
    ]);
    expect(dropBogusOpenAutoFlag(segments, [])).toEqual(segments);
    expect(dropBogusOpenAutoFlag(segments, [null, undefined])).toEqual(segments);
  });

  it('ignores production readings that fall AFTER the flag start (reconcile handles those)', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-09-12T14:03:00Z', reason: 'Auto-flagged: no reading for >24h' },
    ]);
    const result = dropBogusOpenAutoFlag(segments, ['2026-09-12T14:30:00Z']);
    expect(result).toEqual(segments);
  });

  it('never touches an open Running segment', () => {
    const segments = buildStatusTimeline([
      { status: 'Running', confirmed_at: '2026-09-12T14:03:00Z', reason: null },
    ]);
    const result = dropBogusOpenAutoFlag(segments, ['2026-09-12T13:04:00Z']);
    expect(result).toEqual(segments);
  });
});

describe('flagConflictingClosedSegments', () => {
  it('flags a closed segment when a reading timestamp falls inside it', () => {
    // Mirrors the RO2 Aug 28 02:57 -> 22:39 case: a confirmed close, but a
    // reading (e.g. CSV-backfilled) landed inside the window anyway.
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-28T02:57:00Z', reason: 'Auto-flagged: no reading for 2.0h' },
      { status: 'Running', confirmed_at: '2026-08-28T22:39:00Z', reason: null },
    ]);
    const [result] = flagConflictingClosedSegments(segments, ['2026-08-28T20:39:00Z']);
    expect(result.hasConflictingReadings).toBe(true);
    // Boundaries stay exactly as recorded — this is annotation, not clipping.
    expect(result.endAt).toBe('2026-08-28T22:39:00Z');
  });

  it('does not flag a closed segment when no reading falls inside it', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-26T05:10:00Z', reason: 'Operator Shutdown' },
      { status: 'Running', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
    ]);
    const [result] = flagConflictingClosedSegments(segments, ['2026-08-26T09:00:00Z', '2026-08-26T04:00:00Z']);
    expect(result.hasConflictingReadings).toBeUndefined();
  });

  it('ignores readings exactly at the segment boundary', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-26T05:10:00Z', reason: null },
      { status: 'Running', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
    ]);
    const [result] = flagConflictingClosedSegments(segments, ['2026-08-26T05:10:00Z', '2026-08-26T08:42:00Z']);
    expect(result.hasConflictingReadings).toBeUndefined();
  });

  it('never flags an ongoing segment (endAt null) — that is reconcileOngoingSegmentWithReadings\' job', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-28T02:50:00Z', reason: null },
    ]);
    const result = flagConflictingClosedSegments(segments, ['2026-08-28T23:45:00Z']);
    expect(result[0].hasConflictingReadings).toBeUndefined();
  });

  it('never flags a Running segment', () => {
    const segments = buildStatusTimeline([
      { status: 'Running', confirmed_at: '2026-08-26T05:10:00Z', reason: null },
      { status: 'Offline', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
    ]);
    const result = flagConflictingClosedSegments(segments, ['2026-08-26T06:00:00Z']);
    expect(result[0].hasConflictingReadings).toBeUndefined();
  });

  it('is a no-op when there are no readings at all', () => {
    const segments = buildStatusTimeline([
      { status: 'Offline', confirmed_at: '2026-08-26T05:10:00Z', reason: null },
      { status: 'Running', confirmed_at: '2026-08-26T08:42:00Z', reason: null },
    ]);
    expect(flagConflictingClosedSegments(segments, [])).toEqual(segments);
  });
});

describe('preserveAutoFlagReason', () => {
  it('lets an operator-supplied reason win even over an existing Auto-flagged marker', () => {
    expect(preserveAutoFlagReason('Auto-flagged: no reading for 2.3h', 'Pump tripped')).toBe('Pump tripped');
  });

  it('keeps an existing Auto-flagged marker when the operator leaves the reason blank', () => {
    // This is the case that used to silently erase the marker: an operator
    // just resumes logging without picking a manual offline reason.
    expect(preserveAutoFlagReason('Auto-flagged: no reading for 2.3h', null)).toBe('Auto-flagged: no reading for 2.3h');
  });

  it('still writes null when there was no existing reason at all', () => {
    expect(preserveAutoFlagReason(null, null)).toBeNull();
    expect(preserveAutoFlagReason(undefined, null)).toBeNull();
  });

  it('does not preserve a non-Auto-flagged existing reason — unchanged behavior for manual rows', () => {
    expect(preserveAutoFlagReason('Scheduled maintenance', null)).toBeNull();
  });

  it('an operator reason always overrides, regardless of what existed before', () => {
    expect(preserveAutoFlagReason(null, 'Power outage')).toBe('Power outage');
    expect(preserveAutoFlagReason('Scheduled maintenance', 'Power outage')).toBe('Power outage');
  });
});
