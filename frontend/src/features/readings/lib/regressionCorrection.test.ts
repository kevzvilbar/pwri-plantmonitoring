import { describe, it, expect } from 'vitest';
import {
  runOLS,
  getResetThreshold,
  getZThreshold,
  median,
  type RawReading,
} from './regressionCorrection';

/** Build a chronological series of readings, one per day starting at a fixed anchor. */
function daily(values: (number | null)[], column = 'daily_volume'): RawReading[] {
  const start = new Date('2026-01-01T00:00:00Z').getTime();
  const DAY = 86_400_000;
  return values.map((v, i) => ({
    id: `r${i}`,
    reading_datetime: new Date(start + i * DAY).toISOString(),
    [column]: v,
  }));
}

describe('median', () => {
  it('returns the middle value for an odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns 0 for an empty array (matches the callers, which all guard against this)', () => {
    expect(median([])).toBe(0);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('getResetThreshold', () => {
  it('uses a tight 500-unit threshold for known rate/quality columns', () => {
    expect(getResetThreshold('permeate_tds')).toBe(500);
    expect(getResetThreshold('recovery_pct')).toBe(500);
    expect(getResetThreshold('daily_volume')).toBe(500);
  });

  it('uses a loose 1,000,000-unit threshold for cumulative meter columns', () => {
    expect(getResetThreshold('current_reading')).toBe(1_000_000);
    expect(getResetThreshold('some_unrecognized_column')).toBe(1_000_000);
  });
});

describe('getZThreshold', () => {
  it('tightens the cutoff for small datasets so obvious spikes are not missed', () => {
    expect(getZThreshold(5)).toBe(2.0);
    expect(getZThreshold(19)).toBe(2.0);
  });

  it('relaxes at the documented size breakpoints', () => {
    expect(getZThreshold(20)).toBe(2.5);
    expect(getZThreshold(99)).toBe(2.5);
    expect(getZThreshold(100)).toBe(3.0);
    expect(getZThreshold(10_000)).toBe(3.0);
  });
});

describe('runOLS — insufficient data', () => {
  it('returns null stats and an "insufficient data" note for every row under MIN_ROWS (5)', () => {
    const readings = daily([10, 12, 11, 13]); // only 4 valid points
    const result = runOLS(readings, 'daily_volume');
    expect(result.stats).toEqual({ r_squared: null, slope: null, intercept: null });
    expect(result.resetCount).toBe(0);
    expect(result.corrections).toHaveLength(4);
    expect(result.corrections.every((c) => c.note === 'Insufficient data for analysis')).toBe(true);
  });
});

describe('runOLS — a clean linear trend', () => {
  it('fits the line closely (high r_squared) and flags nothing as an outlier', () => {
    // Perfectly linear: value = 10 * day + 100, small deterministic wobble.
    const values = [100, 110, 119, 130, 141, 150, 160, 169, 180, 191];
    const readings = daily(values);
    const result = runOLS(readings, 'daily_volume');

    expect(result.stats.r_squared).not.toBeNull();
    expect(result.stats.r_squared!).toBeGreaterThan(0.999);
    expect(result.stats.slope!).toBeCloseTo(10, 0);
    expect(result.resetCount).toBe(0);
    expect(result.corrections.every((c) => !c.is_outlier)).toBe(true);
    expect(result.corrections.every((c) => c.note === 'within normal range')).toBe(true);
  });
});

describe('runOLS — statistical (OLS residual) outliers', () => {
  it('flags a single reading that breaks an otherwise-clean linear trend, and corrects it to the regression projection', () => {
    // Same clean trend as above, but row 5 (index 5, value 150) is replaced
    // with a wild spike (150 -> 400) that's too small to trip the reset-delta
    // threshold (500 for daily_volume) but way outside the regression line.
    const values = [100, 110, 119, 130, 141, 400, 160, 169, 180, 191];
    const readings = daily(values);
    const result = runOLS(readings, 'daily_volume');

    const flagged = result.corrections.filter((c) => c.is_outlier);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reading_id).toBe('r5');
    expect(flagged[0].original_value).toBe(400);
    expect(flagged[0].note).toContain('statistical outlier');
    expect(flagged[0].note).toContain('high');
    // Corrected toward the regression line, i.e. much closer to the ~150
    // the clean trend predicts than to the mis-entered 400.
    expect(flagged[0].corrected_value!).toBeLessThan(250);
    expect(flagged[0].z_score).not.toBeNull();
  });

  it('flags the low-direction the same way as the high-direction', () => {
    const values = [100, 110, 119, 130, 141, -100, 160, 169, 180, 191];
    const readings = daily(values);
    const result = runOLS(readings, 'daily_volume');

    const flagged = result.corrections.filter((c) => c.is_outlier);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].reading_id).toBe('r5');
    expect(flagged[0].note).toContain('low');
  });

  it('does not flag ordinary noise that stays within a reasonable band around the trend', () => {
    // +/- ~2 around a clean 10/day trend -- normal measurement noise, not an outlier.
    const values = [100, 111, 118, 131, 139, 151, 158, 171, 179, 190];
    const readings = daily(values);
    const result = runOLS(readings, 'daily_volume');
    expect(result.corrections.every((c) => !c.is_outlier)).toBe(true);
  });
});

describe('runOLS — reset/mis-entry anomalies take priority over OLS outliers', () => {
  it('flags a single mis-keyed reading that bounces back next row as a reset anomaly, not a statistical outlier, and interpolates from the surrounding stable rate', () => {
    // Cumulative meter column (not in RATE_COLUMNS -> 1,000,000 threshold).
    // Steady ~1000/day increase; row 5 is a single mis-keyed value (an extra
    // digit: 50,000,000 instead of ~5,005,000) and row 6 bounces straight
    // back to the trend, the way an operator re-typing the correct value
    // the next day actually looks.
    const values = [
      5_000_000, 5_001_000, 5_002_000, 5_003_000, 5_004_000,
      50_000_000, // mis-keyed
      5_006_000, 5_007_000, 5_008_000, 5_009_000, // bounces back to trend
    ];
    const readings = daily(values, 'current_reading');
    const result = runOLS(readings, 'current_reading');

    const resetRow = result.corrections[5];
    expect(resetRow.is_outlier).toBe(true);
    expect(resetRow.z_score).toBeNull(); // reset corrections don't carry a z-score
    expect(resetRow.note).toContain('reset anomaly correction');
    expect(result.resetCount).toBe(1);

    // Corrected toward the ~5,005,000 the surrounding trend implies, nowhere
    // near the mis-keyed 50,000,000.
    expect(resetRow.corrected_value!).toBeGreaterThan(5_004_000);
    expect(resetRow.corrected_value!).toBeLessThan(5_006_000);

    // The row right after a bounce-back should NOT itself be flagged.
    expect(result.corrections[6].is_outlier).toBe(false);
    const olsFlaggedSameRow = result.corrections.filter((c) => c.note.includes('statistical outlier'));
    expect(olsFlaggedSameRow.find((c) => c.reading_id === 'r5')).toBeUndefined();
  });

  it(
    'CHARACTERIZATION: a sustained scale change (not a single value that bounces back — e.g. an ' +
    'actual meter replacement/rollover with no is_meter_replacement flag on these rows) cascades into ' +
    'every subsequent row also being flagged, because the corrected value is carried forward as the new ' +
    'baseline (fix #7\'s anti-cascade guard compares each row to the PREVIOUS EFFECTIVE value, so once ' +
    'row 5 is "corrected" upward, row 6\'s genuinely-normal low value now looks like another huge drop ' +
    'against that inflated baseline, and so on for every row after it)',
    () => {
      // Same shape as the test above, except the meter genuinely resets to a
      // low baseline and CONTINUES from there — no bounce-back. This is what
      // runOLS actually receives for a real physical meter swap/rollover
      // that isn't separately marked is_meter_replacement / is_meter_rollover
      // (those flags exist in readingGuards.ts / buildEntityPivot for the
      // live entry path, but runOLS's RawReading rows don't carry them).
      const values = [
        5_000_000, 5_001_000, 5_002_000, 5_003_000, 5_004_000,
        1_000, 2_000, 3_000, 4_000, 5_000, // genuine reset, continues at the new low baseline
      ];
      const readings = daily(values, 'current_reading');
      const result = runOLS(readings, 'current_reading');

      // This is the surprising part: every row from the reset onward gets
      // flagged and "corrected" to an ever-increasing value with no relation
      // to the actual (now-reset) readings — not just the one genuine anomaly.
      expect(result.resetCount).toBe(5);
      expect(result.corrections.slice(5).every((c) => c.is_outlier)).toBe(true);
      // The "corrected" values drift further from the real data with each
      // row instead of settling near the new, legitimately lower baseline.
      const correctedValues = result.corrections.slice(5).map((c) => c.corrected_value!);
      expect(correctedValues).toEqual([...correctedValues].sort((a, b) => a - b)); // monotonically increasing
      expect(correctedValues[correctedValues.length - 1]).toBeGreaterThan(5_000_000);
      // i.e. a reviewer looking at this analysis run would see five rows
      // flagged as "reset anomalies" needing correction, when in reality
      // only the meter's baseline changed and the readings themselves are
      // fine — worth flagging to whoever owns this workflow (see
      // pwri-improvement-plan.md Phase 2) since it means a real meter
      // replacement without an is_meter_replacement-equivalent marker on
      // these specific rows produces a run of false positives, not one.
    },
  );
});

describe('runOLS — missing values', () => {
  it('marks rows with a null/missing value for the target column as "Missing value — skipped" rather than treating them as zero', () => {
    const readings = daily([100, 110, null, 130, 141, 150, 160, 169, 180, 191]);
    const result = runOLS(readings, 'daily_volume');
    const missingRow = result.corrections[2];
    expect(missingRow.original_value).toBeNull();
    expect(missingRow.corrected_value).toBeNull();
    expect(missingRow.note).toBe('Missing value — skipped');
    // The other 9 valid rows should still be enough to run OLS (>= MIN_ROWS).
    expect(result.stats.slope).not.toBeNull();
  });
});

describe('runOLS — column-dependent reset threshold in practice', () => {
  it('a delta that trips the reset threshold for a rate column would NOT trip it for a meter column', () => {
    // 500 is a huge jump for a 'daily_volume'-style rate column (threshold
    // 500 -> triggers at >500) but tiny for a cumulative meter column
    // (threshold 1,000,000).
    const rateValues = [10, 12, 11, 600, 13, 12, 11, 10, 12, 11];
    const rateResult = runOLS(daily(rateValues, 'daily_volume'), 'daily_volume');
    expect(rateResult.resetCount).toBeGreaterThanOrEqual(1);

    const meterValues = [10, 12, 11, 600, 13, 12, 11, 10, 12, 11];
    const meterResult = runOLS(daily(meterValues, 'current_reading'), 'current_reading');
    expect(meterResult.resetCount).toBe(0);
  });
});
