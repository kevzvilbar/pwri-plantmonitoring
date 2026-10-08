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
