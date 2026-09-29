import { describe, it, expect } from 'vitest';
import { calc, nrwColor } from './calculations';

describe('calc.nrw', () => {
  it('correctly calculates Non-Revenue Water percentage', () => {
    // 95.3k produced, 23.5k consumed -> 71.8k loss -> (71.8 / 95.3) * 100 = 75.34%
    const res = calc.nrw(95300, 23500);
    expect(res).toBe(75.3);
  });

  it('handles zero production and consumption', () => {
    expect(calc.nrw(0, 0)).toBe(0);
  });

  it('returns null when production is 0 but consumption > 0', () => {
    expect(calc.nrw(0, 100)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(calc.nrw(NaN, 100)).toBeNull();
    expect(calc.nrw(100, Infinity)).toBeNull();
  });

  it('handles negative NRW when consumption exceeds production (meter mismatch/timing)', () => {
    const res = calc.nrw(100, 105);
    expect(res).toBe(-5.0);
  });

  it('returns 100% when nothing is consumed', () => {
    expect(calc.nrw(1000, 0)).toBe(100.0);
  });
});

describe('nrwColor', () => {
  it('returns accent (green) when within green max', () => {
    expect(nrwColor(10)).toBe('accent');
    expect(nrwColor(12.9)).toBe('accent');
  });

  it('returns warn (amber) between green max and amber max', () => {
    expect(nrwColor(13.0)).toBe('warn');
    expect(nrwColor(15.9)).toBe('warn');
  });

  it('returns danger (red) when above amber max', () => {
    expect(nrwColor(16.0)).toBe('danger');
    expect(nrwColor(75.3)).toBe('danger');
  });

  it('returns accent for null', () => {
    expect(nrwColor(null)).toBe('accent');
  });
});

describe('calc.rejection & calc.saltPassage', () => {
  it('correctly calculates membrane rejection and passage from feed and permeate TDS', () => {
    // feed: 1000 ppm, perm: 20 ppm -> rejection: 98.00%, passage: 2.00%
    expect(calc.rejection(20, 1000)).toBe(98.0);
    expect(calc.saltPassage(20, 1000)).toBe(2.0);
  });

  it('handles feed TDS <= 0 or invalid/null inputs gracefully', () => {
    expect(calc.rejection(20, 0)).toBeNull();
    expect(calc.rejection(20, -50)).toBeNull();
    expect(calc.rejection(null, 1000)).toBeNull();
    expect(calc.rejection(20, null)).toBeNull();
    expect(calc.rejection(NaN, 1000)).toBeNull();

    expect(calc.saltPassage(20, 0)).toBeNull();
    expect(calc.saltPassage(null, 1000)).toBeNull();
  });

  it('clamps rejection to [0, 100] when permeate exceeds feed', () => {
    // If permeate is unexpectedly higher than feed (sensor error/spike), clamp to 0
    expect(calc.rejection(1200, 1000)).toBe(0);
    expect(calc.saltPassage(1200, 1000)).toBe(100);
  });

  it('handles zero permeate TDS (100% rejection, 0% passage)', () => {
    expect(calc.rejection(0, 1000)).toBe(100.0);
    expect(calc.saltPassage(0, 1000)).toBe(0);
  });
});
