import { describe, it, expect } from 'vitest';
import {
  buildTrendRows, buildEntityPivotRows, isGranularityUsable, rangeDaysBetween,
  type DailyTrendRow,
} from './TrendChartAggregate';

// Mon Aug 3 2026 .. Sun Aug 9 2026 is a clean ISO week — convenient fixture.
function daily(dateISO: string, fields: Record<string, unknown>): DailyTrendRow {
  return { date: dateISO, isoDate: `${dateISO}T00:00:00.000Z`, ...fields };
}

describe('buildTrendRows', () => {
  it('passes daily rows through unchanged (plus bucket metadata)', () => {
    const rows = [daily('2026-08-03', { production: 100 })];
    const out = buildTrendRows(rows, { granularity: 'daily', fields: { production: 'sum' } });
    expect(out).toHaveLength(1);
    expect(out[0]._partial).toBe(false);
    expect(out[0]._dayCount).toBe(1);
  });

  it('sums volume fields across a full ISO week (Monday start)', () => {
    const rows = [
      daily('2026-08-03', { production: 100 }), // Mon
      daily('2026-08-04', { production: 200 }),
      daily('2026-08-05', { production: 150 }),
      daily('2026-08-06', { production: 50 }),
      daily('2026-08-07', { production: 300 }),
      daily('2026-08-08', { production: 0 }),
      daily('2026-08-09', { production: 400 }), // Sun
    ];
    const out = buildTrendRows(rows, {
      granularity: 'weekly',
      fields: { production: 'sum' },
      rangeStartKey: '2026-08-03',
      rangeEndKey: '2026-08-09',
    });
    expect(out).toHaveLength(1);
    expect(out[0].production).toBe(1200);
    expect(out[0]._partial).toBe(false); // exactly Mon-Sun, fully covered
    expect(out[0].date).toBe('Wk of Aug 3');
  });

  it('flags a bucket partial when the fetched range does not cover the full ISO week', () => {
    // Range starts mid-week (Wed Aug 5), so the Aug 3 week bucket is missing Mon/Tue.
    const rows = [
      daily('2026-08-05', { production: 150 }),
      daily('2026-08-06', { production: 50 }),
    ];
    const out = buildTrendRows(rows, {
      granularity: 'weekly',
      fields: { production: 'sum' },
      rangeStartKey: '2026-08-05',
      rangeEndKey: '2026-08-09',
    });
    expect(out[0]._partial).toBe(true);
  });

  it('computes a true volume-weighted average for a rate field (e.g. powerCost ₱/m³)', () => {
    // Day 1: 10 pesos over 5 m3 => 2/m3 (weight 5). Day 2: 100 pesos over 5 m3 => 20/m3 (weight 5).
    // Naive unweighted average of the two rates = (2+20)/2 = 11.
    // Correct volume-weighted average = (10+100)/(5+5) = 11 as well in this
    // symmetric case — use unequal weights below to actually distinguish them.
    const rows = [
      daily('2026-08-03', { powerCost: 2, production: 90 }),  // 90 * 2 = 180 pesos
      daily('2026-08-04', { powerCost: 20, production: 10 }), // 10 * 20 = 200 pesos
    ];
    const out = buildTrendRows(rows, {
      granularity: 'weekly',
      fields: { powerCost: { type: 'weighted-avg', weight: 'production' } },
      rangeStartKey: '2026-08-03',
      rangeEndKey: '2026-08-04',
    });
    // Correct: (180 + 200) / (90 + 10) = 380 / 100 = 3.8
    // A naive unweighted average would have wrongly returned 11.
    expect(out[0].powerCost).toBeCloseTo(3.8, 4);
  });

  it('unions string-array fields (meter replacement labels) without duplicates', () => {
    const rows = [
      daily('2026-08-03', { _flags: ['Well A Meter'] }),
      daily('2026-08-04', { _flags: ['Well A Meter', 'Well B Meter'] }),
    ];
    const out = buildTrendRows(rows, {
      granularity: 'weekly',
      fields: { _flags: 'union' },
      rangeStartKey: '2026-08-03',
      rangeEndKey: '2026-08-04',
    });
    expect((out[0]._flags as string[]).sort()).toEqual(['Well A Meter', 'Well B Meter']);
  });

  it('buckets monthly across a month boundary correctly', () => {
    const rows = [
      daily('2026-07-30', { production: 10 }),
      daily('2026-07-31', { production: 10 }),
      daily('2026-08-01', { production: 5 }),
      daily('2026-08-02', { production: 5 }),
    ];
    const out = buildTrendRows(rows, {
      granularity: 'monthly',
      fields: { production: 'sum' },
      rangeStartKey: '2026-07-30',
      rangeEndKey: '2026-08-02',
    });
    expect(out).toHaveLength(2);
    expect(out[0].date).toBe('Jul 2026');
    expect(out[0].production).toBe(20);
    expect(out[0]._partial).toBe(true); // July bucket missing days 1-29
    expect(out[1].date).toBe('Aug 2026');
    expect(out[1].production).toBe(10);
    expect(out[1]._partial).toBe(true); // August bucket missing days 3-31
  });
});

describe('isGranularityUsable', () => {
  it('always allows daily', () => {
    expect(isGranularityUsable('daily', 1)).toBe(true);
  });
  it('disables weekly on a 7-day range', () => {
    expect(isGranularityUsable('weekly', 7)).toBe(false);
  });
  it('enables weekly on a 14-day range', () => {
    expect(isGranularityUsable('weekly', 14)).toBe(true);
  });
  it('disables monthly on a 30-day range', () => {
    expect(isGranularityUsable('monthly', 30)).toBe(false);
  });
  it('enables monthly on a 60-day range', () => {
    expect(isGranularityUsable('monthly', 60)).toBe(true);
  });
});

describe('rangeDaysBetween', () => {
  it('is inclusive of both endpoints', () => {
    expect(rangeDaysBetween('2026-08-01', '2026-08-07')).toBe(7);
    expect(rangeDaysBetween('2026-08-01', '2026-08-01')).toBe(1);
  });
});

describe('buildEntityPivotRows', () => {
  const entities = [
    { id: 'a', label: 'Locator A', color: '#111' },
    { id: 'b', label: 'Locator B', color: '#222' },
  ];

  it('fills every calendar day at daily granularity, even gaps', () => {
    const pivot = new Map<string, Map<string, number>>([
      ['2026-08-03', new Map([['a', 10]])],
      ['2026-08-05', new Map([['a', 5], ['b', 2]])],
    ]);
    const out = buildEntityPivotRows(pivot, ['2026-08-03', '2026-08-05'], entities, 'daily');
    expect(out).toHaveLength(3); // Aug 3, 4 (gap), 5
    expect(out[1].a).toBeNull();
    expect(out[2]._total).toBe(7);
  });

  it('produces the same total whether bucketed monthly directly or summed from daily', () => {
    const pivot = new Map<string, Map<string, number>>([
      ['2026-08-01', new Map([['a', 10], ['b', 3]])],
      ['2026-08-15', new Map([['a', 20], ['b', 7]])],
      ['2026-08-31', new Map([['a', 5]])],
    ]);
    const keys = ['2026-08-01', '2026-08-15', '2026-08-31'];
    const monthly = buildEntityPivotRows(pivot, keys, entities, 'monthly');
    expect(monthly).toHaveLength(1);
    expect(monthly[0].a).toBe(35);
    expect(monthly[0].b).toBe(10);
    expect(monthly[0]._total).toBe(45);
  });

  it('returns an empty array when there is no data', () => {
    expect(buildEntityPivotRows(new Map(), [], entities, 'daily')).toEqual([]);
  });
});
