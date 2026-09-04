import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTrendChartData } from './useTrendChartData';

// TZ-safe local-noon ISO timestamps
const iso = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h, 0, 0, 0).toISOString();

describe('useTrendChartData — Power Consumption & Energy Mix initial date fix', () => {
  const defaultProps = {
    metric: 'kwh',
    startKey: '2026-08-06',
    endKey: '2026-09-02',
    startISO: new Date('2026-08-06T00:00:00').toISOString(),
    viewGran: 'daily' as const,
    usesSharedGranularity: false,
    kwhSource: 'both' as const,
    locReadings: [],
    wellReadings: [],
    productReadings: [],
    roReadings: [],
    powerReadings: [],
    costReadings: [],
    powerTariffs: [],
    billMultiplierMap: new Map([['plant-1', 1]]),
    powerConfigMap: new Map([['plant-1', [1]]]),
    wellNames: new Map(),
    locatorNames: new Map(),
    productMeterNames: new Map(),
    plantNames: new Map([['plant-1', 'Plant 1']]),
    permeateIsProductionPlants: new Set<string>(),
    productExcludedPlants: new Set<string>(),
    _trainPlantMap: new Map(),
    _trainUnitTypeMap: new Map(),
    _directLocatorIds: new Set<string>(),
    _directProductMeterIds: new Set<string>(),
  };

  it('does not plot pre-window baseline reading as an orphaned solar bar on the first date', () => {
    // Aug 5 reading is BEFORE startISO (pre-window seed row to establish grid delta baseline)
    // Aug 6 and Aug 7 are within the requested window
    const powerReadings = [
      {
        plant_id: 'plant-1',
        reading_datetime: iso(2026, 8, 5),
        meter_reading_kwh: 1000,
        daily_solar_kwh: 898.8,
        multiplier: 1,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: iso(2026, 8, 6),
        meter_reading_kwh: 1100, // delta = 100 kWh
        daily_solar_kwh: 920.0,
        multiplier: 1,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: iso(2026, 8, 7),
        meter_reading_kwh: 1250, // delta = 150 kWh
        daily_solar_kwh: 950.0,
        multiplier: 1,
      },
    ];

    const { result } = renderHook(() =>
      useTrendChartData({
        ...defaultProps,
        powerReadings,
      }),
    );

    const { chartData, kwhChartRows } = result.current;

    // Aug 5 must NOT appear in chartData or kwhChartRows
    const dates = chartData.map((d: Record<string, unknown>) => d.date);
    expect(dates).not.toContain('Aug 5');
    expect(dates[0]).toBe('Aug 6');

    // On Aug 6: grid kWh should be 100 (1100 - 1000) and solar should be 920
    const aug6 = chartData.find((d: Record<string, unknown>) => d.date === 'Aug 6') as Record<string, unknown>;
    expect(aug6).toBeDefined();
    expect(aug6.kwh).toBe(100);
    expect(aug6.solarKwh).toBe(920);

    // On Aug 7: grid kWh should be 150 (1250 - 1100) and solar should be 950
    const aug7 = chartData.find((d: Record<string, unknown>) => d.date === 'Aug 7') as Record<string, unknown>;
    expect(aug7).toBeDefined();
    expect(aug7.kwh).toBe(150);
    expect(aug7.solarKwh).toBe(950);

    // kwhChartRows should also start cleanly from Aug 6
    expect(kwhChartRows[0].date).toBe('Aug 6');
    expect(kwhChartRows[0].gridKwh).toBe(100);
    expect(kwhChartRows[0].solarKwh).toBe(920);
  });

  it('excludes rows outside [startKey, endKey] from boundedSparseRows and chartData', () => {
    const powerReadings = [
      {
        plant_id: 'plant-1',
        reading_datetime: iso(2026, 8, 4), // outside window
        meter_reading_kwh: 900,
        daily_solar_kwh: 500,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: iso(2026, 8, 6),
        meter_reading_kwh: 1000,
        daily_solar_kwh: 600,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: iso(2026, 8, 7),
        meter_reading_kwh: 1100,
        daily_solar_kwh: 700,
      },
      {
        plant_id: 'plant-1',
        reading_datetime: iso(2026, 9, 10), // beyond endKey (2026-09-02)
        meter_reading_kwh: 1200,
        daily_solar_kwh: 800,
      },
    ];

    const { result } = renderHook(() =>
      useTrendChartData({
        ...defaultProps,
        powerReadings,
      }),
    );

    const { chartData } = result.current;
    const dates = chartData.map((d: Record<string, unknown>) => d.date);
    expect(dates).not.toContain('Aug 4');
    expect(dates).not.toContain('Sep 10');
    expect(dates).toEqual(['Aug 6', 'Aug 7']);
  });
});
