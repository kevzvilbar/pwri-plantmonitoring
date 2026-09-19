import { describe, it, expect, afterEach } from 'vitest';
import { fmtIsoDate } from './format';

describe('fmtIsoDate', () => {
  const originalTz = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTz; });

  // Regression test for a bug where fmtIsoDate bucketed readings onto the
  // wrong Manila calendar day whenever the code ran with a local runtime
  // timezone other than UTC+0 — including Asia/Manila itself, the one
  // timezone this app is built for. The old implementation round-tripped
  // through `new Date(dt.toLocaleString('en-US', { timeZone: PH_TZ }))`,
  // which drops the timezone marker and re-parses using the runtime's own
  // local zone. See lib/format.ts's fmtIsoDate doc comment for the full
  // writeup; this test pins the fix so it can't silently regress back to
  // that pattern.
  const cases: [string, string, string][] = [
    ['2026-08-14T20:46:00.000Z', '2026-08-15', 'early-morning Manila reading (04:46 AM PHT)'],
    ['2026-08-14T15:59:00.000Z', '2026-08-14', 'just before Manila midnight (23:59 PHT)'],
    ['2026-08-14T16:00:00.000Z', '2026-08-15', 'exactly Manila midnight (00:00 PHT)'],
    ['2026-08-14T04:00:00.000Z', '2026-08-14', 'Manila noon (12:00 PHT)'],
  ];

  for (const tz of ['UTC', 'Asia/Manila', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    it(`buckets to the correct Manila calendar day regardless of runtime TZ (TZ=${tz})`, () => {
      process.env.TZ = tz;
      for (const [input, expected, label] of cases) {
        expect(fmtIsoDate(input), `${label} under runtime TZ=${tz}`).toBe(expected);
      }
    });
  }

  it('returns an empty string for null/undefined/invalid input instead of throwing', () => {
    expect(fmtIsoDate(null)).toBe('');
    expect(fmtIsoDate(undefined)).toBe('');
    expect(fmtIsoDate('not-a-date')).toBe('');
  });
});
