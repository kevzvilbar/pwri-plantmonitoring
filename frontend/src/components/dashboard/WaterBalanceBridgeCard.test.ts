import { describe, it, expect } from 'vitest';
import { format, subDays } from 'date-fns';
import { buildBridgeRows, resolveDateWindow, type WaterBalanceTotals } from './WaterBalanceBridgeCard';

describe('buildBridgeRows', () => {
  it('telescopes exactly from raw water to locator consumption with no drift', () => {
    const totals: WaterBalanceTotals = {
      hasAnyData: true, rawWater: 45000, production: 38400, locatorConsumption: 29200, blending: 2600,
    };
    const rows = buildBridgeRows(totals);
    expect(rows.map((r) => r.name)).toEqual([
      'Raw water in', 'Treatment loss', 'Blending', 'Distribution / NRW', 'Locator consumption',
    ]);
    // Last bar's height must equal locatorConsumption exactly — this is the
    // whole point of deriving cumulative rather than re-reading the raw field.
    expect(rows[rows.length - 1].height).toBe(29200);
    expect(rows[rows.length - 1].base).toBe(0);
  });

  it('renders a negative loss (a net gain) as an upward bar instead of assuming the sign', () => {
    // production > rawWater — e.g. a correction or extra input source.
    const totals: WaterBalanceTotals = {
      hasAnyData: true, rawWater: 10000, production: 10500, locatorConsumption: 9000, blending: 0,
    };
    const rows = buildBridgeRows(totals);
    const treatmentBar = rows.find((r) => r.name === 'Treatment loss')!;
    // amount = -(rawWater - production) = -(10000-10500) = +500 → a gain.
    expect(treatmentBar.deltaLabel.startsWith('+')).toBe(true);
    expect(treatmentBar.height).toBe(500);
    expect(treatmentBar.base).toBe(10000); // floats up from the prior cumulative, not down
  });

  it('keeps every intermediate bar\'s base at the correct floating offset', () => {
    const totals: WaterBalanceTotals = {
      hasAnyData: true, rawWater: 1000, production: 800, locatorConsumption: 700, blending: 100,
    };
    const rows = buildBridgeRows(totals);
    // Raw water in: 1000
    // Treatment loss: -(1000-800) = -200 -> cumulative 800, base=min(1000,800)=800, height=200
    // Blending: +100 -> cumulative 900, base=min(800,900)=800, height=100
    // Distribution/NRW: -(900-700) = -200 -> cumulative 700, base=min(900,700)=700, height=200
    expect(rows[1]).toMatchObject({ base: 800, height: 200 });
    expect(rows[2]).toMatchObject({ base: 800, height: 100 });
    expect(rows[3]).toMatchObject({ base: 700, height: 200 });
    expect(rows[4]).toMatchObject({ base: 0, height: 700 });
  });
});

describe('resolveDateWindow', () => {
  it('passes CUSTOM from/to straight through as the key bounds', () => {
    const w = resolveDateWindow('CUSTOM', '2026-07-01', '2026-07-31');
    expect(w.startKey).toBe('2026-07-01');
    expect(w.endKey).toBe('2026-07-31');
    expect(w.startISO.startsWith('2026-07-01')).toBe(true);
  });

  it('resolves a preset range to N days ago through today', () => {
    const today = new Date();
    const w = resolveDateWindow('7D', '', '');
    expect(w.endKey).toBe(format(today, 'yyyy-MM-dd'));
    expect(w.startKey).toBe(format(subDays(today, 7), 'yyyy-MM-dd'));
  });
});
