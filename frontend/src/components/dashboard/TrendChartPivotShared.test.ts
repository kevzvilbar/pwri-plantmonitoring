import { describe, it, expect } from 'vitest';
import { buildEntityPivot, fillDateRange, fmtDateKey } from './TrendChartPivotShared';

const iso = (d: string) => new Date(d + 'T08:00:00Z').toISOString();

describe('buildEntityPivot — stale daily_volume self-heal', () => {
  it(
    'reproduces and fixes the Coke/Parkmall Aug 7-10 bug: a downstream row\'s stored ' +
    'daily_volume/previous_reading goes stale once an earlier reading is edited/deleted, ' +
    'and must be recomputed live against the actual sequential predecessor instead',
    () => {
      // Aug 5 reading (current_reading=1000) was later edited/deleted after
      // Aug 6-8's daily_volume/previous_reading were already written against
      // it, but nothing cascaded that edit downstream -- Aug 6-8 still store
      // previous_reading pointing at the old Aug 5 value. This is the exact
      // shape of data the live entry path can produce (readingGuards.ts's
      // fetchLastGoodReading / evaluateReadingGuard compute against whatever
      // the DB has at write time, with no trigger to fix up later rows when
      // an earlier one changes after the fact).
      const readings = [
        { locator_id: 'loc-1', reading_datetime: iso('2026-08-06'), current_reading: 1010, daily_volume: 10, previous_reading: 1000 },
        { locator_id: 'loc-1', reading_datetime: iso('2026-08-07'), current_reading: 1020, daily_volume: 20, previous_reading: 1000 }, // stale: should diff against 1010, not the frozen 1000
        { locator_id: 'loc-1', reading_datetime: iso('2026-08-08'), current_reading: 1030, daily_volume: 30, previous_reading: 1000 }, // stale: should diff against 1020
      ];

      const { pivot } = buildEntityPivot(readings, 'locator_id');

      // Aug 6: no walked predecessor yet -> trust stored daily_volume (10). Correct either way.
      expect(pivot.get('2026-08-06')!.get('loc-1')).toBe(10);
      // Aug 7: a predecessor (1010, from Aug 6) IS now known -> must diff live
      // (1020 - 1010 = 10), NOT trust the stale stored daily_volume (20,
      // computed against the frozen previous_reading of 1000).
      expect(pivot.get('2026-08-07')!.get('loc-1')).toBe(10);
      // Aug 8: same self-heal, against the Aug 7 predecessor (1020).
      expect(pivot.get('2026-08-08')!.get('loc-1')).toBe(10);

      // Before the fix, this would have produced 10/20/30 -- a "cumulative-
      // looking total" instead of three equal 10-unit days, exactly the
      // symptom described in the fix commit.
      const total = [...pivot.values()].reduce((sum, day) => sum + (day.get('loc-1') ?? 0), 0);
      expect(total).toBe(30);
    },
  );

  it('trusts the stored daily_volume for the first row of a window (no predecessor to diff against yet)', () => {
    // First row may legitimately span more than one day if readings were
    // skipped before the fetched window -- there's no live predecessor to
    // self-heal against, so the stored value is the correct source here.
    const readings = [
      { locator_id: 'loc-1', reading_datetime: iso('2026-08-06'), current_reading: 1050, daily_volume: 50, previous_reading: 1000 },
    ];
    const { pivot } = buildEntityPivot(readings, 'locator_id');
    expect(pivot.get('2026-08-06')!.get('loc-1')).toBe(50);
  });

  it('does not let the self-heal path cross a meter replacement boundary', () => {
    const readings = [
      { locator_id: 'loc-1', reading_datetime: iso('2026-08-06'), current_reading: 5000, daily_volume: 100, previous_reading: 4900 },
      { locator_id: 'loc-1', reading_datetime: iso('2026-08-07'), is_meter_replacement: true },
      { locator_id: 'loc-1', reading_datetime: iso('2026-08-08'), current_reading: 20, daily_volume: 20, previous_reading: 0 },
    ];
    const { pivot } = buildEntityPivot(readings, 'locator_id');
    expect(pivot.get('2026-08-06')!.get('loc-1')).toBe(100);
    // Aug 8 must NOT self-heal against the pre-replacement 5000 (which would
    // produce a huge negative-clamped-to-0 or nonsensical delta) -- lastSeen
    // was cleared at the replacement, so this correctly falls through to the
    // fresh meter's own stored daily_volume (20).
    expect(pivot.get('2026-08-08')!.get('loc-1')).toBe(20);
  });

  it('direct-mode entities are unaffected by the self-heal path (no diffing at all)', () => {
    const readings = [
      { locator_id: 'loc-1', reading_datetime: iso('2026-08-06'), current_reading: 40 },
      { locator_id: 'loc-1', reading_datetime: iso('2026-08-07'), current_reading: 35 },
    ];
    const { pivot } = buildEntityPivot(readings, 'locator_id', new Set(['loc-1']));
    expect(pivot.get('2026-08-06')!.get('loc-1')).toBe(40);
    expect(pivot.get('2026-08-07')!.get('loc-1')).toBe(35);
  });

  it('self-heals against a live predecessor even when daily_volume is present but current_reading is missing on the predecessor row (falls back correctly)', () => {
    // Edge case: if current_reading is ever missing on a row, lastSeen isn't
    // updated for it -- the next row must not incorrectly assume a
    // predecessor exists from that row.
    const readings = [
      { locator_id: 'loc-1', reading_datetime: iso('2026-08-06'), daily_volume: 10, current_reading: null },
      { locator_id: 'loc-1', reading_datetime: iso('2026-08-07'), current_reading: 1010, daily_volume: 999, previous_reading: 1000 },
    ];
    const { pivot } = buildEntityPivot(readings, 'locator_id');
    // No lastSeen was set on Aug 6 (current_reading was null), so Aug 7
    // correctly falls through to its own stored daily_volume/previous_reading
    // path rather than a nonsensical self-heal against nothing.
    expect(pivot.get('2026-08-07')!.get('loc-1')).toBe(999);
  });
});

describe('fillDateRange / fmtDateKey (sanity — unchanged by this fix)', () => {
  it('fills every calendar day inclusive of both endpoints', () => {
    expect(fillDateRange('2026-08-06', '2026-08-08')).toEqual(['2026-08-06', '2026-08-07', '2026-08-08']);
  });

  it('formats a date key for display', () => {
    expect(fmtDateKey('2026-08-06')).toBe('Aug 6');
  });
});
