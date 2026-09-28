/**
 * dosingMath.ts
 *
 * Core conversion and calculation engine for chemical dosing, product forms,
 * residual reagent usage, and OPEX costs.
 */

export interface UnitConversionFactor {
  unitLabel: string;
  factorToBase: number; // e.g. 1 bag = 25 kg -> factorToBase = 25
}

export type StrengthBasis = 'as_product' | 'w/w' | 'w/v';

export interface ProductConversionInput {
  entryQty: number;
  entryUnit: string;
  factorToBase: number;
  baseUnit: 'kg' | 'L' | 'pcs' | 'mL';
  strengthPct?: number | null; // e.g. 12% -> 12
  strengthBasis?: StrengthBasis | null;
  densityKgPerL?: number | null;
}

export interface ProductConversionResult {
  qtyBase: number;
  productKg: number | null;
  activeKg: number | null;
  error?: string;
}

/**
 * Converts entered quantity and unit into base units, product kg, and active kg.
 */
export function convertProductQty(input: ProductConversionInput): ProductConversionResult {
  const { entryQty, factorToBase, baseUnit, strengthPct, strengthBasis, densityKgPerL } = input;

  if (entryQty < 0 || factorToBase <= 0) {
    return { qtyBase: 0, productKg: null, activeKg: null, error: 'Invalid quantity or conversion factor' };
  }

  const qtyBase = +(entryQty * factorToBase).toFixed(4);
  let productKg: number | null = null;
  let activeKg: number | null = null;

  // 1. Compute productKg
  if (baseUnit === 'kg') {
    productKg = qtyBase;
  } else if (baseUnit === 'L') {
    if (densityKgPerL && densityKgPerL > 0) {
      productKg = +(qtyBase * densityKgPerL).toFixed(4);
    }
  }

  // 2. Compute activeKg (e.g. kg as Cl2)
  if (strengthPct !== undefined && strengthPct !== null && strengthPct >= 0) {
    const fraction = strengthPct / 100;
    if (baseUnit === 'kg') {
      activeKg = +(qtyBase * fraction).toFixed(4);
    } else if (baseUnit === 'L') {
      if (strengthBasis === 'w/v') {
        // 12% w/v = 120 g/L = 0.12 kg/L active
        activeKg = +(qtyBase * fraction).toFixed(4);
      } else if (strengthBasis === 'w/w') {
        // needs density: activeKg = volume_L * density * fraction
        if (densityKgPerL && densityKgPerL > 0) {
          activeKg = +(qtyBase * densityKgPerL * fraction).toFixed(4);
        }
      } else {
        // as_product or unspecified liquid
        if (productKg !== null) {
          activeKg = +(productKg * fraction).toFixed(4);
        }
      }
    }
  } else {
    // If 100% active / as_product without strength specified
    if (productKg !== null) {
      activeKg = productKg;
    }
  }

  return { qtyBase, productKg, activeKg };
}

/**
 * Computes neat product consumed from a day tank level drop.
 * @param tankLDosed Litres of solution dosed from tank (level drop)
 * @param neatPer100L Neat base units (kg or L) contained per 100 L of solution
 */
export function convertDayTankDrop(tankLDosed: number, neatPer100L: number): number {
  if (tankLDosed <= 0 || neatPer100L <= 0) return 0;
  return +(tankLDosed * (neatPer100L / 100)).toFixed(4);
}

/**
 * Computes chlorine or chemical dose in mg/L (ppm) over treated water volume.
 * dose_mg_L = (active_kg * 1000) / treated_m3
 */
export function computeDoseMgPerL(activeKg: number, treatedM3: number): number | null {
  if (treatedM3 <= 0 || activeKg < 0) return null;
  return +((activeKg * 1000) / treatedM3).toFixed(3);
}

/**
 * Computes liquid reagent consumption from number of tests and drops per test.
 * @param testCount Number of tests performed
 * @param dropsPerTest Number of drops used per test (e.g. 5)
 * @param mlPerDrop Dropper calibration factor (e.g. 0.05 mL/drop)
 */
export function computeLiquidReagentMl(testCount: number, dropsPerTest: number, mlPerDrop: number): number {
  if (testCount <= 0 || dropsPerTest <= 0 || mlPerDrop <= 0) return 0;
  return +(testCount * dropsPerTest * mlPerDrop).toFixed(3);
}

/**
 * Computes line cost from base quantity, extra quantity, and unit price per base unit.
 */
export function computeLineCost(qtyBase: number, qtyExtra: number, unitPrice: number | null | undefined): number | null {
  if (unitPrice === null || unitPrice === undefined) return null;
  const totalQty = (qtyBase >= 0 ? qtyBase : 0) + (qtyExtra >= 0 ? qtyExtra : 0);
  return +(totalQty * unitPrice).toFixed(2);
}

/**
 * Computes price variance between actual delivery cost and standard list price.
 * Price variance = usageBase * (actualCostPerBase - standardListPrice)
 */
export function computePriceVariance(usageBase: number, actualCostPerBase: number, standardListPrice: number): number {
  return +(usageBase * (actualCostPerBase - standardListPrice)).toFixed(2);
}

/**
 * Computes bottle yield variance when a liquid reagent bottle is finished.
 * Yield variance = bottlePrice - (testsRun * accruedCostPerTest)
 */
export function computeBottleYieldVariance(bottlePrice: number, testsRun: number, accruedCostPerTest: number): number {
  return +(bottlePrice - (testsRun * accruedCostPerTest)).toFixed(2);
}
