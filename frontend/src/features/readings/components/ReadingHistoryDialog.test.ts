import { describe, it, expect } from 'vitest';
import { getGridMeterVal } from './ReadingHistoryDialog';

describe('getGridMeterVal — Multi-meter power reading resolution & fallback', () => {
  it('returns direct reading from grid_meter_readings JSONB when present', () => {
    const row = {
      reading_datetime: '2026-09-04T06:43:00+08:00',
      meter_reading_kwh: 120.0,
      grid_meter_readings: { '0': 120.0, '1': 450.5, '2': 9231.3 },
      is_estimated: false,
    };
    expect(getGridMeterVal(row, 0, 0, [row])).toBe(120.0);
    expect(getGridMeterVal(row, 1, 0, [row])).toBe(450.5);
    expect(getGridMeterVal(row, 2, 0, [row])).toBe(9231.3);
  });

  it('falls back to meter_reading_kwh for meter 0 when grid_meter_readings is missing', () => {
    const row = {
      reading_datetime: '2026-09-04T06:43:00+08:00',
      meter_reading_kwh: 125.4,
      grid_meter_readings: null,
      is_estimated: false,
    };
    expect(getGridMeterVal(row, 0, 0, [row])).toBe(125.4);
    expect(getGridMeterVal(row, 1, 0, [row])).toBeNull();
    expect(getGridMeterVal(row, 2, 0, [row])).toBeNull();
  });

  it('interpolates secondary meters for auto-backfilled estimated rows when grid_meter_readings is null', () => {
    // Array sorted descending by reading_datetime (index 0 = latest, index 2 = oldest)
    const rowSep04 = {
      reading_datetime: '2026-09-04T12:00:00+08:00',
      meter_reading_kwh: 100.0,
      grid_meter_readings: { '0': 100.0, '1': 200.0, '2': 9231.3 },
      is_estimated: false,
    };
    const rowSep03Estimated = {
      reading_datetime: '2026-09-03T12:00:00+08:00',
      meter_reading_kwh: 90.0,
      grid_meter_readings: null, // Legacy/buggy backfill row had null JSONB
      is_estimated: true,
    };
    const rowSep02 = {
      reading_datetime: '2026-09-02T12:00:00+08:00',
      meter_reading_kwh: 80.0,
      grid_meter_readings: { '0': 80.0, '1': 160.0, '2': 9214.0 },
      is_estimated: false,
    };

    const allRows = [rowSep04, rowSep03Estimated, rowSep02];

    // Sep 03 is exactly halfway between Sep 02 (9214.0) and Sep 04 (9231.3)
    // 9214.0 + (9231.3 - 9214.0) / 2 = 9222.65 -> rounded to 9222.7
    const estValMeter2 = getGridMeterVal(rowSep03Estimated, 2, 1, allRows);
    expect(estValMeter2).toBe(9222.7);

    // Meter 1: 160.0 + (200.0 - 160.0) / 2 = 180.0
    const estValMeter1 = getGridMeterVal(rowSep03Estimated, 1, 1, allRows);
    expect(estValMeter1).toBe(180.0);

    // Meter 0: meter_reading_kwh was 90.0
    const valMeter0 = getGridMeterVal(rowSep03Estimated, 0, 1, allRows);
    expect(valMeter0).toBe(90.0);
  });

  it('handles multi-day gaps with non-symmetric timestamps accurately', () => {
    // 2-day gap: Day 1 (08-01 08:00), Day 2 (08-02 12:00 est), Day 3 (08-03 12:00 est), Day 4 (08-04 08:00)
    const rowAug04 = {
      reading_datetime: '2026-08-04T08:00:00+08:00',
      grid_meter_readings: { '2': 1000.0 },
      is_estimated: false,
    };
    const rowAug03 = {
      reading_datetime: '2026-08-03T08:00:00+08:00',
      grid_meter_readings: null,
      is_estimated: true,
    };
    const rowAug02 = {
      reading_datetime: '2026-08-02T08:00:00+08:00',
      grid_meter_readings: null,
      is_estimated: true,
    };
    const rowAug01 = {
      reading_datetime: '2026-08-01T08:00:00+08:00',
      grid_meter_readings: { '2': 700.0 },
      is_estimated: false,
    };

    const allRows = [rowAug04, rowAug03, rowAug02, rowAug01];

    // Total span: 3 days. Diff: 300. Step: 100/day
    // Aug 02 (1/3 of the way): 700 + 100 = 800
    expect(getGridMeterVal(rowAug02, 2, 2, allRows)).toBe(800.0);
    // Aug 03 (2/3 of the way): 700 + 200 = 900
    expect(getGridMeterVal(rowAug03, 2, 1, allRows)).toBe(900.0);
  });

  it('does NOT interpolate non-estimated rows if reading is truly missing', () => {
    const rowMissing = {
      reading_datetime: '2026-09-03T12:00:00+08:00',
      meter_reading_kwh: null,
      grid_meter_readings: {},
      is_estimated: false, // User submitted reading row but didn't enter this meter
    };
    const allRows = [
      { reading_datetime: '2026-09-04T12:00:00+08:00', grid_meter_readings: { '1': 100 } },
      rowMissing,
      { reading_datetime: '2026-09-02T12:00:00+08:00', grid_meter_readings: { '1': 50 } },
    ];
    expect(getGridMeterVal(rowMissing, 1, 1, allRows)).toBeNull();
  });
});

