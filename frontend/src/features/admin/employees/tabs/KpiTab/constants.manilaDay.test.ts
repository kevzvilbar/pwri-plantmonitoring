import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateDays2 } from './constants';
import { fmtIsoDate } from '@/lib/format';

/**
 * Manila is UTC+8, so its midnight lands 8 hours before UTC's. Every day, for
 * the 8 hours between Manila midnight and Manila 08:00, `new Date()` is still
 * on the PREVIOUS UTC calendar day. `generateDays2` used to compute "today" (and
 * every day in its range) with a local `fmtIsoDate` that did `.toISOString()
 * .slice(0, 10)` — the UTC day. During that 8-hour window, the KPI dashboard's
 * "today" column silently stayed on yesterday: none of today's readings had
 * landed on it yet, wrongly crediting the day as complete rather than pending,
 * and the whole 30-day grid was mislabeled by one day.
 *
 * This is a different bug from the same-looking `new Date(x.toLocaleString(...
 * timeZone))` round-trip elsewhere in useKpiData.ts's `elapsedFraction`, which
 * IS timezone-safe (write "local", read back with the matching "local" getter —
 * the two local interpretations cancel out regardless of what the runtime's own
 * timezone is). Confirmed empirically before touching that one; it was left as
 * is.
 */

// A UTC instant inside the earlier-Manila-day window: 2026-09-21T20:46:00Z is
// 2026-09-22T04:46 Manila — the actual current day is the 22nd everywhere.
const MANILA_EARLY_MORNING = '2026-09-21T20:46:00Z';

describe('generateDays2 (Manila day, not UTC day)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['UTC', 'Asia/Manila', 'America/New_York', 'Pacific/Auckland'])(
    "in %s, 'today' during Manila's early-morning window is the Manila date, not the UTC date",
    (tz) => {
      process.env.TZ = tz;
      vi.setSystemTime(new Date(MANILA_EARLY_MORNING));

      expect(generateDays2('today')).toEqual(['2026-09-22']); // NOT '2026-09-21' (the UTC day)
      const days = generateDays2(7);
      expect(days.at(-1)).toBe('2026-09-22');
      expect(days).toHaveLength(7);
    },
  );

  it('the last day of a multi-day range is always today\u2019s Manila date, and each day before it is one Manila day earlier', () => {
    vi.setSystemTime(new Date(MANILA_EARLY_MORNING));
    const days = generateDays2(7);
    expect(days).toEqual([
      '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
    ]);
  });
});

describe('generateDays2 stays in step with fmtIsoDate(new Date()) — what useKpiData.ts\'s todayStr now uses', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['UTC', 'Pacific/Auckland'])(
    'in %s, the grid\u2019s last day equals todayStr, so "isToday" actually matches the visible last column',
    (tz) => {
      // Before this fix these used two DIFFERENT UTC-based helpers that happened
      // to agree with each other (both wrong the same way); fixing only one
      // would have put them a day apart instead of fixing the mismatch.
      process.env.TZ = tz;
      vi.setSystemTime(new Date(MANILA_EARLY_MORNING));
      const todayStr = fmtIsoDate(new Date());
      expect(generateDays2(7).at(-1)).toBe(todayStr);
    },
  );
});
