import { describe, it, expect } from 'vitest';
import {
  buildTariffsLookup,
  processPowerReadingsForTrend,
  type PowerTrendRow,
  type TrendDayAccumulator,
} from './powerTrendProcessing';

describe('buildTariffsLookup', () => {
  it('returns null when powerTariffs is empty or undefined', () => {
    const lookupEmpty = buildTariffsLookup([]);
    expect(lookupEmpty('plant-1', '2026-09-01')).toBeNull();

    const lookupUndefined = buildTariffsLookup(undefined);
    expect(lookupUndefined('plant-1', '2026-09-01')).toBeNull();
  });

  it('looks up the latest tariff effective on or before dateKey', () => {
    const tariffs = [
      { plant_id: 'plant-1', effective_date: '2026-01-01', rate_per_kwh: 10.5 },
      { plant_id: 'plant-1', effective_date: '2026-06-01', rate_per_kwh: 12.0 },
      { plant_id: 'plant-2', effective_date: '2026-01-01', rate_per_kwh: 9.0 },
    ];
    const getRate = buildTariffsLookup(tariffs);

    // Before any tariff for plant-1
    expect(getRate('plant-1', '2025-12-31')).toBeNull();
    // Between first and second
    expect(getRate('plant-1', '2026-01-01')).toBe(10.5);
    expect(getRate('plant-1', '2026-05-31')).toBe(10.5);
    // On or after second
    expect(getRate('plant-1', '2026-06-01')).toBe(12.0);
    expect(getRate('plant-1', '2026-09-10')).toBe(12.0);

    // Plant 2
    expect(getRate('plant-2', '2026-06-01')).toBe(9.0);
    expect(getRate('nonexistent', '2026-06-01')).toBeNull();
  });
});

describe('processPowerReadingsForTrend', () => {
  const createMockEnsure = () => {
    const days = new Map<string, TrendDayAccumulator>();
    const ensure = (key: string, _sortKey: number): TrendDayAccumulator => {
      if (!days.has(key)) {
        days.set(key, {
          kwh: 0,
          solarKwh: 0,
          _solarKwhForCost: 0,
          _powerCostPeso: 0,
          _hasTariff: false,
          _meterReplacements: [],
        });
      }
      return days.get(key)!;
    };
    return { days, ensure };
  };

  it('calculates single-meter power delta with multiplier correctly', () => {
    const { days, ensure } = createMockEnsure();
    const readings: PowerTrendRow[] = [
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-01T08:00:00Z',
        meter_reading_kwh: 1000,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-02T08:00:00Z',
        meter_reading_kwh: 1100, // delta = 100 * 20 = 2000 kWh
      },
    ];

    const billMultiplierMap = new Map([['plant-1', 20]]);
    const getRateForDay = () => null;

    processPowerReadingsForTrend({
      powerReadings: readings,
      billMultiplierMap,
      startISO: '2026-09-01T00:00:00Z',
      startKey: '2026-09-01',
      endKey: '2026-09-03',
      metric: 'kwh',
      getRateForDay,
      ensure,
    });

    const day2 = days.get('Sep 2');
    expect(day2).toBeDefined();
    expect(day2?.kwh).toBe(2000);
  });

  it('handles multi-meter grid_meter_readings delta and CT multipliers', () => {
    const { days, ensure } = createMockEnsure();
    const readings: PowerTrendRow[] = [
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-01T08:00:00Z',
        grid_meter_readings: { '0': 500, '1': 200 },
      },
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-02T08:00:00Z',
        grid_meter_readings: { '0': 550, '1': 220 }, // (50 * 10) + (20 * 5) = 500 + 100 = 600 kWh
      },
    ];

    const powerConfigMap = new Map([['plant-1', [10, 5]]]);
    const getRateForDay = () => null;

    processPowerReadingsForTrend({
      powerReadings: readings,
      powerConfigMap,
      startISO: '2026-09-01T00:00:00Z',
      startKey: '2026-09-01',
      endKey: '2026-09-03',
      metric: 'kwh',
      getRateForDay,
      ensure,
    });

    const day2 = days.get('Sep 2');
    expect(day2).toBeDefined();
    expect(day2?.kwh).toBe(600);
  });

  it('records meter replacements and resets baselines', () => {
    const { days, ensure } = createMockEnsure();
    const plantNames = new Map([['plant-1', 'Main Plant']]);
    const readings: PowerTrendRow[] = [
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-01T08:00:00Z',
        meter_reading_kwh: 5000,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-02T08:00:00Z',
        meter_reading_kwh: 10, // replacement meter start value
        is_meter_replacement: true,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-03T08:00:00Z',
        meter_reading_kwh: 30, // next reading after repl: should not jump from 5000
      },
    ];

    processPowerReadingsForTrend({
      powerReadings: readings,
      plantNames,
      startISO: '2026-09-01T00:00:00Z',
      startKey: '2026-09-01',
      endKey: '2026-09-04',
      metric: 'kwh',
      getRateForDay: () => null,
      ensure,
    });

    const day2 = days.get('Sep 2');
    expect(day2?._meterReplacements).toContain('Main Plant Power Meter');
    expect(day2?.kwh).toBe(0);
  });

  it('accumulates solar kWh and production cost when tariff exists', () => {
    const { days, ensure } = createMockEnsure();
    const readings: PowerTrendRow[] = [
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-01T08:00:00Z',
        meter_reading_kwh: 100,
        daily_solar_kwh: 50,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: '2026-09-02T08:00:00Z',
        meter_reading_kwh: 200, // delta = 100 kWh
        daily_solar_kwh: 80,
      },
    ];

    const getRateForDay = (_pid: string, _date: string) => 12.5;

    processPowerReadingsForTrend({
      powerReadings: readings,
      startISO: '2026-09-01T00:00:00Z',
      startKey: '2026-09-01',
      endKey: '2026-09-03',
      metric: 'productionCost',
      getRateForDay,
      ensure,
    });

    const day2 = days.get('Sep 2');
    expect(day2?.kwh).toBe(100);
    expect(day2?.solarKwh).toBe(80);
    expect(day2?._powerCostPeso).toBe(100 * 12.5); // 1250
    expect(day2?._solarKwhForCost).toBe(80);
    expect(day2?._hasTariff).toBe(true);
  });
});
