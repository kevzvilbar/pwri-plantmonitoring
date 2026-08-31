import { describe, it, expect } from 'vitest';
import { computeViolations, DEFAULT_THRESHOLDS, type ChemSupply } from './Compliance';

describe('computeViolations — chemical low-stock check', () => {
  it('raises nothing when chemSupply is empty (unchanged legacy behavior)', () => {
    const violations = computeViolations({}, DEFAULT_THRESHOLDS, []);
    expect(violations.filter((v) => v.code === 'CHEM_LOW')).toHaveLength(0);
  });

  it('does not flag a chemical with plenty of days remaining', () => {
    const chem: ChemSupply[] = [{ name: 'Chlorine', days: 30, unit: 'kg' }];
    const violations = computeViolations({}, DEFAULT_THRESHOLDS, chem);
    expect(violations.filter((v) => v.code === 'CHEM_LOW')).toHaveLength(0);
  });

  it('flags a chemical below the threshold at "medium" severity', () => {
    // default threshold is 7 days; 5 is below it but >= half (3.5)
    const chem: ChemSupply[] = [{ name: 'SMBS', days: 5, unit: 'kg' }];
    const violations = computeViolations({}, DEFAULT_THRESHOLDS, chem);
    const chemViolations = violations.filter((v) => v.code === 'CHEM_LOW');
    expect(chemViolations).toHaveLength(1);
    expect(chemViolations[0].severity).toBe('medium');
    expect(chemViolations[0].metric).toBe('SMBS');
  });

  it('flags a chemical below half the threshold at "high" severity', () => {
    const chem: ChemSupply[] = [{ name: 'Anti Scalant', days: 2, unit: 'L' }];
    const violations = computeViolations({}, DEFAULT_THRESHOLDS, chem);
    const chemViolations = violations.filter((v) => v.code === 'CHEM_LOW');
    expect(chemViolations).toHaveLength(1);
    expect(chemViolations[0].severity).toBe('high');
  });

  it('flags multiple low chemicals independently, by name', () => {
    const chem: ChemSupply[] = [
      { name: 'Chlorine', days: 1, unit: 'kg' },
      { name: 'Soda Ash', days: 6, unit: 'kg' },
      { name: 'SMBS', days: 30, unit: 'kg' }, // healthy — should not appear
    ];
    const violations = computeViolations({}, DEFAULT_THRESHOLDS, chem);
    const chemViolations = violations.filter((v) => v.code === 'CHEM_LOW');
    expect(chemViolations.map((v) => v.metric).sort()).toEqual(['Chlorine', 'Soda Ash']);
  });

  it('ignores entries with no usable days estimate rather than flagging them', () => {
    const chem: ChemSupply[] = [{ name: 'Chlorine', days: NaN, unit: 'kg' }];
    const violations = computeViolations({}, DEFAULT_THRESHOLDS, chem);
    expect(violations.filter((v) => v.code === 'CHEM_LOW')).toHaveLength(0);
  });

  it('still runs the existing numeric checks alongside the chemical check', () => {
    const violations = computeViolations(
      { nrw_pct: 99 },
      DEFAULT_THRESHOLDS,
      [{ name: 'Chlorine', days: 1, unit: 'kg' }],
    );
    expect(violations.some((v) => v.code === 'NRW_HIGH')).toBe(true);
    expect(violations.some((v) => v.code === 'CHEM_LOW')).toBe(true);
  });

  it('flags product turbidity when exceeding configured product_turbidity_max (e.g. > 5 NTU)', () => {
    const violations = computeViolations(
      { product_turbidity: 6.2 },
      { ...DEFAULT_THRESHOLDS, product_turbidity_max: 5 },
      [],
    );
    const turbViolations = violations.filter((v) => v.code === 'TURBIDITY_HIGH');
    expect(turbViolations).toHaveLength(1);
    expect(turbViolations[0].metric).toBe('product_turbidity');
    expect(turbViolations[0].value).toBe(6.2);
    expect(turbViolations[0].threshold).toBe(5);
  });
});
