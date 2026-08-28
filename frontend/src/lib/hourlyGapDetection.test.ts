import { describe, it, expect } from 'vitest';
import { detectHourlyGaps, mergeGapsForDisplay, type FlaggedGap, type GapReason } from './hourlyGapDetection';
import { buildStatusTimeline, type DisplayItem } from './trainStatusTimeline';

// All fixture times below are local (no trailing Z), matching how
// getHourBucket itself interprets timestamps — matters for this test suite
// specifically, since the whole point is bucket-boundary math.
describe('detectHourlyGaps', () => {
  it('flags nothing when every hour has a reading', () => {
    const now = new Date('2026-08-26T12:00:00');
    const gaps = detectHourlyGaps({
      readingTimestamps: [
        '2026-08-26T09:05:00', '2026-08-26T10:02:00', '2026-08-26T11:00:00',
      ],
      statusTimeline: [],
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-26T12:00:00'),
      now,
    });
    expect(gaps).toEqual([]);
  });

  it('flags a single missing hour once the grace period has elapsed', () => {
    // 10:00 bucket is empty; "now" is 11:29, i.e. exactly at the grace boundary
    const now = new Date('2026-08-26T11:29:00');
    const gaps = detectHourlyGaps({
      readingTimestamps: ['2026-08-26T09:05:00'],
      statusTimeline: [],
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-26T12:00:00'),
      now,
    });
    expect(gaps).toEqual([
      { gapStartAt: new Date('2026-08-26T10:00:00').toISOString(), gapEndAt: new Date('2026-08-26T11:00:00').toISOString(), missedHours: 1 },
    ]);
  });

  it('does not flag a missing hour before the grace period elapses', () => {
    // Same missing 10:00 bucket, but "now" is one minute short of :29
    const now = new Date('2026-08-26T11:28:00');
    const gaps = detectHourlyGaps({
      readingTimestamps: ['2026-08-26T09:05:00'],
      statusTimeline: [],
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-26T12:00:00'),
      now,
    });
    expect(gaps).toEqual([]);
  });

  it('never flags a future hour, even if rangeEnd extends past now', () => {
    // now=10:30 is grace-eligible for the 09:00 bucket (needs 10:29) but not
    // yet for the 10:00 bucket (needs 11:29) — isolates "stops at now" from
    // the grace-period check itself, which the two tests above already cover.
    const now = new Date('2026-08-26T10:30:00');
    const gaps = detectHourlyGaps({
      readingTimestamps: [],
      statusTimeline: [],
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-27T00:00:00'), // rest of the day, still in the future
      now,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapStartAt).toBe(new Date('2026-08-26T09:00:00').toISOString());
  });

  it('merges consecutive missing hours into one span', () => {
    const now = new Date('2026-08-26T14:00:00');
    const gaps = detectHourlyGaps({
      readingTimestamps: ['2026-08-26T09:05:00', '2026-08-26T13:05:00'],
      statusTimeline: [],
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-26T14:00:00'),
      now,
    });
    expect(gaps).toEqual([
      { gapStartAt: new Date('2026-08-26T10:00:00').toISOString(), gapEndAt: new Date('2026-08-26T13:00:00').toISOString(), missedHours: 3 },
    ]);
  });

  it('keeps non-consecutive missing hours as separate spans', () => {
    const now = new Date('2026-08-26T14:00:00');
    const gaps = detectHourlyGaps({
      readingTimestamps: ['2026-08-26T09:05:00', '2026-08-26T11:05:00', '2026-08-26T13:05:00'],
      statusTimeline: [],
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-26T14:00:00'),
      now,
    });
    expect(gaps).toHaveLength(2);
    expect(gaps[0].missedHours).toBe(1);
    expect(gaps[1].missedHours).toBe(1);
  });

  it('does not flag hours covered by a shutdown window, even with no reading', () => {
    const now = new Date('2026-08-26T14:00:00');
    const statusTimeline = buildStatusTimeline([
      { status: 'Offline', confirmed_at: new Date('2026-08-26T10:10:00').toISOString(), reason: 'Operator Shutdown' },
      { status: 'Running', confirmed_at: new Date('2026-08-26T13:42:00').toISOString(), reason: null },
    ]);
    const gaps = detectHourlyGaps({
      readingTimestamps: ['2026-08-26T09:05:00'],
      statusTimeline,
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-26T14:00:00'),
      now,
    });
    // 10:00–13:00 buckets all overlap the Offline window and are excluded;
    // only a real, unexplained gap would show up here, and there isn't one.
    expect(gaps).toEqual([]);
  });

  it('resumes flagging once the shutdown ends but a later hour is still genuinely missing', () => {
    // now=14:35: the 13:00 bucket's grace has elapsed (needs 14:29) but the
    // 14:00 bucket's hasn't yet (needs 15:29) — isolates a single genuinely
    // missing hour rather than however many have accumulated by "now".
    const now = new Date('2026-08-26T14:35:00');
    const statusTimeline = buildStatusTimeline([
      { status: 'Offline', confirmed_at: new Date('2026-08-26T10:10:00').toISOString(), reason: 'Operator Shutdown' },
      { status: 'Running', confirmed_at: new Date('2026-08-26T11:42:00').toISOString(), reason: null },
    ]);
    const gaps = detectHourlyGaps({
      readingTimestamps: ['2026-08-26T09:05:00', '2026-08-26T12:05:00'],
      // 13:00–14:00 has no reading and isn't covered by any shutdown
      statusTimeline,
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-26T16:00:00'),
      now,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapStartAt).toBe(new Date('2026-08-26T13:00:00').toISOString());
    expect(gaps[0].missedHours).toBe(1);
  });

  it('an ongoing (still Offline) segment suppresses flagging up to now', () => {
    const now = new Date('2026-08-26T13:00:00');
    const statusTimeline = buildStatusTimeline([
      { status: 'Offline', confirmed_at: new Date('2026-08-26T10:10:00').toISOString(), reason: 'Operator Shutdown' },
    ]);
    const gaps = detectHourlyGaps({
      readingTimestamps: ['2026-08-26T09:05:00'],
      statusTimeline,
      rangeStart: new Date('2026-08-26T09:00:00'),
      rangeEnd: new Date('2026-08-26T13:00:00'),
      now,
    });
    expect(gaps).toEqual([]);
  });
});

describe('mergeGapsForDisplay', () => {
  const readingItems: DisplayItem<{ id: string; reading_datetime: string }>[] = [
    { kind: 'reading', row: { id: 'r1', reading_datetime: '2026-08-26T14:05:00Z' } },
    { kind: 'reading', row: { id: 'r2', reading_datetime: '2026-08-26T09:05:00Z' } },
  ];
  const gap: FlaggedGap = {
    gapStartAt: '2026-08-26T11:00:00Z', gapEndAt: '2026-08-26T13:00:00Z', missedHours: 2,
  };

  it('places the gap badge between the readings that bracket it', () => {
    const merged = mergeGapsForDisplay(readingItems, [gap], new Map(), (r) => r.reading_datetime);
    expect(merged.map((m) => (m.kind === 'gap' ? 'gap' : m.kind === 'banner' ? 'banner' : m.row.id)))
      .toEqual(['r1', 'gap', 'r2']);
  });

  it('attaches the logged reason when one exists for that gap', () => {
    const reasons = new Map<string, GapReason>([
      [gap.gapStartAt, { reasonCategory: 'pump_problem', reasonDetail: 'Impeller stuck' }],
    ]);
    const merged = mergeGapsForDisplay(readingItems, [gap], reasons, (r) => r.reading_datetime);
    const gapItem = merged.find((m) => m.kind === 'gap');
    expect(gapItem?.kind === 'gap' && gapItem.existingReason).toEqual({ reasonCategory: 'pump_problem', reasonDetail: 'Impeller stuck' });
  });

  it('leaves the gap unresolved when no matching reason row exists', () => {
    const merged = mergeGapsForDisplay(readingItems, [gap], new Map(), (r) => r.reading_datetime);
    const gapItem = merged.find((m) => m.kind === 'gap');
    expect(gapItem?.kind === 'gap' && gapItem.existingReason).toBeNull();
  });
});
