import { describe, it, expect } from 'vitest';
import { computeRoTrainDailyVolumes, recoveryFromVolumes } from './roTrainDailyVolumes';

describe('recoveryFromVolumes', () => {
  it('calculates recovery % from permeate and feed volumes', () => {
    // 75% recovery: 750 permeate / 1000 feed
    expect(recoveryFromVolumes(750, 1000, 250)).toBe(75.0);
    // 80% recovery: 800 permeate / 1000 feed
    expect(recoveryFromVolumes(800, 1000, 200)).toBe(80.0);
  });

  it('returns null when feed is 0 and no inference is possible', () => {
    expect(recoveryFromVolumes(0, 0, 0)).toBeNull();
    expect(recoveryFromVolumes(100, 0, 0)).toBeNull();
  });

  it('infers feed from permeate + reject when feed is 0', () => {
    // permeate = 750, reject = 250, feed inferred = 1000 → 75%
    expect(recoveryFromVolumes(750, 0, 250)).toBe(75.0);
describe('computeRoTrainDailyVolumes', () => {
  it('aggregates permeate/feed/reject volumes per train per day', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        permeate_today_m3: 100,
        feed_today_m3: 120,
        reject_today_m3: 20,
      },
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T14:00:00Z',
        permeate_today_m3: 50,
        feed_today_m3: 60,
        reject_today_m3: 10,
      },
      {
        train_id: 'ro2',
        reading_datetime: '2026-09-01T12:00:00Z',
        permeate_today_m3: 200,
        feed_today_m3: 250,
        reject_today_m3: 50,
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);

    expect(result.size).toBe(1); // one day
    const dayMap = result.get('2026-09-01');
    expect(dayMap).toBeDefined();
    expect(dayMap?.get('ro1')).toEqual({ permeate: 150, feed: 180, reject: 30 });
    expect(dayMap?.get('ro2')).toEqual({ permeate: 200, feed: 250, reject: 50 });
  });

  it('handles permeate-only readings (last resort: feed = permeate)', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        permeate_today_m3: 100,
        // no feed, no reject
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    const dayMap = result.get('2026-09-01');
    // last resort: feed = permeate, reject = 0
    expect(dayMap?.get('ro1')).toEqual({ permeate: 100, feed: 100, reject: 0 });
  });

  it('handles feed-only readings (last resort: permeate = feed)', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        feed_today_m3: 120,
        // no permeate, no reject
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    const dayMap = result.get('2026-09-01');
    // last resort: permeate = feed, reject = 0
    expect(dayMap?.get('ro1')).toEqual({ permeate: 120, feed: 120, reject: 0 });
  });

  it('handles reject-only readings (last resort: feed = reject)', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        reject_today_m3: 20,
        // no permeate, no feed
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    const dayMap = result.get('2026-09-01');
    // last resort: feed = reject, permeate = 0
    expect(dayMap?.get('ro1')).toEqual({ permeate: 0, feed: 20, reject: 20 });
  });

  it('aggregates volumes across multiple days', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        permeate_today_m3: 100,
        feed_today_m3: 120,
        reject_today_m3: 20,
      },
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-02T10:00:00Z',
        permeate_today_m3: 150,
        feed_today_m3: 180,
        reject_today_m3: 30,
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    expect(result.size).toBe(2);

    const day1 = result.get('2026-09-01');
    expect(day1?.get('ro1')).toEqual({ permeate: 100, feed: 120, reject: 20 });

    const day2 = result.get('2026-09-02');
    expect(day2?.get('ro1')).toEqual({ permeate: 150, feed: 180, reject: 30 });
  });

  it('returns empty map for empty readings', () => {
    const result = computeRoTrainDailyVolumes([]);
    expect(result.size).toBe(0);
  });

  it('skips readings without train_id or reading_datetime', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        permeate_today_m3: 100,
      },
      {
        // no train_id
        reading_datetime: '2026-09-01T10:00:00Z',
        permeate_today_m3: 50,
      },
      {
        train_id: 'ro2',
        // no reading_datetime
        permeate_today_m3: 75,
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    expect(result.size).toBe(1);
    expect(result.get('2026-09-01')?.get('ro1')).toEqual({ permeate: 100, feed: 100, reject: 0 });
  });
});


  it('infers missing feed from permeate + reject', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        permeate_today_m3: 100,
        reject_today_m3: 20,
        // feed_today_m3 missing
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    const dayMap = result.get('2026-09-01');
    // feed should be inferred as 100 + 20 = 120
    expect(dayMap?.get('ro1')).toEqual({ permeate: 100, feed: 120, reject: 20 });
  });

  it('infers missing reject from feed - permeate', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        permeate_today_m3: 100,
        feed_today_m3: 120,
        // reject_today_m3 missing
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    const dayMap = result.get('2026-09-01');
    // reject should be inferred as 120 - 100 = 20
    expect(dayMap?.get('ro1')).toEqual({ permeate: 100, feed: 120, reject: 20 });
  });

  it('infers missing permeate from feed - reject', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        feed_today_m3: 120,
        reject_today_m3: 20,
        // permeate_today_m3 missing
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    const dayMap = result.get('2026-09-01');
    // permeate should be inferred as 120 - 20 = 100
    expect(dayMap?.get('ro1')).toEqual({ permeate: 100, feed: 120, reject: 20 });
  });
});
  });

  it('handles edge cases with small volumes', () => {
    expect(recoveryFromVolumes(1, 10, 9)).toBe(10.0);
    expect(recoveryFromVolumes(999, 1000, 1)).toBe(99.9);
  });
});