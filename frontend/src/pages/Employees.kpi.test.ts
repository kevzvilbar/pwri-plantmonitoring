import { describe, it, expect } from 'vitest';
import { computeEntityOverallScore, type EntityTypeScore } from './Employees';

describe('computeEntityOverallScore (Phase 1 KPI scoring redesign)', () => {
  const days = ['2026-09-01', '2026-09-02', '2026-09-03'];
  const todayStr = '2026-09-03';

  it('correctly computes 60% Individual (RO) + 40% Shared weighted score', () => {
    // Shared categories: Wells (100%), Locator (100%), Prod. Meter (100%), Solar (100%), Grid (100%), Chem (100%) -> sharedAvg = 1.0 (100%)
    // RO Train: 80% diligence (0.8)
    // Overall: 0.6 * 0.8 + 0.4 * 1.0 = 0.48 + 0.40 = 0.88 -> 88%
    const ts: EntityTypeScore = {
      wells: { '2026-09-01': 1, '2026-09-02': 1, '2026-09-03': 1 },
      locator: { '2026-09-01': 1, '2026-09-02': 1, '2026-09-03': 1 },
      product_meter: { '2026-09-01': 1, '2026-09-02': 1, '2026-09-03': 1 },
      solar: { '2026-09-01': 1, '2026-09-02': 1, '2026-09-03': 1 },
      grid: { '2026-09-01': 1, '2026-09-02': 1, '2026-09-03': 1 },
      chemicals: { '2026-09-01': 1, '2026-09-02': 1, '2026-09-03': 1 },
      ro_train: { '2026-09-01': 0.8, '2026-09-02': 0.8, '2026-09-03': 0.8 },
    };

    const res = computeEntityOverallScore(ts, days, todayStr);
    expect(res.scorePct).toBe(88);
    expect(res.roAvg).toBeCloseTo(0.8);
    expect(res.sharedAvg).toBeCloseTo(1.0);
    expect(res.tier.tier).toBe('Exceeds Expectations');
  });

  it('weights 100% on shared when facility has no RO trains (ro_train is null)', () => {
    const ts: EntityTypeScore = {
      wells: { '2026-09-01': 0.9, '2026-09-02': 0.9 },
      locator: { '2026-09-01': 1.0, '2026-09-02': 1.0 },
      ro_train: { '2026-09-01': null, '2026-09-02': null },
    };

    const res = computeEntityOverallScore(ts, ['2026-09-01', '2026-09-02'], todayStr);
    // catAvgs: Wells 0.9, Locator 1.0 -> sharedAvg = 0.95 -> 95%
    expect(res.scorePct).toBe(95);
    expect(res.roAvg).toBeNull();
    expect(res.sharedAvg).toBeCloseTo(0.95);
    expect(res.tier.tier).toBe('Outstanding');
  });

  it('weights 100% on RO when only RO trains exist (shared categories are null)', () => {
    const ts: EntityTypeScore = {
      ro_train: { '2026-09-01': 0.75, '2026-09-02': 0.85 },
      wells: { '2026-09-01': null, '2026-09-02': null },
    };

    const res = computeEntityOverallScore(ts, ['2026-09-01', '2026-09-02'], todayStr);
    expect(res.scorePct).toBe(80);
    expect(res.roAvg).toBeCloseTo(0.8);
    expect(res.sharedAvg).toBeNull();
    expect(res.tier.tier).toBe('Exceeds Expectations');
  });

  it('returns totalValid = 0 when operator is off duty on all days', () => {
    const ts: EntityTypeScore = {
      wells: { '2026-09-01': null, '2026-09-02': null },
      ro_train: { '2026-09-01': null, '2026-09-02': null },
    };

    const res = computeEntityOverallScore(ts, ['2026-09-01', '2026-09-02'], todayStr);
    expect(res.totalValid).toBe(0);
    expect(res.scorePct).toBe(0);
    expect(res.roAvg).toBeNull();
    expect(res.sharedAvg).toBeNull();
  });

  it('ignores off-duty null days so rest days do not drag down appraisal score', () => {
    // 3 days period: Day 1 & 2 operator was off duty (null).
    // Day 3 operator was on duty: RO Train 100%, Wells 100%.
    const ts: EntityTypeScore = {
      wells: { '2026-09-01': null, '2026-09-02': null, '2026-09-03': 1.0 },
      ro_train: { '2026-09-01': null, '2026-09-02': null, '2026-09-03': 1.0 },
    };

    const res = computeEntityOverallScore(ts, days, todayStr);
    expect(res.scorePct).toBe(100);
    expect(res.tier.tier).toBe('Outstanding');
  });
});
