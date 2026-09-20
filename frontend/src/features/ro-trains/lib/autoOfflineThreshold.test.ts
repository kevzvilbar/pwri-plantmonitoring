import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AUTO_OFFLINE_THRESHOLD_HOURS, ONE_HOUR_MS, TWO_HOURS_MS, isReadingGapStale } from './autoOfflineThreshold';
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

describe('isReadingGapStale — "uptime reported" attestation must unlock the RO log form', () => {
  const NOW = Date.parse('2026-09-20T17:45:00Z');
  const ago = (hours: number) => new Date(NOW - hours * ONE_HOUR_MS).toISOString();

  it('no attestation: stale from the 2h mark, exactly as before', () => {
    expect(isReadingGapStale(ago(1.99), null, NOW)).toBe(false);
    expect(isReadingGapStale(ago(2), null, NOW)).toBe(true);
    expect(isReadingGapStale(ago(9), undefined, NOW)).toBe(true);
  });

  it('no readings at all and no attestation: stale', () => {
    expect(isReadingGapStale(null, null, NOW)).toBe(true);
    expect(isReadingGapStale(undefined, undefined, NOW)).toBe(true);
    expect(isReadingGapStale('', '', NOW)).toBe(true);
  });

  it('regression (RO5): last reading 9h ago, attestation filed just now → NOT stale, so the form unlocks', () => {
    // Filing the attestation inserts no reading row, so the last reading stays
    // 9h old. Measuring from the reading alone kept the form locked forever.
    expect(isReadingGapStale(ago(9), ago(0), NOW)).toBe(false);
    expect(isReadingGapStale(ago(9), ago(1.5), NOW)).toBe(false);
  });

  it('an attestation is not a standing exemption: stale again 2h after covered_until', () => {
    expect(isReadingGapStale(ago(30), ago(1.99), NOW)).toBe(false);
    expect(isReadingGapStale(ago(30), ago(2), NOW)).toBe(true);
    expect(isReadingGapStale(ago(30), ago(6), NOW)).toBe(true);
  });

  it('a reading newer than the attestation wins (the later of the two counts)', () => {
    expect(isReadingGapStale(ago(0.5), ago(9), NOW)).toBe(false);
    expect(isReadingGapStale(ago(3), ago(9), NOW)).toBe(true);
  });

  it('an attestation alone (no readings yet) is enough to be not-stale', () => {
    expect(isReadingGapStale(null, ago(0.25), NOW)).toBe(false);
  });

  it('ignores unparseable timestamps instead of returning NaN-driven results', () => {
    expect(isReadingGapStale('not-a-date', ago(0.25), NOW)).toBe(false);
    expect(isReadingGapStale('not-a-date', 'also-bad', NOW)).toBe(true);
  });

  it('usePretreatmentData routes its staleness check through isReadingGapStale (and fetches the attestation)', () => {
    // relPath is a variable on purpose: Vite rewrites `new URL('literal', import.meta.url)` into an asset URL.
    const relPath = '../pretreatment/hooks/usePretreatmentData.ts';
    const src = readFileSync(new URL(relPath, import.meta.url), 'utf8');
    expect(src).toContain('isReadingGapStale(lastReadingTime, latestUptimeReport?.covered_until)');
    expect(src).toContain("from('ro_train_uptime_reports'");
  });

  it('filing an attestation invalidates the query the form reads it from', () => {
    const relPath = '../../../hooks/useTrainUptimeExemption.ts';
    const src = readFileSync(new URL(relPath, import.meta.url), 'utf8');
    expect(src).toContain("queryKey: ['ro-uptime-report-latest']");
  });
});
