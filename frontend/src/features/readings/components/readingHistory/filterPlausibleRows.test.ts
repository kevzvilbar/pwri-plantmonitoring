import { describe, it, expect } from 'vitest';
import { filterPlausibleRows } from './filterPlausibleRows';

// Rows must be sorted descending by reading_datetime (newest first), as
// useReadingHistoryQuery returns them.
function directRow(date: string, volume: number, estimated = true) {
  return { reading_datetime: date, current_reading: volume, is_estimated: estimated, is_meter_rollover: false, is_meter_replacement: false };
}

describe('filterPlausibleRows', () => {
  it('regression: a direct-mode (period-volume) entity keeps every row, even non-monotonic ones', () => {
    // Reproduces the HAMAS locator history bug: a locator configured for
    // direct-volume input has a genuine, non-monotonic value every single
    // day, but most were silently vanishing from the table.
    const rows = [
      directRow('2026-09-22', 4883.80),
      directRow('2026-09-21', 4500.00),
      directRow('2026-09-20', 4600.00), // higher than its older neighbor (9/19) and newer (9/21) — would violate both
      directRow('2026-09-19', 4358.50),
      directRow('2026-09-18', 4900.00), // higher than everything around it
      directRow('2026-09-17', 4100.00),
    ];
    const result = filterPlausibleRows(rows, true);
    expect(result).toHaveLength(6);
    expect(result).toEqual(rows);
  });

  it('a cumulative meter (isDirectMode: false) still drops an estimate that breaks the increasing trend', () => {
    const rows = [
      { reading_datetime: '2026-09-22', current_reading: 100, is_estimated: false, is_meter_rollover: false, is_meter_replacement: false },
      { reading_datetime: '2026-09-21', current_reading: 40, is_estimated: true, is_meter_rollover: false, is_meter_replacement: false }, // dips below the older neighbor — implausible for a meter that only counts up
      { reading_datetime: '2026-09-20', current_reading: 50, is_estimated: false, is_meter_rollover: false, is_meter_replacement: false },
    ];
    const result = filterPlausibleRows(rows, false);
    expect(result.map((r: any) => r.reading_datetime)).toEqual(['2026-09-22', '2026-09-20']);
  });

  it('a cumulative meter keeps a plausible estimate that sits between its neighbors', () => {
    const rows = [
      { reading_datetime: '2026-09-22', current_reading: 100, is_estimated: false, is_meter_rollover: false, is_meter_replacement: false },
      { reading_datetime: '2026-09-21', current_reading: 75, is_estimated: true, is_meter_rollover: false, is_meter_replacement: false },
      { reading_datetime: '2026-09-20', current_reading: 50, is_estimated: false, is_meter_rollover: false, is_meter_replacement: false },
    ];
    const result = filterPlausibleRows(rows, false);
    expect(result).toHaveLength(3);
  });

  it('a cumulative meter never drops a rollover or replacement row, however non-monotonic it looks', () => {
    const rows = [
      { reading_datetime: '2026-09-22', current_reading: 10, is_estimated: true, is_meter_rollover: true, is_meter_replacement: false },
      { reading_datetime: '2026-09-21', current_reading: 9999, is_estimated: false, is_meter_rollover: false, is_meter_replacement: false },
    ];
    const result = filterPlausibleRows(rows, false);
    expect(result).toHaveLength(2);
  });

  it('handles empty and nullish input', () => {
    expect(filterPlausibleRows([], false)).toEqual([]);
    expect(filterPlausibleRows(null, false)).toEqual([]);
    expect(filterPlausibleRows(undefined, true)).toEqual([]);
  });
});
