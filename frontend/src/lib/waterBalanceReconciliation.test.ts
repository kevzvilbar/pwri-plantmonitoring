import { describe, it, expect } from 'vitest';
import {
  classifyReconciliationVariance,
  computePermeateReconciliation,
  computePlantWaterBalanceSummary,
} from './waterBalanceReconciliation';

describe('classifyReconciliationVariance', () => {
  it('classifies null or <= 2% as balanced', () => {
    expect(classifyReconciliationVariance(null)).toBe('balanced');
    expect(classifyReconciliationVariance(0)).toBe('balanced');
    expect(classifyReconciliationVariance(1.5)).toBe('balanced');
    expect(classifyReconciliationVariance(2.0)).toBe('balanced');
  });

  it('classifies 2.1% to 5.0% as marginal', () => {
    expect(classifyReconciliationVariance(2.1)).toBe('marginal');
    expect(classifyReconciliationVariance(3.8)).toBe('marginal');
    expect(classifyReconciliationVariance(5.0)).toBe('marginal');
  });

  it('classifies > 5.0% as alert', () => {
    expect(classifyReconciliationVariance(5.1)).toBe('alert');
    expect(classifyReconciliationVariance(12.5)).toBe('alert');
  });
});

describe('computePermeateReconciliation', () => {
  it('correctly calculates total train permeate, product meter, delta, and variance', () => {
    const trains = [
      { trainId: 't1', trainNumber: 1, volume: 5000 },
      { trainId: 't2', trainNumber: 2, volume: 4800 },
    ];
    const meters = [
      { meterId: 'm1', name: 'Product Header 1', volume: 9600 },
    ];

    const res = computePermeateReconciliation(trains, meters);

    expect(res.totalTrainPermeate).toBe(9800);
    expect(res.totalProductMeter).toBe(9600);
    expect(res.deltaVariance).toBe(200);
    // (200 / 9600) * 100 = 2.0833% -> marginal
    expect(res.variancePct).toBeCloseTo(2.083, 2);
    expect(res.status).toBe('marginal');
  });

  it('handles exact zero variance as balanced', () => {
    const trains = [{ trainId: 't1', trainNumber: 1, volume: 5000 }];
    const meters = [{ meterId: 'm1', name: 'Product Header', volume: 5000 }];

    const res = computePermeateReconciliation(trains, meters);
    expect(res.deltaVariance).toBe(0);
    expect(res.variancePct).toBe(0);
    expect(res.status).toBe('balanced');
  });

  it('handles missing or zero readings gracefully without dividing by zero', () => {
    const res = computePermeateReconciliation([], []);
    expect(res.totalTrainPermeate).toBe(0);
    expect(res.totalProductMeter).toBe(0);
    expect(res.deltaVariance).toBe(0);
    expect(res.variancePct).toBeNull();
    expect(res.status).toBe('balanced');
  });
});

describe('computePlantWaterBalanceSummary', () => {
  it('conserves mass and maps node volume attributions', () => {
    const summary = computePlantWaterBalanceSummary({
      wellVolumes: [
        { wellId: 'w1', volume: 6000 },
        { wellId: 'w2', volume: 4000 },
      ],
      trainPermeateDetails: [
        { trainId: 't1', trainNumber: 1, volume: 3800 },
        { trainId: 't2', trainNumber: 2, volume: 3700 },
      ],
      productMeterDetails: [
        { meterId: 'm1', name: 'Bulk Meter', volume: 7400 },
      ],
      locatorVolumes: [
        { locatorId: 'loc1', volume: 4000 },
        { locatorId: 'loc2', volume: 2800 },
      ],
      blendingVolume: 500,
      permeateIsProduction: false,
    });

    expect(summary.hasAnyData).toBe(true);
    expect(summary.rawWaterIn).toBe(10000);
    expect(summary.roPermeate).toBe(7500);
    expect(summary.productMetered).toBe(7400);
    expect(summary.reconciledProduction).toBe(7400);
    expect(summary.blending).toBe(500);
    expect(summary.distributionInput).toBe(7900); // 7400 + 500
    expect(summary.locatorConsumption).toBe(6800); // 4000 + 2800
    expect(summary.nrwVolume).toBe(1100); // 7900 - 6800
    // NRW %: (1100 / 7900) * 100 = 13.92%
    expect(summary.nrwPct).toBeCloseTo(13.92, 1);

    // Node volumes attribution checks
    expect(summary.nodeVolumes['w1']).toBe(6000);
    expect(summary.nodeVolumes['w2']).toBe(4000);
    expect(summary.nodeVolumes['t1']).toBe(3800);
    expect(summary.nodeVolumes['t2']).toBe(3700);
    expect(summary.nodeVolumes['m1']).toBe(7400);
    expect(summary.nodeVolumes['loc1']).toBe(4000);
    expect(summary.nodeVolumes['loc2']).toBe(2800);
  });
});
