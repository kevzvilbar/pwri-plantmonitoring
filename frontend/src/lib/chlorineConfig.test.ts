import { describe, it, expect } from 'vitest';
import {
  CHLORINE_CONFIG,
  classifyChlorineReading,
  detectChlorineGaps,
  computeChlorineStats,
  type RawChlorinePoint,
} from './chlorineConfig';

const pt = (iso: string, v: number | null, extra: Partial<RawChlorinePoint> = {}): RawChlorinePoint => ({
  train_id: 'RO5',
  reading_datetime: iso,
  chlorine_residual_mg_l: v,
  ...extra,
});

describe('CHLORINE_CONFIG', () => {
  it('matches the confirmed plan values', () => {
    expect(CHLORINE_CONFIG.min_limit).toBe(0.3);
    expect(CHLORINE_CONFIG.max_limit).toBe(1.5);
    expect(CHLORINE_CONFIG.suspect_threshold).toBe(3.0);
    expect(CHLORINE_CONFIG.gap_threshold_minutes).toEqual({ operator: 120, management: 240 });
  });
});

describe('classifyChlorineReading', () => {
  it('classifies boundaries inclusively inside the band', () => {
    expect(classifyChlorineReading(0.3)).toBe('in_range');
    expect(classifyChlorineReading(1.5)).toBe('in_range');
    expect(classifyChlorineReading(0.29)).toBe('below_min');
    expect(classifyChlorineReading(1.51)).toBe('above_max');
    expect(classifyChlorineReading(3.0)).toBe('above_max');
    expect(classifyChlorineReading(3.01)).toBe('suspect');
    expect(classifyChlorineReading(8.3)).toBe('suspect');
  });
  it('never treats null/NaN as 0', () => {
    expect(classifyChlorineReading(null)).toBe('missing');
    expect(classifyChlorineReading(undefined)).toBe('missing');
    expect(classifyChlorineReading(NaN)).toBe('missing');
  });
});

describe('detectChlorineGaps', () => {
  const pts = [
    pt('2026-10-08T00:00:00Z', 1),
    pt('2026-10-08T02:00:00Z', 1),
    pt('2026-10-08T04:01:00Z', 1),
  ];
  it('uses a strict > threshold (exactly 2h is not a gap)', () => {
    expect(detectChlorineGaps(pts, 120)).toHaveLength(1);
    expect(detectChlorineGaps(pts, 240)).toHaveLength(0);
  });
  it('detects gaps per train, not across trains', () => {
    const mixed = [
      pt('2026-10-08T00:00:00Z', 1, { train_id: 'A' }),
      pt('2026-10-08T01:00:00Z', 1, { train_id: 'B' }),
      pt('2026-10-08T05:00:00Z', 1, { train_id: 'B' }),
    ];
    const gaps = detectChlorineGaps(mixed, 120);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].train_id).toBe('B');
    expect(gaps[0].duration_hours).toBe(4);
  });
  it('returns [] for empty input', () => {
    expect(detectChlorineGaps([], 120)).toEqual([]);
  });
});

describe('computeChlorineStats', () => {
  it('excludes unverified suspect readings (the Oct 7 8.30 case)', () => {
    const st = computeChlorineStats([pt('2026-10-07T10:00:00Z', 8.3), pt('2026-10-08T01:00:00Z', 1.2)]);
    expect(st.suspectCount).toBe(1);
    expect(st.validCount).toBe(1);
    expect(st.avgResidual).toBe(1.2);
  });
  it('counts a verified suspect reading as a real exceedance', () => {
    const st = computeChlorineStats([pt('2026-10-07T10:00:00Z', 8.3, { verified: true })]);
    expect(st.suspectCount).toBe(0);
    expect(st.aboveMaxCount).toBe(1);
  });
  it('ignores missing values entirely', () => {
    const st = computeChlorineStats([pt('2026-10-08T00:00:00Z', null), pt('2026-10-08T01:00:00Z', 0.9)]);
    expect(st.totalCount).toBe(1);
    expect(st.compliancePct).toBe(100);
  });
});

import { computeDailyChlorineAverages, summarizeChlorineGaps, latestChlorineByTrain, buildHourlyChlorineByTrain, NO_RESIDUAL_MG_L } from './chlorineConfig';

describe('computeDailyChlorineAverages', () => {
  it('averages per Plant (Manila) day, excluding unverified suspect values', () => {
    const days = computeDailyChlorineAverages([
      pt('2026-10-07T01:00:00Z', 1.0),
      pt('2026-10-07T05:00:00Z', 1.4),
      pt('2026-10-07T06:00:00Z', 8.3), // suspect, excluded
      pt('2026-10-08T01:00:00Z', 1.2, { train_id: 'RO7' }),
    ]);
    expect(days).toHaveLength(2);
    expect(days[0].dateKey).toBe('2026-10-07');
    expect(days[0].overall).toBe(1.2);
    expect(days[0].overallCount).toBe(2);
    expect(days[1].perTrain.RO7.avg).toBe(1.2);
  });
  it('uses Manila day boundaries (16:30Z is already the next Manila day)', () => {
    const days = computeDailyChlorineAverages([pt('2026-10-07T16:30:00Z', 1.0)]);
    expect(days[0].dateKey).toBe('2026-10-08');
  });
  it('returns empty days as null so lines can break, not bridge', () => {
    const days = computeDailyChlorineAverages([pt('2026-10-05T02:00:00Z', 1.0), pt('2026-10-08T02:00:00Z', 1.1)]);
    expect(days.map((d) => d.overall)).toEqual([1.0, null, null, 1.1]);
  });
  it('counts a verified suspect reading', () => {
    const days = computeDailyChlorineAverages([pt('2026-10-07T02:00:00Z', 8.3, { verified: true })]);
    expect(days[0].overall).toBe(8.3);
  });
  it('returns [] when nothing is valid', () => {
    expect(computeDailyChlorineAverages([pt('2026-10-07T02:00:00Z', null)])).toEqual([]);
  });
});

describe('daily min/max and hidden excursions', () => {
  it('exposes min, max and per-day out-of-range counts that a mean would hide', () => {
    const [d] = computeDailyChlorineAverages([
      pt('2026-10-07T01:00:00Z', 0.2),
      pt('2026-10-07T03:00:00Z', 1.0),
      pt('2026-10-07T05:00:00Z', 1.6),
      pt('2026-10-07T07:00:00Z', 1.2),
    ]);
    expect(d.overall).toBe(1);
    expect(d.min).toBe(0.2);
    expect(d.max).toBe(1.6);
    expect(d.belowCount).toBe(1);
    expect(d.aboveCount).toBe(1);
  });
  it('tracks no-residual readings and gives the average without them', () => {
    const [d] = computeDailyChlorineAverages([pt('2026-10-07T01:00:00Z', 0), pt('2026-10-07T03:00:00Z', 1.2)]);
    expect(NO_RESIDUAL_MG_L).toBeGreaterThan(0);
    expect(d.overall).toBe(0.6);
    expect(d.noResidualCount).toBe(1);
    expect(d.overallExclNoResidual).toBe(1.2);
  });
  it('has null min/max on days with no valid reading', () => {
    const days = computeDailyChlorineAverages([pt('2026-10-05T02:00:00Z', 1.0), pt('2026-10-07T02:00:00Z', 1.1)]);
    expect(days[1]).toMatchObject({ overall: null, min: null, max: null, belowCount: 0, aboveCount: 0 });
  });
});

describe('summarizeChlorineGaps', () => {
  it('returns zeros for no gaps', () => {
    expect(summarizeChlorineGaps([])).toEqual({ count: 0, longestMinutes: 0, longestHours: 0, longestTrainName: null });
  });
  it('reports count and the longest gap', () => {
    const gaps = detectChlorineGaps(
      [
        pt('2026-10-07T00:00:00Z', 1.0),
        pt('2026-10-07T03:00:00Z', 1.0),
        pt('2026-10-07T13:00:00Z', 1.0),
      ],
      120,
    );
    const sum = summarizeChlorineGaps(gaps);
    expect(sum.count).toBe(2);
    expect(sum.longestHours).toBe(10);
  });
});

describe('latestChlorineByTrain', () => {
  it('returns the latest valid reading per train, sorted by name', () => {
    const r = latestChlorineByTrain([
      pt('2026-10-08T01:00:00Z', 1.0, { train_id: 'B', train_name: 'RO 2' }),
      pt('2026-10-08T03:00:00Z', 1.2, { train_id: 'B', train_name: 'RO 2' }),
      pt('2026-10-08T02:00:00Z', 0.9, { train_id: 'A', train_name: 'RO 1' }),
    ]);
    expect(r.map((x) => [x.train_name, x.value])).toEqual([['RO 1', 0.9], ['RO 2', 1.2]]);
    expect(r[0].status).toBe('in_range');
  });
  it('reports how far each train trails the newest reading of any train', () => {
    const r = latestChlorineByTrain([
      pt('2026-10-08T01:00:00Z', 1.0, { train_id: 'A', train_name: 'RO 1' }),
      pt('2026-10-08T04:00:00Z', 1.0, { train_id: 'B', train_name: 'RO 2' }),
    ]);
    expect(r.find((x) => x.train_id === 'A')?.behindMinutes).toBe(180);
    expect(r.find((x) => x.train_id === 'B')?.behindMinutes).toBe(0);
  });
  it('never reports an unverified suspect as latest; attaches it as newerSuspect', () => {
    const [r] = latestChlorineByTrain([
      pt('2026-10-08T01:00:00Z', 1.1),
      pt('2026-10-08T02:00:00Z', 8.3),
    ]);
    expect(r.value).toBe(1.1);
    expect(r.newerSuspect?.value).toBe(8.3);
  });
  it('uses a verified suspect as a normal latest value', () => {
    const [r] = latestChlorineByTrain([pt('2026-10-08T02:00:00Z', 8.3, { verified: true })]);
    expect(r.value).toBe(8.3);
    expect(r.newerSuspect).toBeNull();
  });
  it('ignores null readings and returns [] when nothing is valid', () => {
    expect(latestChlorineByTrain([pt('2026-10-08T02:00:00Z', null)])).toEqual([]);
  });
});

describe('buildHourlyChlorineByTrain (hourly is never combined)', () => {
  it('keeps one value per train per hour instead of averaging trains together', () => {
    const { rows, series } = buildHourlyChlorineByTrain([
      pt('2026-10-08T01:10:00Z', 0.5, { train_id: 'A' }),
      pt('2026-10-08T01:40:00Z', 0.7, { train_id: 'A' }),
      pt('2026-10-08T01:20:00Z', 1.4, { train_id: 'B' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]['val:A']).toBe(0.6); // A's own hourly mean
    expect(rows[0]['val:B']).toBe(1.4); // B untouched by A
    expect(rows[0]['n:A']).toBe(2);
    expect(series.map((x) => x.trainId).sort()).toEqual(['A', 'B']);
  });
  it('excludes unverified suspects and missing values, but keeps verified ones', () => {
    const { rows } = buildHourlyChlorineByTrain([
      pt('2026-10-08T01:00:00Z', 1.0),
      pt('2026-10-08T01:30:00Z', 8.3),                   // suspect, excluded
      pt('2026-10-08T02:00:00Z', null),                  // missing
      pt('2026-10-08T03:00:00Z', 8.3, { verified: true }), // verified, kept
    ]);
    expect(rows.map((r) => r['val:RO5'])).toEqual([1.0, 8.3]);
  });
  it('starts a new segment (line break) after a gap longer than the limit, not before', () => {
    const base = [
      pt('2026-10-08T00:00:00Z', 1.0),
      pt('2026-10-08T02:00:00Z', 1.0), // exactly 2h: still connected
      pt('2026-10-08T05:00:00Z', 1.0), // 3h later: break
    ];
    const { series } = buildHourlyChlorineByTrain(base, 120);
    expect(series.map((x) => x.key)).toEqual(['RO5::0', 'RO5::1']);
    const { series: wide } = buildHourlyChlorineByTrain(base, 240); // management 4h
    expect(wide.map((x) => x.key)).toEqual(['RO5::0']);
  });
  it('returns empty output when nothing is valid', () => {
    expect(buildHourlyChlorineByTrain([pt('2026-10-08T00:00:00Z', null)])).toEqual({ rows: [], series: [] });
  });
});
