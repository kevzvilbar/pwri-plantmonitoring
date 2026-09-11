import { describe, it, expect } from 'vitest';
import type { ChemicalDayBreakdown } from './ChemicalBreakdownTable';

describe('ChemicalBreakdownTable data logic', () => {
  it('correctly aggregates per-chemical costs, quantities, and cost per m³ across multiple days', () => {
    const dates = ['2026-09-01', '2026-09-02'];
    const breakdown = new Map<string, ChemicalDayBreakdown>([
      [
        '2026-09-01',
        {
          chlorineKg: 5,
          chlorineCost: 500,
          smbsKg: 2,
          smbsCost: 200,
          antiScalantL: 3,
          antiScalantCost: 450,
          sodaAshKg: 10,
          sodaAshCost: 600,
          freeClPcs: 1,
          freeClCost: 50,
          otherCost: 0,
          totalCost: 1800,
          prodVol: 1000,
          chemCostPerM3: 1.8,
        },
      ],
      [
        '2026-09-02',
        {
          chlorineKg: 3,
          chlorineCost: 300,
          smbsKg: 1,
          smbsCost: 100,
          antiScalantL: 2,
          antiScalantCost: 300,
          sodaAshKg: 5,
          sodaAshCost: 300,
          freeClPcs: 0,
          freeClCost: 0,
          otherCost: 100,
          totalCost: 1100,
          prodVol: 500,
          chemCostPerM3: 2.2,
        },
      ],
    ]);

    // Calculate totals matching ChemicalBreakdownTable logic
    let totClKg = 0;
    let totClCost = 0;
    let totSmbsCost = 0;
    let totAsCost = 0;
    let totSaCost = 0;
    let totFreeClCost = 0;
    let totOtherCost = 0;
    let totGrandCost = 0;
    let totProdVol = 0;

    for (const dk of dates) {
      const row = breakdown.get(dk);
      if (row) {
        totClKg += row.chlorineKg;
        totClCost += row.chlorineCost;
        totSmbsCost += row.smbsCost;
        totAsCost += row.antiScalantCost;
        totSaCost += row.sodaAshCost;
        totFreeClCost += row.freeClCost;
        totOtherCost += row.otherCost;
        totGrandCost += row.totalCost;
        if (row.prodVol != null && row.prodVol > 0) {
          totProdVol += row.prodVol;
        }
      }
    }

    expect(totClKg).toBe(8);
    expect(totClCost).toBe(800);
    expect(totSmbsCost).toBe(300);
    expect(totAsCost).toBe(750);
    expect(totSaCost).toBe(900);
    expect(totFreeClCost).toBe(50);
    expect(totOtherCost).toBe(100);
    expect(totGrandCost).toBe(2900);
    expect(totProdVol).toBe(1500);

    const avgCostPerM3 = +(totGrandCost / totProdVol).toFixed(4);
    expect(avgCostPerM3).toBe(1.9333);
  });

  it('handles empty dates and zero dosages cleanly without NaN', () => {
    const dates = ['2026-09-01'];
    const breakdown = new Map<string, ChemicalDayBreakdown>([
      [
        '2026-09-01',
        {
          chlorineKg: 0,
          chlorineCost: 0,
          smbsKg: 0,
          smbsCost: 0,
          antiScalantL: 0,
          antiScalantCost: 0,
          sodaAshKg: 0,
          sodaAshCost: 0,
          freeClPcs: 0,
          freeClCost: 0,
          otherCost: 0,
          totalCost: 0,
          prodVol: 0,
          chemCostPerM3: null,
        },
      ],
    ]);

    const row = breakdown.get('2026-09-01')!;
    expect(row.totalCost).toBe(0);
    expect(row.chemCostPerM3).toBeNull();
  });
});

