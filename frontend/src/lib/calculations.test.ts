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
