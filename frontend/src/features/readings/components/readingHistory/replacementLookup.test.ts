import { describe, it, expect } from 'vitest';
import { normalizeReplacementRow } from './replacementLookup';

describe('normalizeReplacementRow with multipliers', () => {
  it('normalizes well replacement rows with multiplier fields', () => {
    const raw = {
      id: 'repl-1',
      well_id: 'well-1',
      old_serial: 'SN-OLD-1',
      old_final_reading: 1000,
      new_serial: 'SN-NEW-1',
      new_initial_reading: 0,
      replacement_date: '2026-09-27',
      old_multiplier: 1,
      old_multiplier_enabled: false,
      new_multiplier: 10,
      new_multiplier_enabled: true,
    };
    const norm = normalizeReplacementRow('well', raw);
    expect(norm.oldMultiplier).toBe(1);
    expect(norm.oldMultiplierEnabled).toBe(false);
    expect(norm.newMultiplier).toBe(10);
    expect(norm.newMultiplierEnabled).toBe(true);
  });

  it('normalizes locator replacement rows with multiplier fields', () => {
    const raw = {
      id: 'repl-2',
      locator_id: 'loc-1',
      old_meter_serial: 'LOC-OLD',
      old_meter_final_reading: 500,
      new_meter_serial: 'LOC-NEW',
      new_meter_initial_reading: 10,
      replacement_date: '2026-09-27',
      old_multiplier: 10,
      old_multiplier_enabled: true,
      new_multiplier: 100,
      new_multiplier_enabled: true,
    };
    const norm = normalizeReplacementRow('locator', raw);
    expect(norm.oldMultiplier).toBe(10);
    expect(norm.oldMultiplierEnabled).toBe(true);
    expect(norm.newMultiplier).toBe(100);
    expect(norm.newMultiplierEnabled).toBe(true);
  });

  it('handles null multiplier fields gracefully for legacy records', () => {
    const raw = {
      id: 'repl-3',
      product_id: 'prod-1',
      old_meter_serial: 'PROD-OLD',
      new_meter_serial: 'PROD-NEW',
    };
    const norm = normalizeReplacementRow('product', raw);
    expect(norm.oldMultiplier).toBeNull();
    expect(norm.oldMultiplierEnabled).toBeNull();
    expect(norm.newMultiplier).toBeNull();
    expect(norm.newMultiplierEnabled).toBeNull();
  });
});
