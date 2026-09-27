import { describe, it, expect } from 'vitest';
import { isMeterConfigCustomized, DEFAULT_METER_CONFIG, type PlantMeterConfig } from '../shared';

describe('usePlantMeterConfig - isMeterConfigCustomized and precedence', () => {
  it('identifies DEFAULT_METER_CONFIG as not customized', () => {
    expect(isMeterConfigCustomized(DEFAULT_METER_CONFIG)).toBe(false);
  });

  it('detects customized permeate_is_production and cutoff settings', () => {
    const customPermeate: Partial<PlantMeterConfig> = {
      ...DEFAULT_METER_CONFIG,
      permeate_is_production: true,
    };
    expect(isMeterConfigCustomized(customPermeate)).toBe(true);

    const customCutoff: Partial<PlantMeterConfig> = {
      ...DEFAULT_METER_CONFIG,
      permeate_cutoff_time: '08:00',
    };
    expect(isMeterConfigCustomized(customCutoff)).toBe(true);
  });

  it('detects customized chemical configurations and CIP lists', () => {
    const customChems: Partial<PlantMeterConfig> = {
      ...DEFAULT_METER_CONFIG,
      enabled_chemicals: ['Antiscalant', 'Sodium Hypochlorite'],
    };
    expect(isMeterConfigCustomized(customChems)).toBe(true);

    const customCip: Partial<PlantMeterConfig> = {
      ...DEFAULT_METER_CONFIG,
      cip_chemicals: [{ name: 'Citric Acid', unit: 'kg' }],
    };
    expect(isMeterConfigCustomized(customCip)).toBe(true);
  });

  it('detects customized electrical and locator grouping configurations', () => {
    const customGroups: Partial<PlantMeterConfig> = {
      ...DEFAULT_METER_CONFIG,
      locators_dedicated_bulk_ids: ['loc-1', 'loc-2'],
    };
    expect(isMeterConfigCustomized(customGroups)).toBe(true);
  });
});
