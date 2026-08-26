import { describe, it, expect } from 'vitest';
import { computeIntraFileDuplicateIndices, parseCSVText, normalizeDatetime } from './ReadingImportDialog';

// BUG (reported 2026-08-22): importing a Power CSV for a plant with multiple
// grid meters — one row per meter, same plant_name + reading_datetime,
// different meter_name — silently dropped every meter after the first. The
// intra-file dedup key was plant|date only, so rows for meter 2 and 3
// collided with meter 1's key and were flagged (and removed) as duplicates
// before insertRows ever ran the actual meter-resolution logic.
describe('computeIntraFileDuplicateIndices — power module, multi-meter plants', () => {
  it('does NOT flag separate meters on the same plant+date as duplicates', () => {
    const rows = [
      { plant_name: 'SRP', meter_name: 'Grid Meter 1 STP',     meter_reading_kwh: '597.18',  reading_datetime: '2026-08-22T03:12' },
      { plant_name: 'SRP', meter_name: 'Grid Meter 2 Pumphouse', meter_reading_kwh: '3120.00', reading_datetime: '2026-08-22T03:12' },
      { plant_name: 'SRP', meter_name: 'Grid Meter 3 Main',     meter_reading_kwh: '9110.80', reading_datetime: '2026-08-22T03:12' },
    ];
    expect(computeIntraFileDuplicateIndices(rows, 'power')).toEqual([]);
  });

  it('is case/whitespace-insensitive on meter_name, and still allows a legitimate re-read later the same day', () => {
    const rows = [
      { plant_name: 'SRP', meter_name: '  Grid Meter 1 STP',   meter_reading_kwh: '597.18', reading_datetime: '2026-08-22T03:12' },
      { plant_name: 'SRP', meter_name: 'grid meter 1 stp',     meter_reading_kwh: '597.20', reading_datetime: '2026-08-22T03:12' }, // real dup of row 0
      { plant_name: 'SRP', meter_name: 'Grid Meter 2 Pumphouse', meter_reading_kwh: '3120.00', reading_datetime: '2026-08-22T03:12' },
    ];
    expect(computeIntraFileDuplicateIndices(rows, 'power')).toEqual([1]);
  });

  it('still flags true duplicates for single-meter plants (blank meter_name repeated)', () => {
    const rows = [
      { plant_name: 'Umapad', meter_reading_kwh: '100', reading_datetime: '2026-08-22T03:12' },
      { plant_name: 'Umapad', meter_reading_kwh: '101', reading_datetime: '2026-08-22T09:00' }, // same date, blank meter_name → still a dup
    ];
    expect(computeIntraFileDuplicateIndices(rows, 'power')).toEqual([1]);
  });

  it('treats different plants with the same meter label as distinct', () => {
    const rows = [
      { plant_name: 'SRP',   meter_name: 'Grid Meter 1', meter_reading_kwh: '1', reading_datetime: '2026-08-22T03:12' },
      { plant_name: 'Guizo', meter_name: 'Grid Meter 1', meter_reading_kwh: '2', reading_datetime: '2026-08-22T03:12' },
    ];
    expect(computeIntraFileDuplicateIndices(rows, 'power')).toEqual([]);
  });
});

describe('computeIntraFileDuplicateIndices — non-power modules unaffected', () => {
  it('ignores meter_name entirely and keys on entity name + full datetime', () => {
    const rows = [
      { well_name: 'Well A', current_reading: '10', reading_datetime: '2026-08-22T03:12', meter_name: 'irrelevant' },
      { well_name: 'Well A', current_reading: '11', reading_datetime: '2026-08-22T03:12' }, // true dup: same well, same minute
      { well_name: 'Well B', current_reading: '12', reading_datetime: '2026-08-22T03:12' }, // different well, not a dup
    ];
    expect(computeIntraFileDuplicateIndices(rows, 'well')).toEqual([1]);
  });
});

// Sanity checks on the two lower-level helpers computeIntraFileDuplicateIndices builds on.
describe('normalizeDatetime + parseCSVText (sanity)', () => {
  it('pads single-digit hours and swaps the space separator for T', () => {
    expect(normalizeDatetime('2026-08-22 3:12')).toBe('2026-08-22T03:12');
  });

  it('parses a simple CSV into row objects keyed by header', () => {
    const rows = parseCSVText('plant_name,meter_name\nSRP,Grid Meter 1\nSRP,Grid Meter 2\n');
    expect(rows).toEqual([
      { plant_name: 'SRP', meter_name: 'Grid Meter 1' },
      { plant_name: 'SRP', meter_name: 'Grid Meter 2' },
    ]);
  });
});
