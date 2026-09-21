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
  });
});

describe('computeRoTrainDailyVolumes buckets by plant-local (Asia/Manila) day, not the host machine\'s', () => {
  it('keeps two readings on separate Manila calendar days separate, even on a machine whose own local day would merge them', () => {
    // 2026-09-01T10:00:00Z: 2026-09-01 18:00 in Manila (+8) AND 2026-09-01 03:00 in
    // Los Angeles (PDT, -7) that day  both agree on '2026-09-01'.
    // 2026-09-01T17:00:00Z: 2026-09-02 01:00 in Manila  the NEXT Manila day  but
    // still 2026-09-01 10:00 in Los Angeles, the SAME LA day as the first reading.
    // A host running in America/Los_Angeles is exactly the case that used to bucket
    // both readings under '2026-09-01' and sum their volumes into one day.
    const readings = [
      { train_id: 'ro1', reading_datetime: '2026-09-01T10:00:00Z', permeate_today_m3: 100, feed_today_m3: 120, reject_today_m3: 20 },
      { train_id: 'ro1', reading_datetime: '2026-09-01T17:00:00Z', permeate_today_m3: 50, feed_today_m3: 60, reject_today_m3: 10 },
    ];
    const result = computeRoTrainDailyVolumes(readings);
    expect([...result.keys()].sort()).toEqual(['2026-09-01', '2026-09-02']);
    expect(result.get('2026-09-01')?.get('ro1')).toEqual({ permeate: 100, feed: 120, reject: 20 });
    expect(result.get('2026-09-02')?.get('ro1')).toEqual({ permeate: 50, feed: 60, reject: 10 });
  });

  it('a reading just before Manila midnight and one just after land on different days', () => {
    const readings = [
      // 2026-09-01 23:30 Manila
      { train_id: 'ro1', reading_datetime: '2026-09-01T15:30:00Z', permeate_today_m3: 10, feed_today_m3: 10, reject_today_m3: 0 },
      // 2026-09-02 00:30 Manila, one Manila hour later
      { train_id: 'ro1', reading_datetime: '2026-09-01T16:30:00Z', permeate_today_m3: 20, feed_today_m3: 20, reject_today_m3: 0 },
    ];
    const result = computeRoTrainDailyVolumes(readings);
    expect([...result.keys()].sort()).toEqual(['2026-09-01', '2026-09-02']);
  });

  it('skips a reading with an unparseable reading_datetime rather than bucketing it under "Invalid Date"', () => {
    const readings = [
      { train_id: 'ro1', reading_datetime: 'not-a-date', permeate_today_m3: 999, feed_today_m3: 999, reject_today_m3: 999 },
      { train_id: 'ro1', reading_datetime: '2026-09-01T10:00:00Z', permeate_today_m3: 5, feed_today_m3: 5, reject_today_m3: 0 },
    ];
    const result = computeRoTrainDailyVolumes(readings);
    expect([...result.keys()]).toEqual(['2026-09-01']);
    expect(result.get('2026-09-01')?.get('ro1')).toEqual({ permeate: 5, feed: 5, reject: 0 });
  });
});

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

  it('correctly aggregates real database columns (permeate_meter_delta, feed_meter_delta, reject_meter_delta)', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T10:00:00Z',
        permeate_meter_delta: 250.5,
        feed_meter_delta: 334.0,
        reject_meter_delta: 83.5,
        is_meter_replacement: false,
      },
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T14:00:00Z',
        permeate_meter_delta: 200.0,
        feed_meter_delta: 266.0,
        reject_meter_delta: 66.0,
        is_meter_replacement: false,
      },
      {
        // Meter replacement jump row — MUST be excluded from volume totals
        train_id: 'ro1',
        reading_datetime: '2026-09-01T12:00:00Z',
        permeate_meter_delta: 999999,
        feed_meter_delta: 999999,
        reject_meter_delta: 999999,
        is_meter_replacement: true,
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    const dayMap = result.get('2026-09-01');
    expect(dayMap?.get('ro1')).toEqual({ permeate: 450.5, feed: 600.0, reject: 149.5 });
  });

  it('calculates deltas from cumulative meters (meter - meter_prev) when delta columns are null', () => {
    const readings = [
      {
        train_id: 'ro1',
        reading_datetime: '2026-09-01T08:00:00Z',
        permeate_meter: 1500,
        permeate_meter_prev: 1000,
        feed_meter: 2000,
        feed_meter_prev: 1300,
        reject_meter: 500,
        reject_meter_prev: 300,
      },
    ];

    const result = computeRoTrainDailyVolumes(readings);
    const dayMap = result.get('2026-09-01');
    expect(dayMap?.get('ro1')).toEqual({ permeate: 500, feed: 700, reject: 200 });
  });
});

describe('recoveryFromVolumes edge cases', () => {
  it('handles edge cases with small volumes', () => {
    expect(recoveryFromVolumes(1, 10, 9)).toBe(10.0);
    expect(recoveryFromVolumes(999, 1000, 1)).toBe(99.9);
  });
});