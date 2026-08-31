import { describe, it, expect } from 'vitest';
import { computePivotFromReadingsNoCache } from './DataSummaryModal';

const iso = (d: string) => `${d}T12:00:00`;

describe('computePivotFromReadingsNoCache — HAMAS Production tab bug', () => {
  it(
    'an is_derived product meter (e.g. HAMAS) must be passed in directModeIds, ' +
    'or the Data Summary "Production" tab silently diffs two unrelated days ' +
    'against each other instead of showing that day\'s actual volume',
    () => {
      // Shaped like the real HAMAS History dialog values from the reported bug:
      // a day-to-day fluctuating direct-entry volume, not a cumulative meter.
      const readings = [
        { meter_id: 'hamas-mirror', reading_datetime: iso('2026-08-07'), current_reading: 4988, daily_volume: 4988 },
        { meter_id: 'hamas-mirror', reading_datetime: iso('2026-08-08'), current_reading: 5294, daily_volume: 5294 },
        { meter_id: 'hamas-mirror', reading_datetime: iso('2026-08-09'), current_reading: 5244, daily_volume: 5244 },
      ];

      // WITHOUT directModeIds — reproduces the exact bug: Aug 8 becomes
      // 5294-4988=306 (a coincidental, meaningless positive diff — matches
      // the "306" the team's own hamas_phase15 migration flagged as a live
      // symptom). Aug 9 becomes 5244-5294=-50: computePivotFromReadingsNoCache's
      // self-heal branch does NOT clamp negative deltas (unlike buildEntityPivot
      // in TrendChartPivotShared.tsx), so the raw pivot value is genuinely
      // negative here — it only reads as "-" once the modal's cell renderer
      // hides non-positive values.
      const broken = computePivotFromReadingsNoCache(readings, 'meter_id', 'daily_volume');
      expect(broken.get('2026-08-08')!.get('hamas-mirror')).toBe(306);
      expect(broken.get('2026-08-09')!.get('hamas-mirror')).toBe(-50);

      // WITH directModeIds (the fix) — each day shows its own real volume.
      const fixed = computePivotFromReadingsNoCache(readings, 'meter_id', 'daily_volume', new Set(['hamas-mirror']));
      expect(fixed.get('2026-08-07')!.get('hamas-mirror')).toBe(4988);
      expect(fixed.get('2026-08-08')!.get('hamas-mirror')).toBe(5294);
      expect(fixed.get('2026-08-09')!.get('hamas-mirror')).toBe(5244);
    },
  );
});
