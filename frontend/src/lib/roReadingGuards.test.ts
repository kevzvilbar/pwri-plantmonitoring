import { describe, it, expect } from 'vitest';
import {
  computeROAverageFlowRate,
  evaluateROMeterSpike,
  evaluatePhaseImbalance,
  evaluatePhaseLoss,
  dpPsi,
  type ROMeterKind,
} from './roReadingGuards';
import type { RatePoint } from './flowRateGuards';
import { ALERTS } from './calculations';

describe('computeROAverageFlowRate', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  it('delegates to computeRollingAverageRate (thin wrapper, sanity check only)', () => {
    const points: RatePoint[] = [
      { value: 0, at: hoursAgo(48) },
      { value: 100, at: hoursAgo(24) },
      { value: 200, at: hoursAgo(0) },
    ];
    expect(computeROAverageFlowRate(points, 10)).toBeCloseTo(100 / 24, 5);
  });

  it('returns null with fewer than two in-window points, same as the underlying rolling-average function', () => {
    expect(computeROAverageFlowRate([{ value: 10, at: hoursAgo(1) }], 10)).toBeNull();
  });
});

describe('evaluateROMeterSpike', () => {
  const KINDS: ROMeterKind[] = ['feed', 'permeate', 'reject'];

  it('is ok when the rate is within the multiplier band, for every meter kind', () => {
    for (const kind of KINDS) {
      // 50 m3 over 10h = 5 m3/hr, avg 4 m3/hr -> 1.25x, under the 2.0x default multiplier
      const r = evaluateROMeterSpike(kind, 50, 10, 4);
      expect(r.tier).toBe('ok');
      expect(r.detail).toBe('');
      expect(r.label).toBe(kind[0].toUpperCase() + kind.slice(1));
    }
  });

  it('flags critical once the default 2.0x multiplier is cleared, and names the correct meter in the detail string', () => {
    // 100 m3 over 10h = 10 m3/hr, avg 4 m3/hr -> 2.5x > 2.0x default
    const r = evaluateROMeterSpike('reject', 100, 10, 4);
    expect(r.tier).toBe('critical');
    expect(r.direction).toBe('high');
    expect(r.detail).toContain('Reject flow rate');
    expect(r.detail).toContain('mis-keyed meter value');
  });

  it('reproduces the exact motivating bug: a mis-keyed cumulative reading producing an absurd implied rate', () => {
    // From this module's own header comment: 2,153,677 mis-keyed instead of
    // ~660,977 -> delta 1,493,203 m3 over roughly 3.65h (409,096.71 m3/h implied).
    const r = evaluateROMeterSpike('feed', 1_493_203, 3.65, 50);
    expect(r.tier).toBe('critical');
    expect(r.rate).toBeCloseTo(409_096.71, 1);
  });

  it('needs_remark for a deviation between the ±50% band and the critical multiplier', () => {
    // 8 m3/hr vs 4 m3/hr avg = 2x deviation in the classifyDeviation sense
    // (100% above), under the 2.0x multiplier boundary used by classifyDeviation
    // (which compares avg*multiplier, i.e. 8 m3/hr is exactly at 2.0x -> critical
    // territory at 2.0 itself is inclusive per classifyDeviation's own contract;
    // use 7 m3/hr instead to land cleanly inside needs_remark).
    const r = evaluateROMeterSpike('permeate', 70, 10, 4); // 7 m3/hr vs 4 -> 75% above, <2.0x
    expect(r.tier).toBe('needs_remark');
    expect(r.detail).toContain('remark required before saving');
  });

  it('is ok when there is no average yet to compare against (new train / insufficient history)', () => {
    const r = evaluateROMeterSpike('feed', 500, 10, null);
    expect(r.tier).toBe('ok');
  });

  it('is ok when currentDelta or hoursElapsed is missing (computeRate returns null upstream)', () => {
    expect(evaluateROMeterSpike('feed', null, 10, 4).tier).toBe('ok');
    expect(evaluateROMeterSpike('feed', 100, null, 4).tier).toBe('ok');
  });

  it('respects a custom multiplier override instead of the ALERTS default', () => {
    // avg=4 m3/hr. 7 m3/hr is +75% (outside the ±50% ok-band either way).
    //   - custom multiplier 1.7x -> threshold 6.8 m3/hr -> 7.0 clears it -> critical
    //   - ALERTS default 2.0x -> threshold 8.0 m3/hr -> 7.0 stays under it -> needs_remark
    // (A multiplier below 1.5x can never surface as 'critical' at all, since
    // the ±50% ok-band is checked first and swallows anything under 1.5x avg
    // regardless of multiplier — not exercised here, but worth knowing before
    // tuning ALERTS.ro_meter_spike_multiplier below 1.5 and expecting it to bite.)
    const strict = evaluateROMeterSpike('feed', 70, 10, 4, 1.7);
    expect(strict.tier).toBe('critical');
    const relaxed = evaluateROMeterSpike('feed', 70, 10, 4, ALERTS.ro_meter_spike_multiplier);
    expect(relaxed.tier).toBe('needs_remark');
  });

  it('low-side deviation is flagged as needs_remark, never escalated to critical (mirrors classifyDeviation)', () => {
    // 1 m3/hr vs 10 m3/hr avg — a large drop, but low-side never auto-critical.
    const r = evaluateROMeterSpike('permeate', 10, 10, 10);
    expect(r.tier).toBe('needs_remark');
    expect(r.direction).toBe('low');
    expect(r.detail).toContain('below the 10-day average');
  });
});

describe('evaluatePhaseImbalance', () => {
  it('is ok with balanced phases', () => {
    const r = evaluatePhaseImbalance(10, 10, 10);
    expect(r.tier).toBe('ok');
    expect(r.pct).toBe(0);
  });

  it('returns null pct (not ok/0) when fewer than two phases have usable data', () => {
    expect(evaluatePhaseImbalance(10, null, null)).toEqual({ pct: null, tier: 'ok' });
    expect(evaluatePhaseImbalance(null, null, null)).toEqual({ pct: null, tier: 'ok' });
    // Zero/negative readings are filtered out same as null (not a "real" phase reading).
    expect(evaluatePhaseImbalance(10, 0, -5)).toEqual({ pct: null, tier: 'ok' });
  });

  it(`is a warning at the ALERTS threshold (${ALERTS.pump_phase_imbalance_warn_pct}%) and ok just below it`, () => {
    // L1=10.5, L2=9.5, L3=10 -> avg=10, spread=1 -> pct=10% exactly.
    const atThreshold = evaluatePhaseImbalance(10.5, 9.5, 10);
    expect(atThreshold.pct).toBeCloseTo(ALERTS.pump_phase_imbalance_warn_pct, 5);
    expect(atThreshold.tier).toBe('warning');

    // L1=10.45, L2=9.55, L3=10 -> spread=0.9 -> pct=9%, just under the threshold.
    const belowThreshold = evaluatePhaseImbalance(10.45, 9.55, 10);
    expect(belowThreshold.tier).toBe('ok');
  });

  it(`is critical at the ALERTS threshold (${ALERTS.pump_phase_imbalance_critical_pct}%)`, () => {
    // L1=20, L2=L3=10 -> avg=13.33, (20-10)/13.33*100 = 75% >> critical threshold
    const r = evaluatePhaseImbalance(20, 10, 10);
    expect(r.tier).toBe('critical');
    expect(r.pct).toBeGreaterThanOrEqual(ALERTS.pump_phase_imbalance_critical_pct);
  });

  it('computes pct as (max-min)/avg — scale-invariant, same tier for a 10x-larger pump drawing proportionally the same imbalance', () => {
    const small = evaluatePhaseImbalance(11, 10, 9);   // avg 10, spread 2 -> 20%
    const large = evaluatePhaseImbalance(110, 100, 90); // avg 100, spread 20 -> 20%
    expect(small.pct).toBeCloseTo(large.pct!, 5);
    expect(small.tier).toBe(large.tier);
  });
});

describe('evaluatePhaseLoss', () => {
  it('is false when all three phases are running', () => {
    expect(evaluatePhaseLoss(10, 10, 10)).toBe(false);
  });

  it('is false when all three phases are dead (pump simply off, not single-phasing)', () => {
    expect(evaluatePhaseLoss(0, 0, 0)).toBe(false);
    expect(evaluatePhaseLoss(null, null, null)).toBe(false);
  });

  it('is true when exactly one phase has dropped while the others are still running', () => {
    expect(evaluatePhaseLoss(10, 10, 0)).toBe(true);
    expect(evaluatePhaseLoss(10, 0, 10)).toBe(true);
  });

  it('is true when two phases have dropped and one is still running', () => {
    expect(evaluatePhaseLoss(10, 0, 0)).toBe(true);
  });

  it('respects a custom runningThresholdAmps instead of the 2A default', () => {
    // 1.5A would count as "running" under the default 2A floor... no, 1.5 < 2,
    // so under the default it's already "dead". Use a lowered threshold to
    // flip it to "running" and confirm the override actually takes effect.
    expect(evaluatePhaseLoss(1.5, 10, 10)).toBe(true);  // default threshold: 1.5A reads as dead -> phase loss
    expect(evaluatePhaseLoss(1.5, 10, 10, 1)).toBe(false); // lowered threshold: 1.5A now reads as running
  });

  it('treats null/undefined the same as a dead (0A) phase', () => {
    expect(evaluatePhaseLoss(undefined, 10, 10)).toBe(true);
    expect(evaluatePhaseLoss(null, 10, 10)).toBe(true);
  });
});

describe('dpPsi', () => {
  it('subtracts outlet from inlet, rounded to 2 decimals', () => {
    expect(dpPsi(45.678, 40.111)).toBe(5.57);
  });

  it('allows a negative differential (outlet reading higher than inlet — flags a real anomaly upstream, not this function\'s job to reject)', () => {
    expect(dpPsi(30, 35)).toBe(-5);
  });

  it('returns null when either input is missing or non-finite', () => {
    expect(dpPsi(null, 40)).toBeNull();
    expect(dpPsi(40, null)).toBeNull();
    expect(dpPsi(undefined, 40)).toBeNull();
    expect(dpPsi(NaN, 40)).toBeNull();
    expect(dpPsi(40, Infinity)).toBeNull();
  });

  it('handles zero correctly (falsy but valid)', () => {
    expect(dpPsi(0, 0)).toBe(0);
    expect(dpPsi(10, 0)).toBe(10);
  });
});
