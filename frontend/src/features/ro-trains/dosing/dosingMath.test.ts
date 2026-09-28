import { describe, it, expect } from 'vitest';
import {
  convertProductQty,
  convertDayTankDrop,
  computeDoseMgPerL,
  computeLiquidReagentMl,
  computeLineCost,
  computePriceVariance,
  computeBottleYieldVariance,
} from './dosingMath';

describe('dosingMath - Product Form Conversion and OPEX', () => {
  describe('convertProductQty', () => {
    it('converts liquid chlorine (w/v basis) accurately', () => {
      // 2 drums (200 L each) of 12% w/v liquid chlorine (density 1.2 kg/L)
      const res = convertProductQty({
        entryQty: 2,
        entryUnit: 'drum',
        factorToBase: 200,
        baseUnit: 'L',
        strengthPct: 12,
        strengthBasis: 'w/v',
        densityKgPerL: 1.2,
      });

      expect(res.qtyBase).toBe(400); // 400 L
      expect(res.productKg).toBe(480); // 400 * 1.2 kg
      expect(res.activeKg).toBe(48); // 400 * 0.12 kg as Cl2
    });

    it('converts granules chlorine (w/w basis) accurately', () => {
      // 1 drum of 65% w/w Ca(OCl)2 granules (45 kg net)
      const res = convertProductQty({
        entryQty: 1,
        entryUnit: 'drum',
        factorToBase: 45,
        baseUnit: 'kg',
        strengthPct: 65,
        strengthBasis: 'w/w',
      });

      expect(res.qtyBase).toBe(45); // 45 kg
      expect(res.productKg).toBe(45);
      expect(res.activeKg).toBe(29.25); // 45 * 0.65 kg as Cl2
    });

    it('converts soda ash powder (bags) accurately', () => {
      // 2 bags of 25 kg soda ash
      const res = convertProductQty({
        entryQty: 2,
        entryUnit: 'bag',
        factorToBase: 25,
        baseUnit: 'kg',
        strengthPct: 99,
        strengthBasis: 'w/w',
      });

      expect(res.qtyBase).toBe(50); // 50 kg
      expect(res.productKg).toBe(50);
      expect(res.activeKg).toBe(49.5);
    });

    it('handles liquid product with missing density gracefully', () => {
      // Anti Scalant entered in L with no density given
      const res = convertProductQty({
        entryQty: 5,
        entryUnit: 'L',
        factorToBase: 1,
        baseUnit: 'L',
      });

      expect(res.qtyBase).toBe(5);
      expect(res.productKg).toBeNull();
      expect(res.activeKg).toBeNull();
    });
  });

  describe('convertDayTankDrop', () => {
    it('computes neat kg from solution drop', () => {
      // SMBS day tank: 250 L drop, 10 kg per 100 L recipe
      const neat = convertDayTankDrop(250, 10);
      expect(neat).toBe(25); // 25 kg neat SMBS
    });
  });

  describe('computeDoseMgPerL', () => {
    it('calculates dose in mg/L over treated volume', () => {
      // 2.4 kg Cl2 over 1200 m3 treated water -> 2.0 mg/L
      const dose = computeDoseMgPerL(2.4, 1200);
      expect(dose).toBe(2.0);
    });
  });

  describe('computeLiquidReagentMl', () => {
    it('calculates mL consumed from drops and dropper calibration', () => {
      // 4 tests * 5 drops/test * 0.05 mL/drop = 1.0 mL
      const ml = computeLiquidReagentMl(4, 5, 0.05);
      expect(ml).toBe(1.0);
    });
  });

  describe('computeLineCost & Variances', () => {
    it('calculates line cost with base + extra quantity', () => {
      // 8 base pillows + 1 extra pillow @ ₱6.00 = ₱54.00
      const cost = computeLineCost(8, 1, 6.0);
      expect(cost).toBe(54.0);
    });

    it('returns null when price is undefined or null', () => {
      expect(computeLineCost(10, 0, null)).toBeNull();
    });

    it('calculates price variance matching worked example', () => {
      // 180 kg usage, actual delivery avg ₱62/kg vs standard list ₱60/kg -> ₱360 variance
      const varCost = computePriceVariance(180, 62, 60);
      expect(varCost).toBe(360);
    });

    it('calculates reagent bottle yield variance matching worked example', () => {
      // ₱480 bottle, 200 tests run @ ₱2.00 accrued per test -> ₱80 shortfall
      const yieldVar = computeBottleYieldVariance(480, 200, 2.0);
      expect(yieldVar).toBe(80);
    });
  });
});
