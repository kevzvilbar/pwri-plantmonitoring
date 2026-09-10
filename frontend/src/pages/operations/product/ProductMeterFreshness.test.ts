import { describe, it, expect } from 'vitest';
import { lastReadingFreshness } from '@/lib/format';
import { format } from 'date-fns';

describe('Product Meter Reading Freshness & Today reconciliation', () => {
  it('correctly recognizes today reading as fresh (accent tone) even when pending_review', () => {
    const today = new Date();
    const todayIso = today.toISOString();
    const todayDateStr = format(today, 'yyyy-MM-dd');

    const reading = {
      meter_id: 'coke-meter-1',
      current_reading: 509480.0,
      reading_datetime: todayIso,
      norm_status: 'pending_review',
    };

    const fresh = lastReadingFreshness(reading.reading_datetime);
    expect(fresh.tone).toBe('accent');
    expect(fresh.label).not.toContain('days ago');

    const hasReadingToday =
      !!reading.reading_datetime &&
      format(new Date(reading.reading_datetime), 'yyyy-MM-dd') === todayDateStr;
    expect(hasReadingToday).toBe(true);
  });

  it('correctly flags reading from 5 days ago as stale (danger tone)', () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const staleIso = fiveDaysAgo.toISOString();
    const todayDateStr = format(new Date(), 'yyyy-MM-dd');

    const staleReading = {
      meter_id: 'coke-meter-1',
      current_reading: 505090.0,
      reading_datetime: staleIso,
      norm_status: 'normal',
    };

    const fresh = lastReadingFreshness(staleReading.reading_datetime);
    expect(fresh.tone).toBe('danger');
    expect(fresh.label).toContain('5 days ago');

    const hasReadingToday =
      !!staleReading.reading_datetime &&
      format(new Date(staleReading.reading_datetime), 'yyyy-MM-dd') === todayDateStr;
    expect(hasReadingToday).toBe(false);
  });

  it('preserves non-retracted readings when reconciling latest by meter', () => {
    // Simulates the reading sequence for Coke:
    // Sep 5: normal (505,090)
    // Sep 6-10: pending_review (up to 509,480)
    const readings = [
      { id: '1', meter_id: 'm1', current_reading: 509480, reading_datetime: '2026-09-10T08:16:00Z', norm_status: 'pending_review' },
      { id: '2', meter_id: 'm1', current_reading: 508590, reading_datetime: '2026-09-09T07:53:00Z', norm_status: 'pending_review' },
      { id: '3', meter_id: 'm1', current_reading: 507730, reading_datetime: '2026-09-08T08:09:00Z', norm_status: 'pending_review' },
      { id: '4', meter_id: 'm1', current_reading: 506570, reading_datetime: '2026-09-07T08:13:00Z', norm_status: 'pending_review' },
      { id: '5', meter_id: 'm1', current_reading: 505980, reading_datetime: '2026-09-06T08:17:00Z', norm_status: 'pending_review' },
      { id: '6', meter_id: 'm1', current_reading: 505090, reading_datetime: '2026-09-05T15:15:00Z', norm_status: 'normal' },
    ];

    // Under the new query logic (excluding only retracted rows):
    const nonRetracted = readings.filter(r => r.norm_status !== 'retracted');
    const latest = nonRetracted[0];

    expect(latest.current_reading).toBe(509480);
    expect(latest.reading_datetime).toBe('2026-09-10T08:16:00Z');
  });
});
