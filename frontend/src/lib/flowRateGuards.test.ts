import { describe, it, expect } from 'vitest';
import {
  computeRate,
  computeRollingAverageRate,
  computeRollingAverageRateFromDeltas,
  classifyDeviation,
  formatDeviationMessage,
  ANOMALY_REMARK_BAND_PCT,
  MIN_ELAPSED_HOURS,
  type RatePoint,
  type VolumePoint,
} from './flowRateGuards';

describe('computeRate', () => {
  it('divides volume by elapsed time', () => {
    expect(computeRate(100, 10)).toBe(10);
  });

  it('returns null for non-positive volume', () => {
    expect(computeRate(0, 10)).toBeNull();
    expect(computeRate(-5, 10)).toBeNull();
  });

  it('returns null when elapsed time is under the minimum floor', () => {
    // 100 m3 in 6 minutes would imply an absurd 1000 m3/hr rate — reject it
    // rather than let a near-zero denominator blow up the result.
    expect(computeRate(100, 0.1)).toBeNull();
    expect(computeRate(100, MIN_ELAPSED_HOURS - 0.01)).toBeNull();
    expect(computeRate(100, MIN_ELAPSED_HOURS)).toBe(100 / MIN_ELAPSED_HOURS);
  });

  it('returns null for non-finite or missing inputs', () => {
    expect(computeRate(null, 10)).toBeNull();
    expect(computeRate(100, null)).toBeNull();
    expect(computeRate(NaN, 10)).toBeNull();
  });
});

describe('computeRollingAverageRate', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  it('averages per-pair rates, not raw deltas — different gap lengths stay comparable', () => {
    // Pair 1: 100 m3 over 24h -> 4.17 m3/hr. Pair 2: 100 m3 over 48h (a
    // missed day in between) -> 2.08 m3/hr. A naive average-of-deltas would
    // treat both deltas as equally "normal" despite very different rates;
    // this should reflect that the second period was actually half the rate.
    const points: RatePoint[] = [
      { value: 0, at: hoursAgo(72) },
      { value: 100, at: hoursAgo(48) }, // +100 over 24h
      { value: 200, at: hoursAgo(0) },  // +100 over 48h
    ];
    const avg = computeRollingAverageRate(points, 10);
    expect(avg).toBeCloseTo((100 / 24 + 100 / 48) / 2, 5);
  });

  it('excludes points outside the window before pairing', () => {
    const points: RatePoint[] = [
      { value: 0, at: hoursAgo(24 * 30) }, // 30 days ago — outside a 10-day window
      { value: 500, at: hoursAgo(24 * 9) },
      { value: 600, at: hoursAgo(24 * 8) }, // +100 over 24h -> 4.17 m3/hr
    ];
    const avg = computeRollingAverageRate(points, 10);
    // Only one valid pair inside the window.
    expect(avg).toBeCloseTo(100 / 24, 5);
  });

  it('returns null when fewer than two points fall in the window', () => {
    expect(computeRollingAverageRate([{ value: 10, at: hoursAgo(1) }], 10)).toBeNull();
    expect(computeRollingAverageRate([], 10)).toBeNull();
  });

  it('skips pairs under the minimum elapsed-time floor instead of polluting the average', () => {
    const points: RatePoint[] = [
      { value: 0, at: hoursAgo(48) },
      { value: 100, at: hoursAgo(24) },       // +100 over 24h -> valid
      { value: 100.01, at: hoursAgo(23.99) }, // +0.01 over ~1 min -> below floor, skipped
    ];
    const avg = computeRollingAverageRate(points, 10);
    expect(avg).toBeCloseTo(100 / 24, 5);
  });
});

describe('computeRollingAverageRateFromDeltas', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  it('divides each stored volume by the gap since the PREVIOUS entry, not a fixed period', () => {
    // This is the exact bug this function replaces: two 100 m3 entries look
    // identical if you just average the volumes, but one covers a 24h gap
    // (a normal day) and the other covers a 72h gap (two missed days) — very
    // different actual rates.
    const points: VolumePoint[] = [
      { volume: 100, at: hoursAgo(96) }, // no previous point in range -> excluded from rate calc
      { volume: 100, at: hoursAgo(72) }, // 24h since previous -> 4.17 m3/hr
      { volume: 100, at: hoursAgo(0) },  // 72h since previous -> 1.39 m3/hr
    ];
    const avg = computeRollingAverageRateFromDeltas(points, 10);
    expect(avg).toBeCloseTo((100 / 24 + 100 / 72) / 2, 5);
  });

  it('a naive average-of-volumes would have hidden the slowdown this catches', () => {
    const points: VolumePoint[] = [
      { volume: 100, at: hoursAgo(48) },
      { volume: 100, at: hoursAgo(24) }, // 24h gap -> 4.17 m3/hr
      { volume: 100, at: hoursAgo(0) },  // 24h gap -> 4.17 m3/hr
    ];
    const naiveAvgVolume = 100; // what the old per-page logic computed
    const avgRate = computeRollingAverageRateFromDeltas(points, 10);
    expect(avgRate).toBeCloseTo(100 / 24, 5);
    expect(avgRate).not.toBeCloseTo(naiveAvgVolume, 0);
  });

  it('returns null when fewer than two points fall in the window', () => {
    expect(computeRollingAverageRateFromDeltas([{ volume: 50, at: hoursAgo(1) }], 10)).toBeNull();
    expect(computeRollingAverageRateFromDeltas([], 10)).toBeNull();
  });

  it('excludes points outside the window before pairing', () => {
    const points: VolumePoint[] = [
      { volume: 100, at: hoursAgo(24 * 30) }, // outside a 10-day window
      { volume: 50, at: hoursAgo(24 * 9) },
      { volume: 100, at: hoursAgo(24 * 8) }, // 24h since previous IN-WINDOW point
    ];
    const avg = computeRollingAverageRateFromDeltas(points, 10);
    expect(avg).toBeCloseTo(100 / 24, 5);
  });
});

describe('classifyDeviation', () => {
  it('is ok within the ±75% band', () => {
    expect(classifyDeviation(12, 10, 2.5).tier).toBe('ok'); // +20%
    expect(classifyDeviation(4, 10, 2.5).tier).toBe('ok');  // -60%
    expect(classifyDeviation(17.5, 10, 2.5).tier).toBe('ok'); // exactly +75%, inclusive
  });

  it('requires a remark just outside the band on the high side, below the critical multiplier', () => {
    const r = classifyDeviation(20, 10, 2.5); // +100%, under 2.5x
    expect(r.tier).toBe('needs_remark');
    expect(r.direction).toBe('high');
    expect(r.deviationPct).toBe(100);
  });

  it('escalates to critical once the per-meter-type multiplier is cleared', () => {
    const r = classifyDeviation(26, 10, 2.5); // 2.6x > 2.5x threshold
    expect(r.tier).toBe('critical');
    expect(r.direction).toBe('high');
  });

  it('requires a remark on the low side but never auto-escalates to critical', () => {
    const r = classifyDeviation(1, 10, 2.5); // -90%, far below average
    expect(r.tier).toBe('needs_remark');
    expect(r.direction).toBe('low');
  });

  it('is ok when there is no usable average yet', () => {
    expect(classifyDeviation(50, null, 2.5).tier).toBe('ok');
    expect(classifyDeviation(null, 10, 2.5).tier).toBe('ok');
    expect(classifyDeviation(50, 0, 2.5).tier).toBe('ok');
  });

  it(`the remark band matches the documented ${ANOMALY_REMARK_BAND_PCT}% constant`, () => {
    const justInside = 10 * (1 + ANOMALY_REMARK_BAND_PCT / 100);
    const justOutside = justInside + 0.01;
    expect(classifyDeviation(justInside, 10, 99).tier).toBe('ok');
    expect(classifyDeviation(justOutside, 10, 99).tier).toBe('needs_remark');
  });
});

describe('formatDeviationMessage', () => {
  it('returns empty string for ok', () => {
    const ok = classifyDeviation(10, 10, 2.5);
    expect(formatDeviationMessage('Reject', ok, 'm3/hr', 10)).toBe('');
  });

  it('formats a needs_remark message with the remark-required suffix', () => {
    const r = classifyDeviation(20, 10, 2.5);
    const msg = formatDeviationMessage('Reject', r, 'm3/hr', 10);
    expect(msg).toContain('Reject flow rate 20.0 m³/hr is 100% above the 10-day average (10.0 m³/hr)');
    expect(msg).toContain('remark required before saving');
  });

  it('formats a critical message with the supervisor-review suffix', () => {
    const r = classifyDeviation(30, 10, 2.5);
    const msg = formatDeviationMessage('Reject', r, 'm3/hr', 10);
    expect(msg).toContain('sent for supervisor review');
  });

  it('uses "rate" instead of "flow rate" for kWh', () => {
    const r = classifyDeviation(20, 10, 2.0);
    const msg = formatDeviationMessage('Power', r, 'kwh/hr', 14);
    expect(msg).toMatch(/^Power rate /);
    expect(msg).not.toContain('flow rate');
  });

  it('escalates=false swaps the critical suffix so it never promises a review that will not happen', () => {
    const r = classifyDeviation(30, 10, 2.5); // critical
    const escalating = formatDeviationMessage('Reject', r, 'm3/hr', 10, true);
    const notEscalating = formatDeviationMessage('Reject', r, 'm3/hr', 10, false);
    expect(escalating).toContain('sent for supervisor review');
    expect(notEscalating).not.toContain('sent for supervisor review');
    expect(notEscalating).toContain('double-check before saving');
  });

  it('escalates has no effect on needs_remark — that tier never claims to escalate either way', () => {
    const r = classifyDeviation(20, 10, 2.5); // needs_remark, not critical
    const escalating = formatDeviationMessage('Reject', r, 'm3/hr', 10, true);
    const notEscalating = formatDeviationMessage('Reject', r, 'm3/hr', 10, false);
    expect(escalating).toBe(notEscalating);
    expect(escalating).toContain('remark required before saving');
  });

  it('formats backward / negative rate with multiplier & rollover warning', () => {
    const r = classifyDeviation(-500, 50, 2.5);
    expect(r.tier).toBe('critical');
    expect(r.direction).toBe('low');
    const msg = formatDeviationMessage('Product Meter 1', r, 'm3/hr', 10);
    expect(msg).toContain('below previous');
    expect(msg).toContain('multiplier');
    expect(msg).toContain('remark required before saving');
  });
});
