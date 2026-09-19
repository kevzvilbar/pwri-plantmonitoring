import { describe, it, expect } from 'vitest';
import { getHourBucket, isOfflineRORecord } from './hourlyReadingGuard';

describe('getHourBucket', () => {
  it('labels the bucket after the hour the input time falls in', () => {
    expect(getHourBucket('2026-08-23T06:23').label).toBe('6:00–6:59');
    expect(getHourBucket('2026-08-23T14:59').label).toBe('14:00–14:59');
  });

  it('every minute within the same hour maps to the identical bucket', () => {
    const start = getHourBucket('2026-08-23T07:00');
    const mid   = getHourBucket('2026-08-23T07:31');
    const end   = getHourBucket('2026-08-23T07:59');
    expect(mid.startISO).toBe(start.startISO);
    expect(mid.endISO).toBe(start.endISO);
    expect(end.startISO).toBe(start.startISO);
    expect(end.endISO).toBe(start.endISO);
  });

  it('a bucket spans exactly one hour, start inclusive / end exclusive', () => {
    const b = getHourBucket('2026-08-23T14:10');
    const spanMs = new Date(b.endISO).getTime() - new Date(b.startISO).getTime();
    expect(spanMs).toBe(60 * 60 * 1000);
  });

  it('the next hour begins exactly where the previous one ends — no gap, no overlap', () => {
    const six   = getHourBucket('2026-08-23T06:45');
    const seven = getHourBucket('2026-08-23T07:00');
    expect(six.endISO).toBe(seven.startISO);
    expect(six.label).not.toBe(seven.label);
  });

  it('handles the first hour of the day (0:00–0:59)', () => {
    expect(getHourBucket('2026-08-23T00:05').label).toBe('0:00–0:59');
  });

  it('handles the last hour of the day (23:00–23:59) without rolling into the next day', () => {
    const b = getHourBucket('2026-08-23T23:50');
    expect(b.label).toBe('23:00–23:59');
    // End boundary should be midnight of the *next* calendar day, not a
    // wrapped-around 0:00 on the same day.
    expect(new Date(b.endISO).getDate()).not.toBe(new Date(b.startISO).getDate());
  });
});

describe('isOfflineRORecord', () => {
  it('recognizes offline records by incomplete_reason', () => {
    expect(isOfflineRORecord({ incomplete_reason: 'Offline: Operator Shutdown' })).toBe(true);
    expect(isOfflineRORecord({ incomplete_reason: 'Offline: off reserve' })).toBe(true);
    expect(isOfflineRORecord({ incomplete_reason: 'Offline' })).toBe(true);
  });

  it('recognizes offline records when both feed and permeate flows are null', () => {
    expect(isOfflineRORecord({ feed_flow: null, permeate_flow: null })).toBe(true);
    expect(isOfflineRORecord({ feed_flow: undefined, permeate_flow: undefined })).toBe(true);
  });

  it('does not classify active operational records as offline', () => {
    expect(isOfflineRORecord({ feed_flow: 72, permeate_flow: 62.69 })).toBe(false);
    expect(isOfflineRORecord({ incomplete_reason: 'Sensor glitch', feed_flow: 72, permeate_flow: null })).toBe(false);
  });
});
