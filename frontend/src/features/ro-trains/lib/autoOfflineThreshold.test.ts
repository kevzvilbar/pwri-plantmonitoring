import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AUTO_OFFLINE_THRESHOLD_HOURS, ONE_HOUR_MS, TWO_HOURS_MS } from './autoOfflineThreshold';
// The two former hand-rolled copies of the threshold, re-exported from their
// original homes — every one of these must agree with the shared module:
import { AUTO_OFFLINE_THRESHOLD_HOURS as TIMELINE_THRESHOLD_HOURS } from './trainStatusTimeline';
import { TWO_HOURS_MS as HELPERS_TWO_HOURS_MS, ONE_HOUR_MS as HELPERS_ONE_HOUR_MS } from '@/features/ro-trains/helpers';

// The 2h auto-offline threshold used to exist as three independent
// hand-rolled constants + an inline literal. They drifted once (1h vs 2h,
// fixed 2026-09-12): train cards showed "Offline" a full hour before the
// flagger would ever act on it. Everything now imports
// lib/autoOfflineThreshold.ts; the value assertions below still fail if any
// re-export stops matching, and the source-scan assertions fail if a local
// literal copy is reintroduced anywhere — so drift breaks CI instead of
// shipping again.

const SHARED_FILES = [
  '../../../hooks/useTrainAutoOffline.ts',
  './trainStatusTimeline.ts',
  '../helpers.tsx',
  '../pretreatment/hooks/usePretreatmentData.ts',
] as const;

describe('auto-offline threshold — single source of truth', () => {
  it('the shared constant is the business rule: 2 hours', () => {
    expect(AUTO_OFFLINE_THRESHOLD_HOURS).toBe(2);
    expect(ONE_HOUR_MS).toBe(3_600_000);
    expect(TWO_HOURS_MS).toBe(2 * ONE_HOUR_MS);
  });

  it('lib/trainStatusTimeline re-exports the shared constant unchanged', () => {
    expect(TIMELINE_THRESHOLD_HOURS).toBe(AUTO_OFFLINE_THRESHOLD_HOURS);
  });

  it("features/ro-trains/helpers' TWO_HOURS_MS / ONE_HOUR_MS match the shared module", () => {
    expect(HELPERS_TWO_HOURS_MS).toBe(TWO_HOURS_MS);
    expect(HELPERS_ONE_HOUR_MS).toBe(ONE_HOUR_MS);
  });

  it.each(SHARED_FILES)(
    '%s imports the shared module instead of defining a local copy',
    (relPath) => {
      const src = readFileSync(new URL(relPath, import.meta.url), 'utf8');
      expect(src).toContain('autoOfflineThreshold');
      // No reintroduced local definitions of either spelling:
      expect(src).not.toMatch(/AUTO_OFFLINE_THRESHOLD_HOURS\s*=\s*\d/);
      expect(src).not.toMatch(/TWO_HOURS_MS\s*=\s*2/);
      expect(src).not.toMatch(/2\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    },
  );
});
