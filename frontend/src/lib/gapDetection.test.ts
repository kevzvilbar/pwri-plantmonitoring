import { describe, it, expect } from 'vitest';
import {
  detectGaps,
  calculateEvenSplitValues,
  calculateRegressionFlowRateValues,
  GAP_FILL_PREFIX,
  EVEN_SPLIT_THRESHOLD_DAYS,
  MAX_GAP_BACKFILL_DAYS,
  DIRECT_COLUMNS,
} from './gapDetection';
import { RawReading } from './regressionCorrection';

describe('gapDetection', () => {
  describe('constants', () => {
    it('has agreed shared constants', () => {
      expect(EVEN_SPLIT_THRESHOLD_DAYS).toBe(5);
      expect(MAX_GAP_BACKFILL_DAYS).toBe(14);
      expect(DIRECT_COLUMNS.has('daily_solar_kwh')).toBe(true);
      expect(DIRECT_COLUMNS.has('daily_volume')).toBe(true);
      expect(DIRECT_COLUMNS.has('daily_consumption_kwh')).toBe(true);
      expect(DIRECT_COLUMNS.has('daily_grid_kwh')).toBe(true);
    });
  });

  describe('calculateEvenSplitValues', () => {
    it('calculates exact even split matching the worked example (23 delta over 3 steps)', () => {
      // Anchor: Aug 19 = 9020.6
      // Next real reading: Aug 22 = 9043.6 (Δ = 23 m³, gap on Aug 20 and Aug 21)
      // daily step = 23 / 3 = 7.6667
      // Aug 20 = 9020.6 + 7.6667 = 9028.27
      // Aug 21 = 9028.27 + 7.6667 = 9035.93
      const values = calculateEvenSplitValues(9020.6, 9043.6, 2, 2);
      expect(values).toEqual([9028.27, 9035.93]);
    });

    it('returns empty array if gapDays <= 0', () => {
      expect(calculateEvenSplitValues(100, 200, 0)).toEqual([]);
    });
  });

  describe('calculateRegressionFlowRateValues', () => {
    it('calculates smooth rate-aware curve distinct from even-split when historical daily rate differs', () => {
      // 6-day gap from 1000 to 1070 (Δ = 70 over 7 steps).
      // Even-split would be: [1010, 1020, 1030, 1040, 1050, 1060]
      // With historical daily rate = 12.0:
      const evenSplit = calculateEvenSplitValues(1000, 1070, 6, 2);
      const flowRateValues = calculateRegressionFlowRateValues(1000, 1070, 6, 12.0, 2);

      expect(evenSplit).toEqual([1010, 1020, 1030, 1040, 1050, 1060]);
      expect(flowRateValues).toEqual([1011.71, 1022.86, 1033.43, 1043.43, 1052.86, 1061.71]);
      // Values are monotonic and strictly distinct from even-split
      expect(flowRateValues[0]).toBeGreaterThan(evenSplit[0]);
    });

    it('falls back to even-split if historical rate is null or zero', () => {
      const evenSplit = calculateEvenSplitValues(1000, 1070, 6, 2);
      const fallback = calculateRegressionFlowRateValues(1000, 1070, 6, null, 2);
      expect(fallback).toEqual(evenSplit);
    });
  });

  describe('detectGaps', () => {
    const mockFkLookup = (table: string) => {
      if (table === 'locator_readings') return 'locator_id';
      if (table === 'well_readings') return 'well_id';
      return null;
    };

    it('detects and backfills a 2-day gap with even split and tags even_split method', () => {
      const readings: RawReading[] = [
        {
          id: '1',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-19T08:00:00+08:00',
          current_reading: 9020.6,
        },
        {
          id: '2',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-22T08:00:00+08:00',
          current_reading: 9043.6,
        },
      ];

      const fills = detectGaps(readings, 'current_reading', 'locator_readings', mockFkLookup);

      expect(fills).toHaveLength(2);
      expect(fills[0].reading_id).toBe(`${GAP_FILL_PREFIX}:loc-1:2026-08-20`);
      expect(fills[0].corrected_value).toBe(9028.27);
      expect(fills[0].note).toContain('"method":"even_split"');
      expect(fills[1].reading_id).toBe(`${GAP_FILL_PREFIX}:loc-1:2026-08-21`);
      expect(fills[1].corrected_value).toBe(9035.93);
    });

    it('computes regression_flowrate with distinct values when historical rate is present for long gaps', () => {
      const readings: RawReading[] = [
        {
          id: '0',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-07-31T08:00:00+08:00',
          current_reading: 988, // 1 day prior: rate = (1000 - 988)/1 = 12/day
        },
        {
          id: '1',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-01T08:00:00+08:00',
          current_reading: 1000,
        },
        {
          id: '2',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-08T08:00:00+08:00',
          current_reading: 1070,
        },
      ];

      const fills = detectGaps(readings, 'current_reading', 'locator_readings', mockFkLookup);

      expect(fills).toHaveLength(6); // 6 missing days
      expect(fills[0].note).toContain('"method":"regression_flowrate"');
      // Assert actual non-linear calculated values
      expect(fills[0].corrected_value).toBe(1011.71);
      expect(fills[1].corrected_value).toBe(1022.86);
      expect(fills[5].corrected_value).toBe(1061.71);
    });

    it('exempts remarked gap dates from being filled', () => {
      const readings: RawReading[] = [
        {
          id: '1',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-19T08:00:00+08:00',
          current_reading: 9020.6,
        },
        {
          id: '2',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-22T08:00:00+08:00',
          current_reading: 9043.6,
        },
      ];

      // Aug 20 has an operator remark on file
      const exemptDateKeys = new Set(['loc-1|2026-08-20']);
      const fills = detectGaps(readings, 'current_reading', 'locator_readings', mockFkLookup, { exemptDateKeys });

      expect(fills).toHaveLength(1);
      expect(fills[0].reading_id).toBe(`${GAP_FILL_PREFIX}:loc-1:2026-08-21`);
      expect(fills[0].corrected_value).toBe(9035.93);
    });

    it('does not extrapolate past the last reading (no forward projection without anchor)', () => {
      const readings: RawReading[] = [
        {
          id: '1',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-19T08:00:00+08:00',
          current_reading: 9020.6,
        },
      ];

      const fills = detectGaps(readings, 'current_reading', 'locator_readings', mockFkLookup);
      expect(fills).toHaveLength(0);
    });

    it('skips interpolation across meter replacement or rollover resets', () => {
      const readingsReplacement: RawReading[] = [
        {
          id: '1',
          well_id: 'well-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-10T08:00:00+08:00',
          current_reading: 5000,
        },
        {
          id: '2',
          well_id: 'well-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-15T08:00:00+08:00',
          current_reading: 10,
          is_meter_replacement: true,
        },
      ];
      expect(detectGaps(readingsReplacement, 'current_reading', 'well_readings', mockFkLookup)).toHaveLength(0);

      const readingsRollover: RawReading[] = [
        {
          id: '1',
          well_id: 'well-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-10T08:00:00+08:00',
          current_reading: 99990,
        },
        {
          id: '2',
          well_id: 'well-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-15T08:00:00+08:00',
          current_reading: 20,
          is_meter_rollover: true,
        },
      ];
      expect(detectGaps(readingsRollover, 'current_reading', 'well_readings', mockFkLookup)).toHaveLength(0);
    });

    it('strictly exempts direct volume/power readings (such as daily_solar_kwh) from gap backfill', () => {
      const solarReadings: RawReading[] = [
        {
          id: '1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-10T08:00:00+08:00',
          daily_solar_kwh: 120.5,
        },
        {
          id: '2',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-15T08:00:00+08:00',
          daily_solar_kwh: 140.0,
        },
      ];

      // daily_solar_kwh is in DIRECT_COLUMNS -> must return 0 gap fills
      const fills = detectGaps(solarReadings, 'daily_solar_kwh', 'power_readings', () => null);
      expect(fills).toHaveLength(0);
    });

    it('strictly exempts daily_volume from gap backfill', () => {
      const volumeReadings: RawReading[] = [
        {
          id: '1',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-10T08:00:00+08:00',
          daily_volume: 50.0,
        },
        {
          id: '2',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-15T08:00:00+08:00',
          daily_volume: 60.0,
        },
      ];

      const fills = detectGaps(volumeReadings, 'daily_volume', 'locator_readings', mockFkLookup);
      expect(fills).toHaveLength(0);
    });

    it('strictly exempts entities configured in directModeIds from gap backfill', () => {
      const readings: RawReading[] = [
        {
          id: '1',
          locator_id: 'loc-direct',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-10T08:00:00+08:00',
          current_reading: 50.0,
        },
        {
          id: '2',
          locator_id: 'loc-direct',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-13T08:00:00+08:00',
          current_reading: 70.0,
        },
      ];

      const directModeIds = new Set(['loc-direct']);
      const fills = detectGaps(readings, 'current_reading', 'locator_readings', mockFkLookup, { directModeIds });
      expect(fills).toHaveLength(0);
    });

    it('strictly exempts readings when options.isDirectReading is set to true', () => {
      const readings: RawReading[] = [
        {
          id: '1',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-10T08:00:00+08:00',
          current_reading: 100.0,
        },
        {
          id: '2',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-13T08:00:00+08:00',
          current_reading: 200.0,
        },
      ];

      const fills = detectGaps(readings, 'current_reading', 'locator_readings', mockFkLookup, { isDirectReading: true });
      expect(fills).toHaveLength(0);
    });

    it('correctly uses the latest reading of a date when multiple intra-day readings exist', () => {
      // Worked example matching production incident:
      // Aug 31 has 3 readings: 06:00 (148,470), 07:00 (148,470), 21:56 (148,700)
      // Sep 02 has reading: 06:06 (148,902)
      // Pre-gap anchor MUST be Aug 31 21:56 (148,700), NOT 06:00 (148,470)!
      // Sep 01 interpolated value = 148,700 + (148,902 - 148,700)/2 = 148,801.00 (positive delta +101.00)
      const readings: RawReading[] = [
        {
          id: 'r1',
          locator_id: 'loc-amalfi',
          plant_id: 'plant-amalfi',
          reading_datetime: '2026-08-31T06:00:00+08:00',
          current_reading: 148470,
        },
        {
          id: 'r2',
          locator_id: 'loc-amalfi',
          plant_id: 'plant-amalfi',
          reading_datetime: '2026-08-31T07:00:00+08:00',
          current_reading: 148470,
        },
        {
          id: 'r3',
          locator_id: 'loc-amalfi',
          plant_id: 'plant-amalfi',
          reading_datetime: '2026-08-31T21:56:00+08:00',
          current_reading: 148700,
        },
        {
          id: 'r4',
          locator_id: 'loc-amalfi',
          plant_id: 'plant-amalfi',
          reading_datetime: '2026-09-02T06:06:00+08:00',
          current_reading: 148902,
        },
      ];

      const fills = detectGaps(readings, 'current_reading', 'locator_readings', mockFkLookup);
      expect(fills).toHaveLength(1);
      expect(fills[0].reading_id).toBe(`${GAP_FILL_PREFIX}:loc-amalfi:2026-09-01`);
      expect(fills[0].corrected_value).toBe(148801.00);
      expect(fills[0].corrected_value).toBeGreaterThan(148700); // delta vs Aug 31 21:56 is +101.00, not -14.00
      expect(fills[0].corrected_value).toBeLessThan(148902);
    });

    it('excludes existing estimated rows from anchoring gap fills', () => {
      const readings: RawReading[] = [
        {
          id: 'r1',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-08-31T21:56:00+08:00',
          current_reading: 148700,
          is_estimated: false,
        },
        {
          id: 'r-stale-est',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-09-01T12:00:00+08:00',
          current_reading: 148686, // Stale / buggy estimate
          is_estimated: true,
        },
        {
          id: 'r2',
          locator_id: 'loc-1',
          plant_id: 'plant-1',
          reading_datetime: '2026-09-02T06:06:00+08:00',
          current_reading: 148902,
          is_estimated: false,
        },
      ];

      // Because the Sep 01 row is estimated, detectGaps must look across it between r1 and r2
      const fills = detectGaps(readings, 'current_reading', 'locator_readings', mockFkLookup);
      expect(fills).toHaveLength(1);
      expect(fills[0].reading_id).toBe(`${GAP_FILL_PREFIX}:loc-1:2026-09-01`);
      expect(fills[0].corrected_value).toBe(148801.00);
    });
  });
});
