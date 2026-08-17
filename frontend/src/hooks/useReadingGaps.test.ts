import { describe, it, expect } from 'vitest';
import { gapDescription } from './useReadingGaps';

// Regression test for a bug found in the 2026-08-18 review: an Active
// well/locator that has never had a single reading logged gets
// hours_gap = Infinity (see fetchReadingGaps below), and the alert
// description used to compute `${(Infinity / 24).toFixed(0)}d`, which
// stringifies to the literal text "Infinityd" — a broken-looking message
// in the notification bell for exactly the kind of entity (freshly
// commissioned, never reported) an operator most needs a clear nudge about.

describe('gapDescription', () => {
  it('says a reading has never been logged when last_reading_at is null', () => {
    expect(gapDescription({ last_reading_at: null, hours_gap: Infinity })).toBe(
      'No reading has ever been logged — check the meter/connectivity or log a reading',
    );
  });

  it('never renders the literal string "Infinity"', () => {
    expect(gapDescription({ last_reading_at: null, hours_gap: Infinity })).not.toContain('Infinity');
  });

  it('renders whole days once the gap is at least 24h', () => {
    expect(gapDescription({ last_reading_at: '2026-08-14T00:00:00Z', hours_gap: 72 })).toBe(
      'No reading in 3d — check the meter/connectivity or log a reading',
    );
  });

  it('renders a fractional day for gaps under 24h', () => {
    expect(gapDescription({ last_reading_at: '2026-08-17T00:00:00Z', hours_gap: 20 })).toBe(
      'No reading in 0.8d — check the meter/connectivity or log a reading',
    );
  });
});
