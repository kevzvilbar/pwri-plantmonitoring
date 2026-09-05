import { describe, it, expect } from 'vitest';
import { sanitizeReadings, sanitizeReadingsForEntity } from './readingSanitizer';

describe('readingSanitizer', () => {
  it('discards an orphan estimated reading when a human reading exists on the same calendar day (Amalfi Sep 1 scenario)', () => {
    const rawReadings = [
      {
        locator_id: 'amalfi-loc',
        reading_datetime: '2026-08-31T21:56:00.000Z',
        current_reading: 148700,
        is_estimated: false,
      },
      {
        locator_id: 'amalfi-loc',
        reading_datetime: '2026-09-01T00:00:00.000Z',
        current_reading: 148801,
        is_estimated: false,
      },
      {
        locator_id: 'amalfi-loc',
        reading_datetime: '2026-09-01T12:00:00.000Z',
        current_reading: 148686,
        is_estimated: true, // Old corrupt auto-backfill estimate
      },
      {
        locator_id: 'amalfi-loc',
        reading_datetime: '2026-09-02T06:06:00.000Z',
        current_reading: 148902,
        is_estimated: false,
      },
    ];

    const sanitized = sanitizeReadings(rawReadings, 'locator_id');

    expect(sanitized).toHaveLength(3);
    expect(sanitized.map((r) => r.current_reading)).toEqual([148700, 148801, 148902]);
  });

  it('discards non-monotonic estimates even when no human reading exists on that day', () => {
    const readings = [
      {
        locator_id: 'loc-1',
        reading_datetime: '2026-09-01T08:00:00.000Z',
        current_reading: 1000,
        is_estimated: false,
      },
      {
        locator_id: 'loc-1',
        reading_datetime: '2026-09-02T08:00:00.000Z',
        current_reading: 950, // Backward estimate
        is_estimated: true,
      },
      {
        locator_id: 'loc-1',
        reading_datetime: '2026-09-03T08:00:00.000Z',
        current_reading: 1100,
        is_estimated: false,
      },
    ];

    const sanitized = sanitizeReadings(readings, 'locator_id');
    expect(sanitized).toHaveLength(2);
    expect(sanitized.map((r) => r.current_reading)).toEqual([1000, 1100]);
  });

  it('keeps valid monotonic estimates when no human reading exists on that day', () => {
    const readings = [
      {
        locator_id: 'loc-1',
        reading_datetime: '2026-09-01T08:00:00.000Z',
        current_reading: 1000,
        is_estimated: false,
      },
      {
        locator_id: 'loc-1',
        reading_datetime: '2026-09-02T08:00:00.000Z',
        current_reading: 1050, // Valid forward estimate
        is_estimated: true,
      },
      {
        locator_id: 'loc-1',
        reading_datetime: '2026-09-03T08:00:00.000Z',
        current_reading: 1100,
        is_estimated: false,
      },
    ];

    const sanitized = sanitizeReadings(readings, 'locator_id');
    expect(sanitized).toHaveLength(3);
    expect(sanitized.map((r) => r.current_reading)).toEqual([1000, 1050, 1100]);
  });

  it('handles multiple entities independently without cross-contamination', () => {
    const readings = [
      {
        locator_id: 'loc-A',
        reading_datetime: '2026-09-01T08:00:00.000Z',
        current_reading: 500,
        is_estimated: false,
      },
      {
        locator_id: 'loc-B',
        reading_datetime: '2026-09-01T08:00:00.000Z',
        current_reading: 200,
        is_estimated: true, // Only estimate for B on this day
      },
    ];

    const sanitized = sanitizeReadings(readings, 'locator_id');
    expect(sanitized).toHaveLength(2);
  });

  it('preserves fluctuating daily volumes for direct-mode / derived meters like HAMAS (is_estimated = true)', () => {
    const hamasReadings = [
      {
        locator_id: 'hamas-loc',
        reading_datetime: '2026-08-25T16:00:00.000Z',
        current_reading: 4132.10,
        is_estimated: true,
      },
      {
        locator_id: 'hamas-loc',
        reading_datetime: '2026-08-26T16:00:00.000Z',
        current_reading: 4659.80,
        is_estimated: true,
      },
      {
        locator_id: 'hamas-loc',
        reading_datetime: '2026-08-27T16:00:00.000Z',
        current_reading: 4782.80,
        is_estimated: true,
      },
      {
        locator_id: 'hamas-loc',
        reading_datetime: '2026-08-28T16:00:00.000Z',
        current_reading: 4491.20, // Lower than yesterday — perfectly normal for direct-volume HAMAS!
        is_estimated: true,
      },
      {
        locator_id: 'hamas-loc',
        reading_datetime: '2026-08-29T16:00:00.000Z',
        current_reading: 4879.23,
        is_estimated: true,
      },
      {
        locator_id: 'hamas-loc',
        reading_datetime: '2026-09-01T16:00:00.000Z',
        current_reading: 5577.20,
        is_estimated: true,
      },
      {
        locator_id: 'hamas-loc',
        reading_datetime: '2026-09-02T16:00:00.000Z',
        current_reading: 1923.25, // Lower than yesterday — must NOT be dropped!
        is_estimated: true,
      },
    ];

    const directModeIds = new Set(['hamas-loc']);
    const sanitized = sanitizeReadings(hamasReadings, 'locator_id', directModeIds);

    // All 7 direct-mode daily volume entries must be preserved
    expect(sanitized).toHaveLength(7);
    expect(sanitized.map((r) => r.current_reading)).toEqual([
      4132.10, 4659.80, 4782.80, 4491.20, 4879.23, 5577.20, 1923.25,
    ]);
  });
});


