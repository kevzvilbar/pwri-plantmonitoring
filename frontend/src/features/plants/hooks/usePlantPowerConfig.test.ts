import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizePowerConfig, DEFAULT_POWER_CONFIG, POWER_CONFIG_LS, UNSYNCED_POWER_CONFIG_LS } from './usePlantPowerConfig';

describe('usePlantPowerConfig and normalizePowerConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('normalizes null or empty configuration to defaults', () => {
    const config = normalizePowerConfig(null);
    expect(config).toEqual(DEFAULT_POWER_CONFIG);
    expect(config.grid_meter_count).toBe(1);
    expect(config.grid_meter_names).toEqual(['Grid Meter 1']);
    expect(config.grid_meter_multipliers).toEqual([1]);
    expect(config.grid_meter_multipliers_enabled).toEqual([false]);
  });

  it('normalizes legacy multi-grid configuration from local storage', () => {
    const legacyRaw = {
      grid_meter_count: 3,
      grid_meter_names: ['Grid Meter 1 STP', 'Grid Meter 2 Pumphouse', 'Grid Meter 3 Main'],
      grid_meter_multipliers: [1, 120, 2400],
      solar_meter_count: 1,
      solar_meter_names: ['Solar Meter 1'],
    };

    const config = normalizePowerConfig(legacyRaw);
    expect(config.grid_meter_count).toBe(3);
    expect(config.grid_meter_names).toEqual([
      'Grid Meter 1 STP',
      'Grid Meter 2 Pumphouse',
      'Grid Meter 3 Main',
    ]);
    expect(config.grid_meter_multipliers).toEqual([1, 120, 2400]);
    // Since enabled wasn't provided, mult > 1 defaults to true, mult == 1 defaults to false
    expect(config.grid_meter_multipliers_enabled).toEqual([false, true, true]);
    expect(config.solar_meter_count).toBe(1);
    expect(config.solar_meter_multipliers).toEqual([1]);
    expect(config.solar_meter_multipliers_enabled).toEqual([false]);
  });

  it('infers count from array length if count is omitted or smaller', () => {
    const raw = {
      grid_meter_names: ['STP', 'Pumphouse', 'Main'],
      grid_meter_multipliers: [1, 120, 2400],
    };
    const config = normalizePowerConfig(raw);
    expect(config.grid_meter_count).toBe(3);
    expect(config.grid_meter_names).toEqual(['STP', 'Pumphouse', 'Main']);
    expect(config.grid_meter_multipliers).toEqual([1, 120, 2400]);
  });

  it('generates proper localStorage keys for standard and unsynced data', () => {
    expect(POWER_CONFIG_LS('plant-srp-123')).toBe('power_config_plant-srp-123');
    expect(UNSYNCED_POWER_CONFIG_LS('plant-srp-123')).toBe('plant_power_config_unsynced_plant-srp-123');
  });

  it('clamps invalid counts and handles missing names/multipliers safely', () => {
    const malformed = {
      grid_meter_count: 0,
      solar_meter_count: 35, // exceeds MAX 20
      grid_meter_names: ['Custom Grid 1'],
      grid_meter_multipliers: [-5],
    };

    const config = normalizePowerConfig(malformed);
    expect(config.grid_meter_count).toBe(1);
    expect(config.grid_meter_names).toEqual(['Custom Grid 1']);
    expect(config.grid_meter_multipliers).toEqual([1]); // negative becomes 1
    expect(config.solar_meter_count).toBe(20); // clamped to 20
    expect(config.solar_meter_names.length).toBe(20);
    expect(config.solar_meter_multipliers.length).toBe(20);
    expect(config.solar_meter_multipliers_enabled.length).toBe(20);
  });

  it('preserves solar-only custom meter names and multiplier configurations', () => {
    const solarCustom = {
      solar_meter_count: 2,
      solar_meter_names: ['Rooftop Array A', 'Carport Array B'],
      solar_meter_multipliers: [10, 20],
      solar_meter_multipliers_enabled: [true, true],
    };

    const config = normalizePowerConfig(solarCustom);
    expect(config.solar_meter_count).toBe(2);
    expect(config.solar_meter_names).toEqual(['Rooftop Array A', 'Carport Array B']);
    expect(config.solar_meter_multipliers).toEqual([10, 20]);
    expect(config.solar_meter_multipliers_enabled).toEqual([true, true]);
  });
});
