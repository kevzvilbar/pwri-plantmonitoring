import { describe, it, expect } from 'vitest';
import { computeGridMeterBreakdown, buildKwhSummaryCsv, GRID_METER_OTHER_KEY } from './TrendChartPivotShared';

// TZ-safe local-noon instants: day bucketing uses date-fns format() in the
// local timezone, so building instants from local Date components and
// serializing keeps every assertion independent of the machine's timezone.
const iso = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h, 0, 0, 0).toISOString();

const P1 = 'plant-1';
const meta2 = new Map([[P1, { names: ['Main Feed', 'Booster'], count: 2 }]]);
const mults12 = new Map([[P1, [1, 10]]]);

describe('computeGridMeterBreakdown — Grid by Meter side table', () => {
  it('Priority 1: multi-meter JSONB delta × per-meter CT multiplier', () => {
    const result = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 1), grid_meter_readings: { '0': 100, '1': 500 } },
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), grid_meter_readings: { '0': 150, '1': 520 } },
    ], { powerConfigMap: mults12, gridMeterMeta: meta2 });

    expect(result.multiPlant).toBe(false);
    expect(result.columns.map((c) => c.label)).toEqual(['Main Feed', 'Booster']);
    // Sep 1 has no predecessor — it seeds the baseline and accumulates no day.
    expect(result.dates).toEqual(['2026-09-02']);
    const row = result.byDate.get('2026-09-02')!;
    expect(row.values[`${P1}#0`]).toBe(50);   // (150 − 100) × 1
    expect(row.values[`${P1}#1`]).toBe(200);  // (520 − 500) × 10
    expect(row.total).toBe(250);
    expect(result.hasUnattributed).toBe(false);
  });

  it('Meter replacement: zero day, zero first-row-after, baseline reset after', () => {
    const result = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 1), grid_meter_readings: { '0': 900 } },
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), grid_meter_readings: { '0': 10 }, is_meter_replacement: true },
      { plant_id: P1, reading_datetime: iso(2026, 9, 3), grid_meter_readings: { '0': 20 } },
      { plant_id: P1, reading_datetime: iso(2026, 9, 4), grid_meter_readings: { '0': 30 } },
    ], { powerConfigMap: new Map([[P1, [1]]]), gridMeterMeta: new Map([[P1, { names: [], count: 1 }]]) });

    // Chart parity: the replacement day AND the first row after it contribute
    // nothing; deltas resume from the new meter's baseline on the row after
    // that (measured against 10, not the old meter's 900).
    expect(result.dates).toEqual(['2026-09-04']);
    expect(result.byDate.get('2026-09-04')!.total).toBe(10);
  });

  it('Priority 2: legacy single-meter delta × multArr[0], attributed to meter 0', () => {
    const result = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 1), meter_reading_kwh: 100 },
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), meter_reading_kwh: 160 },
    ], { powerConfigMap: new Map([[P1, [2]]]), gridMeterMeta: new Map([[P1, { names: [], count: 1 }]]) });

    const row = result.byDate.get('2026-09-02')!;
    expect(row.values[`${P1}#0`]).toBe(120); // (160 − 100) × 2
    expect(row.total).toBe(120);
    expect(result.hasUnattributed).toBe(false);
  });

  it('Priorities 3/4: stored daily totals land in the Other (unattributed) bucket', () => {
    const result = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), daily_grid_kwh: 500 },
    ], { gridMeterMeta: new Map([[P1, { names: [], count: 1 }]]) });

    const row = result.byDate.get('2026-09-02')!;
    expect(row.total).toBe(500);
    expect(row.values[GRID_METER_OTHER_KEY]).toBe(500);
    expect(result.hasUnattributed).toBe(true);
  });

  it('daily_consumption_kwh fallback is multiplied by multArr[0] (chart parity)', () => {
    const result = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), daily_consumption_kwh: 11 },
    ], { powerConfigMap: new Map([[P1, [2400]]]), gridMeterMeta: new Map([[P1, { names: [], count: 1 }]]) });

    expect(result.byDate.get('2026-09-02')!.total).toBe(26400);
  });

  it('Date window: out-of-window readings seed baselines but produce no rows', () => {
    const result = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 1), grid_meter_readings: { '0': 100 } },
      { plant_id: P1, reading_datetime: iso(2026, 9, 3), grid_meter_readings: { '0': 160 } },
    ], {
      powerConfigMap: new Map([[P1, [1]]]),
      gridMeterMeta: new Map([[P1, { names: [], count: 1 }]]),
      fromMs: new Date(2026, 8, 2, 0, 0, 0).getTime(),
      toMs: new Date(2026, 8, 4, 23, 59, 59).getTime(),
    });

    expect(result.dates).toEqual(['2026-09-03']);
    expect(result.byDate.get('2026-09-03')!.total).toBe(60);
  });

  it('Chart parity: days with a computed total <= 0 never accumulate (but seed the next delta)', () => {
    const result = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 1), grid_meter_readings: { '0': 200 } },
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), grid_meter_readings: { '0': 150 } }, // rollback → negative day
      { plant_id: P1, reading_datetime: iso(2026, 9, 3), grid_meter_readings: { '0': 160 } },
    ], { powerConfigMap: new Map([[P1, [1]]]), gridMeterMeta: new Map([[P1, { names: [], count: 1 }]]) });

    expect(result.dates).toEqual(['2026-09-03']);
    // Sep 3's delta is measured from Sep 2's baseline (150), not Sep 1's (200).
    expect(result.byDate.get('2026-09-03')!.total).toBe(10);
  });

  it('Multi-plant: columns prefixed with the plant short name, per-plant counts', () => {
    const result = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 1), grid_meter_readings: { '0': 10 } },
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), grid_meter_readings: { '0': 20 } },
      { plant_id: 'plant-2', reading_datetime: iso(2026, 9, 1), grid_meter_readings: { '0': 100, '1': 5 } },
      { plant_id: 'plant-2', reading_datetime: iso(2026, 9, 2), grid_meter_readings: { '0': 110, '1': 9 } },
    ], {
      plantNames: new Map([[P1, 'Alpha Plant'], ['plant-2', 'Beta Site']]),
      powerConfigMap: new Map([[P1, [1]], ['plant-2', [1, 1]]]),
      gridMeterMeta: new Map([
        [P1, { names: [], count: 1 }],
        ['plant-2', { names: ['Main', 'Tie'], count: 2 }],
      ]),
    });

    expect(result.multiPlant).toBe(true);
    expect(result.columns.map((c) => c.label)).toEqual([
      'Alpha · Grid Meter', // count 1 → singular fallback label
      'Beta · Main',
      'Beta · Tie',
    ]);
    const row = result.byDate.get('2026-09-02')!;
    // Alpha: (20 − 10) × 1 = 10 · Beta Main: (110 − 100) × 1 = 10 · Beta Tie: (9 − 5) × 1 = 4
    expect(row.total).toBe(24);
    expect(row.values['plant-1#0']).toBe(10);
    expect(row.values['plant-2#0']).toBe(10);
    expect(row.values['plant-2#1']).toBe(4);
  });
});

describe('buildKwhSummaryCsv — kWh Data Summary export', () => {
  it('exports both on-screen tables as labeled sections with matching display semantics', () => {
    const breakdown = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), grid_meter_readings: { '0': 100, '1': 500 } },
      { plant_id: P1, reading_datetime: iso(2026, 9, 3), grid_meter_readings: { '0': 150, '1': 520 } },
    ], { powerConfigMap: mults12, gridMeterMeta: meta2 });

    const overviewRows = [
      { date: 'Sep 1', kwh: 0, solarKwh: 0 },      // no data day → empty fields
      { date: 'Sep 2', kwh: 0, solarKwh: 0 },      // baseline-only day → empty
      { date: 'Sep 3', kwh: 250, solarKwh: 50 },   // real day
    ];
    const csv = buildKwhSummaryCsv(overviewRows, breakdown, ['2026-09-01', '2026-09-02', '2026-09-03']);
    const lines = csv.split('\n');

    // Section 1: Solar vs Grid
    expect(lines[0]).toBe('Solar vs Grid');
    expect(lines[1]).toBe('date,solar_kwh,grid_kwh,total_kwh,solar_pct');
    expect(lines[2]).toBe('Sep 1,,,,');
    expect(lines[3]).toBe('Sep 2,,,,');
    // solar 50 / total 300 → 16.7%
    expect(lines[4]).toBe('Sep 3,50,250,300,16.7');

    // Blank separator, then Section 2: Grid by Meter
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe('Grid by Meter');
    expect(lines[7]).toBe('date,Main Feed,Booster,total_kwh');
    // Days without per-meter rows export empty, aligned with section 1
    expect(lines[8]).toBe('Sep 1,,,');
    expect(lines[9]).toBe('Sep 2,,,');
    expect(lines[10]).toBe('Sep 3,50,200,250');
  });

  it('quotes meter labels containing commas and appends Other when unattributed days exist', () => {
    const breakdown = computeGridMeterBreakdown([
      { plant_id: P1, reading_datetime: iso(2026, 9, 2), daily_grid_kwh: 500 },
    ], { gridMeterMeta: new Map([[P1, { names: ['Feed, Main'], count: 1 }]]) });

    const csv = buildKwhSummaryCsv([{ date: 'Sep 2', kwh: 500, solarKwh: 0 }], breakdown, ['2026-09-02']);
    const lines = csv.split('\n');

    // Section 1: solar 0 → empty solar + empty pct, grid 500 kept
    expect(lines[2]).toBe('Sep 2,,500,500,');
    // Section 2: quoted label, unattributed residual in Other
    expect(lines[4]).toBe('Grid by Meter');
    expect(lines[5]).toBe('date,"Feed, Main",Other,total_kwh');
    expect(lines[6]).toBe('Sep 2,,500,500');
  });
});