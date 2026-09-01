import { describe, it, expect } from 'vitest';
import { detectGaps, calculateEvenSplitValues, GAP_FILL_PREFIX } from './gapDetection';
import { RawReading } from './regressionCorrection';

describe('gapDetection', () => {
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

    it('tags regression_flowrate method for longer gaps (> 5 days)', () => {
      const readings: RawReading[] = [
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

      expect(fills).toHaveLength(6); // 6 missing days between Aug 1 and Aug 8
      expect(fills[0].note).toContain('"method":"regression_flowrate"');
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
  });
});
