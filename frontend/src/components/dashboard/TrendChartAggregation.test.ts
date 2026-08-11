import { describe, it, expect } from 'vitest';
import {
  bucketKeyForGranularity, formatBucketLabel, rollupTotalRows, rollupEntityRows,
} from './TrendChartAggregation';

/** Build a minimal chartData-shaped daily row. */
function dayRow(dateKey: string, overrides: Record<string, any> = {}) {
  return {
    date: dateKey, isoDate: new Date(`${dateKey}T00:00:00`).toISOString(),
    production: null, consumption: null, rawwater: null,
    recovery: null, tds: null, kwh: null, solarKwh: null,
    nrw: null, powerCost: null, chemCost: null, totalCost: null,
    _meterReplacements: [], _permeateSourceNames: [],
    ...overrides,
  };
}

describe('bucketKeyForGranularity', () => {
  it('daily is a passthrough of the date key', () => {
    expect(bucketKeyForGranularity('2026-08-06', 'daily')).toBe('2026-08-06');
  });

  it('weekly buckets to the ISO (Monday-start) week', () => {
    // Aug 6 2026 is a Thursday; that ISO week starts Mon Aug 3.
    expect(bucketKeyForGranularity('2026-08-06', 'weekly')).toBe('2026-08-03');
    // The following Monday is a new bucket.
    expect(bucketKeyForGranularity('2026-08-10', 'weekly')).toBe('2026-08-10');
  });

  it('monthly buckets to the 1st of the month', () => {
    expect(bucketKeyForGranularity('2026-08-06', 'monthly')).toBe('2026-08-01');
    expect(bucketKeyForGranularity('2026-08-31', 'monthly')).toBe('2026-08-01');
  });
});

describe('formatBucketLabel', () => {
  it('monthly renders "MMM yyyy"', () => {
    expect(formatBucketLabel('2026-08-01', 'monthly')).toBe('Aug 2026');
  });
  it('weekly renders the week-start date as "MMM d"', () => {
    expect(formatBucketLabel('2026-08-03', 'weekly')).toBe('Aug 3');
  });
});

describe('rollupTotalRows', () => {
  it('is a no-op passthrough at daily granularity', () => {
    const rows = [dayRow('2026-08-03', { production: 100 }), dayRow('2026-08-04', { production: 200 })];
    expect(rollupTotalRows(rows, 'daily')).toBe(rows);
  });

  it('sums volume fields across a full ISO week', () => {
    const rows = [
      dayRow('2026-08-03', { production: 100, consumption: 80, rawwater: 10 }),
      dayRow('2026-08-04', { production: 150, consumption: 90, rawwater: 20 }),
      dayRow('2026-08-05', { production: 50,  consumption: 30, rawwater: 5 }),
      dayRow('2026-08-06', { production: 0,   consumption: 0,  rawwater: 0 }),
      dayRow('2026-08-07', { production: 200, consumption: 100, rawwater: 15 }),
      dayRow('2026-08-08', { production: 100, consumption: 60, rawwater: 10 }),
      dayRow('2026-08-09', { production: 100, consumption: 60, rawwater: 10 }),
    ];
    const out = rollupTotalRows(rows, 'weekly');
    expect(out).toHaveLength(1);
    expect(out[0].production).toBe(700);
    expect(out[0].consumption).toBe(420);
    expect(out[0].rawwater).toBe(70);
    expect(out[0]._isPartial).toBe(false); // full 7 days present
    expect(out[0]._bucketDays).toBe(7);
  });

  it('flags a range-edge partial week and averages rate fields unweighted', () => {
    const rows = [
      dayRow('2026-08-03', { production: 100, recovery: 80 }),
      dayRow('2026-08-04', { production: 100, recovery: 90 }),
    ]; // only 2 of 7 days present in the fetched window
    const out = rollupTotalRows(rows, 'weekly');
    expect(out).toHaveLength(1);
    expect(out[0]._isPartial).toBe(true);
    expect(out[0]._bucketDays).toBe(2);
    expect(out[0].recovery).toBe(85); // (80+90)/2, unweighted
  });

  it('recomputes NRW from summed production/consumption rather than averaging the daily percentage', () => {
    // Day 1: huge volume, low NRW. Day 2: tiny volume, high NRW.
    // A naive average of the two NRW% values would be dominated by the
    // tiny-volume day; the correct rollup should barely move from day 1's number.
    const rows = [
      dayRow('2026-08-03', { production: 10000, consumption: 9700, nrw: 3.0 }), // real NRW ≈ 3%
      dayRow('2026-08-04', { production: 10,    consumption: 5,    nrw: 50.0 }), // real NRW = 50%
    ];
    const out = rollupTotalRows(rows, 'weekly');
    // summed production=10010, consumption=9705 → nrw ≈ 3.05%, NOT (3+50)/2=26.5
    expect(out[0].nrw).toBeCloseTo(3.0, 0);
    expect(out[0].nrw).toBeLessThan(10);
  });

  it('sums across a month boundary correctly and produces one bucket per month', () => {
    const rows = [
      dayRow('2026-07-30', { production: 100 }),
      dayRow('2026-07-31', { production: 100 }),
      dayRow('2026-08-01', { production: 50 }),
      dayRow('2026-08-02', { production: 50 }),
    ];
    const out = rollupTotalRows(rows, 'monthly');
    expect(out).toHaveLength(2);
    expect(out[0].date).toBe('Jul 2026');
    expect(out[0].production).toBe(200);
    expect(out[1].date).toBe('Aug 2026');
    expect(out[1].production).toBe(100);
  });

  it('treats an all-null field as null rather than 0', () => {
    const rows = [dayRow('2026-08-03'), dayRow('2026-08-04')];
    const out = rollupTotalRows(rows, 'weekly');
    expect(out[0].production).toBeNull();
    expect(out[0].recovery).toBeNull();
    expect(out[0].nrw).toBeNull();
  });

  it('unions meter-replacement names across the bucket instead of keeping only the last day\'s', () => {
    const rows = [
      dayRow('2026-08-03', { _meterReplacements: ['Well A'] }),
      dayRow('2026-08-04', { _meterReplacements: [] }),
      dayRow('2026-08-05', { _meterReplacements: ['Well B'] }),
    ];
    const out = rollupTotalRows(rows, 'weekly');
    expect(out[0]._meterReplacements.sort()).toEqual(['Well A', 'Well B']);
  });
});

describe('rollupEntityRows', () => {
  it('sums entity volumes into weekly buckets and flags a partial trailing bucket', () => {
    const pivot = new Map<string, Map<string, number>>([
      ['2026-08-03', new Map([['loc1', 10], ['loc2', 5]])],
      ['2026-08-04', new Map([['loc1', 20], ['loc2', 5]])],
      ['2026-08-10', new Map([['loc1', 100]])], // next ISO week, only 1 of 7 days
    ]);
    const dateKeys = ['2026-08-03', '2026-08-04', '2026-08-10'];
    const out = rollupEntityRows(pivot, dateKeys, ['loc1', 'loc2'], 'weekly');
    expect(out).toHaveLength(2);
    expect(out[0].date).toBe('Aug 3');
    expect(out[0].loc1).toBe(30);
    expect(out[0].loc2).toBe(10);
    expect(out[0]._total).toBe(40);
    expect(out[0]._isPartial).toBe(true); // only 2 of 7 days present, same heuristic as before
    expect(out[1].loc1).toBe(100);
    // loc2 had no reading at all in this bucket — sums to 0, not null. This
    // matches the pre-existing buildMonthRows behaviour exactly (every
    // visible entity gets folded into the bucket sum for every date key,
    // defaulting a missing day to 0), so a genuinely no-data entity reads
    // as a real zero rather than a gap. Not something this rollup changes.
    expect(out[1].loc2).toBe(0);
  });

  it('sums entity volumes into monthly buckets, matching the old hardcoded-month behaviour', () => {
    const pivot = new Map<string, Map<string, number>>([
      ['2026-07-31', new Map([['loc1', 10]])],
      ['2026-08-01', new Map([['loc1', 20]])],
    ]);
    const out = rollupEntityRows(pivot, ['2026-07-31', '2026-08-01'], ['loc1'], 'monthly');
    expect(out).toHaveLength(2);
    expect(out[0].date).toBe('Jul 2026');
    expect(out[0].loc1).toBe(10);
    expect(out[1].date).toBe('Aug 2026');
    expect(out[1].loc1).toBe(20);
  });
});
