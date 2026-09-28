import { describe, it, expect } from 'vitest';
import { computeDosingLogCost, PLANT_CHEMICALS, DOSING_KEYS } from './chemicals';

describe('shared/chemicals - computeDosingLogCost', () => {
  it('contains all 4 plant chemicals and 5 dosing keys (including reagent)', () => {
    expect(PLANT_CHEMICALS.map((c) => c.name)).toEqual([
      'Chlorine',
      'SMBS',
      'Anti Scalant',
      'Soda Ash',
    ]);
    expect(DOSING_KEYS.map((k) => k.key)).toEqual([
      'chlorine_kg',
      'smbs_kg',
      'anti_scalant_l',
      'soda_ash_kg',
      'free_chlorine_reagent_pcs',
    ]);
  });

  it('computes total cost accurately across process chemicals and reagent', () => {
    const row = {
      chlorine_kg: 2,
      smbs_kg: 5,
      anti_scalant_l: 3,
      soda_ash_kg: 10,
      free_chlorine_reagent_pcs: 4,
    };

    const prices = {
      'Chlorine': 50,
      'SMBS': 60,
      'Anti Scalant': 100,
      'Soda Ash': 25,
      'Free Cl Reagent': 6,
    };

    // 2*50 + 5*60 + 3*100 + 10*25 + 4*6 = 100 + 300 + 300 + 250 + 24 = 974.00
    const { cost, unpriced } = computeDosingLogCost(row, prices);
    expect(cost).toBe(974);
    expect(unpriced).toEqual([]);
  });

  it('matches full "Name (unit)" and alternative alias for reagent', () => {
    const row = {
      chlorine_kg: 1,
      free_chlorine_reagent_pcs: 2,
    };

    const prices = {
      'Chlorine (kg)': 45,
      'Free Chlorine Reagent': 8,
    };

    const { cost, unpriced } = computeDosingLogCost(row, prices);
    expect(cost).toBe(45 * 1 + 8 * 2);
    expect(unpriced).toEqual([]);
  });

  it('identifies unpriced chemicals and excludes them from cost without crashing', () => {
    const row = {
      chlorine_kg: 2,
      smbs_kg: 3,
      free_chlorine_reagent_pcs: 5,
    };

    const prices = {
      'Chlorine': 50,
      // SMBS and reagent are unpriced
    };

    const { cost, unpriced } = computeDosingLogCost(row, prices);
    expect(cost).toBe(100);
    expect(unpriced).toEqual(['SMBS', 'Free Cl Reagent']);
  });
});
