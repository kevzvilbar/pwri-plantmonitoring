import { describe, it, expect } from 'vitest';
import { resolveBlendingDateContext } from './blendingBackdate';

describe('resolveBlendingDateContext', () => {
  // Regression test for the bug where backdating a missed day (e.g. Aug 13,
  // after Aug 15 was already logged) compared the backfilled reading
  // against the well's globally-latest reading instead of the reading that
  // was actually current as of Aug 13 — producing a false negative delta
  // ("Reading is below the previous value") that permanently blocked Save.

  it('splits an exact match on eventDate from its true predecessor', () => {
    // Backdating Aug 13, which already has an entry, with Aug 11 before it.
    const rows = [
      { raw_meter_reading: 130820, event_date: '2026-08-13' },
      { raw_meter_reading: 129500, event_date: '2026-08-11' },
    ];
    const ctx = resolveBlendingDateContext(rows, '2026-08-13');
    expect(ctx.existingForDate).toEqual({ reading: 130820 });
    expect(ctx.predecessor).toEqual({ reading: 129500, date: '2026-08-11' });
  });

  it('finds the predecessor when no reading exists yet on eventDate (the missing-day case)', () => {
    // Aug 13 has never been logged; Aug 11 is the true predecessor to
    // compare against — NOT the Aug 15 reading a naive "globally latest"
    // lookup would have used.
    const rows = [
      { raw_meter_reading: 129500, event_date: '2026-08-11' },
    ];
    const ctx = resolveBlendingDateContext(rows, '2026-08-13');
    expect(ctx.existingForDate).toBeNull();
    expect(ctx.predecessor).toEqual({ reading: 129500, date: '2026-08-11' });
  });

  it('reports a baseline (no predecessor) when eventDate is the well\'s earliest reading', () => {
    const rows = [
      { raw_meter_reading: 100000, event_date: '2026-08-13' },
    ];
    const ctx = resolveBlendingDateContext(rows, '2026-08-13');
    expect(ctx.existingForDate).toEqual({ reading: 100000 });
    expect(ctx.predecessor).toBeNull();
  });

  it('returns nulls for a well with no readings at all', () => {
    const ctx = resolveBlendingDateContext([], '2026-08-13');
    expect(ctx.existingForDate).toBeNull();
    expect(ctx.predecessor).toBeNull();
  });

  it('never treats a later-dated reading as the predecessor for an earlier eventDate, even given unfiltered rows', () => {
    // Guards the exact screenshot scenario: Aug 15 (131,891) already
    // logged, backdating Aug 13. Aug 15 must never be picked as "previous"
    // — asserted here even with an unfiltered rows array (the real query
    // always pre-filters event_date <= eventDate, but the function must not
    // silently produce a wrong answer if a future caller forgets to).
    const rows = [
      { raw_meter_reading: 131891, event_date: '2026-08-15' },
    ];
    const ctx = resolveBlendingDateContext(rows, '2026-08-13');
    expect(ctx.predecessor).toBeNull();
    expect(ctx.existingForDate).toBeNull();
  });
});
