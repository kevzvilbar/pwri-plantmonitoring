import { describe, it, expect } from 'vitest';
import { formatBytes, rowsPerDay, daysUntilBytes, type StorageTableInfo } from './storageRetention';

/**
 * These helpers are what the admin Storage & Retention card actually renders, and
 * the numbers they produce drive the retention-window decision for
 * ro_train_readings / ro_pretreatment_readings (see
 * supabase/migrations/20260916000005_reading_storage_report.sql). Pinning them
 * here keeps the SQL side free to return raw numbers.
 */

/** Minimal table row; every test overrides only the fields it exercises. */
function table(overrides: Partial<StorageTableInfo>): StorageTableInfo {
  return {
    table: 'ro_train_readings',
    total_size: '1 MB',
    total_bytes: 1024 * 1024,
    heap_bytes: 0,
    index_bytes: 0,
    toast_bytes: 0,
    est_rows: 0,
    exact_rows: null,
    oldest_reading: null,
    newest_reading: null,
    rows_last_7d: 0,
    avg_row_bytes: null,
    projected_bytes_per_day: null,
    indexes: [],
    ...overrides,
  };
}

describe('formatBytes', () => {
  it('renders bytes without a decimal point', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('steps up through the units at 1024 boundaries', () => {
    expect(formatBytes(1024)).toBe('1.0 kB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
  });

  it('drops the decimal once the value is 10 or more (so column widths stay stable)', () => {
    expect(formatBytes(9.9 * 1024)).toBe('9.9 kB');
    expect(formatBytes(10 * 1024)).toBe('10 kB');
    expect(formatBytes(340 * 1024 * 1024)).toBe('340 MB');
  });

  it('returns the placeholder for absent or non-finite values instead of "NaN B"', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('rowsPerDay', () => {
  it('divides the 7-day window by 7', () => {
    // These tables are written hourly per train: 1 train x 24 h x 7 d = 168.
    expect(rowsPerDay(table({ rows_last_7d: 168 }))).toBe(24);
    // 6 trains, hourly = 1008/week.
    expect(rowsPerDay(table({ rows_last_7d: 1008 }))).toBe(144);
  });

  it('is 0 — not null — for a table that stopped growing, so callers can show "idle"', () => {
    expect(rowsPerDay(table({ rows_last_7d: 0 }))).toBe(0);
  });
});

describe('daysUntilBytes', () => {
  it('projects remaining headroom from the measured growth rate', () => {
    // 900 MB used, 1 GB limit, 10 MB/day -> ~12 days of headroom.
    const result = daysUntilBytes(
      table({ total_bytes: 900 * 1024 * 1024, projected_bytes_per_day: 10 * 1024 * 1024 }),
      1024 * 1024 * 1024,
    );
    expect(result).toBe(12);
  });

  it('returns 0 once the limit is already met or exceeded', () => {
    const limit = 1024 * 1024 * 1024;
    expect(daysUntilBytes(table({ total_bytes: limit, projected_bytes_per_day: 1 }), limit)).toBe(0);
    expect(daysUntilBytes(table({ total_bytes: limit + 1, projected_bytes_per_day: 1 }), limit)).toBe(0);
  });

  it('returns null when there is no growth to extrapolate from', () => {
    // null (report could not measure) and 0/negative (idle or shrinking) both mean
    // "no projection", which is the honest answer rather than an infinite one.
    expect(daysUntilBytes(table({ projected_bytes_per_day: null }), 1024)).toBeNull();
    expect(daysUntilBytes(table({ projected_bytes_per_day: 0 }), 1024)).toBeNull();
    expect(daysUntilBytes(table({ projected_bytes_per_day: -5 }), 1024)).toBeNull();
  });
});