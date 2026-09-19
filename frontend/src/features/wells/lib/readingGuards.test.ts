import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// readingGuards.ts calls supabase.from(...).select()...await, directly —
// no existing test in this repo mocks the Supabase client (checked before
// writing this), so this establishes that pattern. The mock below stands in
// for supabase-js's PostgrestFilterBuilder: every filter method returns the
// same chainable object, and the object itself is "thenable" (has a .then)
// so `await (supabase.from(...)... as any)` resolves the same way the real
// client does, without actually awaiting a network call.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from '@/integrations/supabase/client';
import {
  evaluateReadingGuard,
  fetchLastGoodReading,
  formatCooldown,
  LOCATOR_COOLDOWN_MINUTES,
  SPIKE_MULTIPLIER,
  DUPLICATE_VALUE_WINDOW_HOURS,
} from './readingGuards';

/** Loosely-typed stand-in for a mocked DB row — shape varies per test. */
type MockRow = Record<string, unknown>;

interface SupabaseQueryMock {
  select: () => SupabaseQueryMock;
  eq: () => SupabaseQueryMock;
  not: () => SupabaseQueryMock;
  lt: () => SupabaseQueryMock;
  order: () => SupabaseQueryMock;
  limit: () => SupabaseQueryMock;
  then: (resolve: (v: { data: MockRow[] | null; error: unknown }) => void) => void;
}

function makeQueryResult(data: MockRow[] | null, error: unknown = null): SupabaseQueryMock {
  const builder: SupabaseQueryMock = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    lt: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve) => resolve({ data, error }),
  };
  return builder;
}

/**
 * Queues successive supabase.from(...) call results in call order.
 * evaluateReadingGuard always calls supabase.from() twice, in this order:
 *   1. cooldown check (recentUserEntry)
 *   2. last-good-reading fetch (lastGood)
 * Pass [] (not null) for "no rows found", matching what supabase-js actually
 * returns for a query that matched nothing.
 */
function queueSupabaseResponses(...dataList: Array<MockRow[] | null>) {
  const mockFrom = supabase.from as unknown as Mock;
  mockFrom.mockReset();
  dataList.forEach((data) => {
    mockFrom.mockImplementationOnce(() => makeQueryResult(data));
  });
}

beforeEach(() => {
  (supabase.from as unknown as Mock).mockReset();
});

describe('evaluateReadingGuard — cooldown', () => {
  it('blocks when the same user logged a reading for this entity inside the cooldown window', async () => {
    const readingDatetime = new Date('2026-01-15T12:00:00Z');
    const lastDt = new Date('2026-01-15T11:50:00Z'); // 10 min ago — inside the 45 min window
    queueSupabaseResponses([{ reading_datetime: lastDt.toISOString() }]);

    const r = await evaluateReadingGuard('locator', 'loc-1', 'plant-1', 'user-1', 500, readingDatetime);
    expect(r).toEqual({
      status: 'blocked',
      reason: 'cooldown',
      minutesLeft: LOCATOR_COOLDOWN_MINUTES - 10,
      availableAt: new Date(lastDt.getTime() + LOCATOR_COOLDOWN_MINUTES * 60_000),
    });
    // Only the cooldown query should run — it short-circuits before the
    // last-good-reading fetch.
    expect((supabase.from as unknown as Mock).mock.calls.length).toBe(1);
  });

  it('does not block once the cooldown window has fully elapsed', async () => {
    const readingDatetime = new Date('2026-01-15T12:00:00Z');
    const lastDt = new Date('2026-01-15T11:00:00Z'); // 60 min ago — past the 45 min window
    queueSupabaseResponses(
      [{ reading_datetime: lastDt.toISOString() }], // cooldown query
      [], // no prior good reading -> falls through to 'ok'
    );

    const r = await evaluateReadingGuard('locator', 'loc-1', 'plant-1', 'user-1', 500, readingDatetime);
    expect(r).toEqual({ status: 'ok' });
  });

  it('is unaffected when the user has no prior entry for this entity at all', async () => {
    const readingDatetime = new Date('2026-01-15T12:00:00Z');
    queueSupabaseResponses([], []); // no cooldown entry, no prior good reading

    const r = await evaluateReadingGuard('locator', 'loc-1', 'plant-1', 'user-1', 500, readingDatetime);
    expect(r).toEqual({ status: 'ok' });
  });
});

describe('evaluateReadingGuard — duplicate value (raw mode)', () => {
  it('blocks an identical current_reading recorded well within the window (e.g. 31 min later)', async () => {
    const prevDt = new Date('2026-08-14T07:00:00Z');
    const readingDatetime = new Date('2026-08-14T07:31:00Z'); // 31 min later
    queueSupabaseResponses([], [{ current_reading: '220205', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard('well', 'well-1', 'plant-1', 'user-1', 220205, readingDatetime);
    expect(r.status).toBe('blocked');
    if (r.status === 'blocked' && r.reason === 'duplicate') {
      expect(r.detail).toContain('220,205');
      expect(r.detail).toContain('zero flow');
    } else {
      expect.fail(`expected a duplicate-value block, got ${JSON.stringify(r)}`);
    }
  });

  it(`does not block once ${DUPLICATE_VALUE_WINDOW_HOURS}h have fully elapsed, even with an identical value`, async () => {
    const prevDt = new Date('2026-08-14T07:00:00Z');
    const readingDatetime = new Date(prevDt.getTime() + (DUPLICATE_VALUE_WINDOW_HOURS + 1) * 3_600_000);
    queueSupabaseResponses([], [{ current_reading: '220205', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard('well', 'well-1', 'plant-1', 'user-1', 220205, readingDatetime);
    expect(r.status).not.toBe('blocked');
  });

  it('does not fire when the new value differs from the last confirmed reading', async () => {
    const prevDt = new Date('2026-08-14T07:00:00Z');
    const readingDatetime = new Date('2026-08-14T07:31:00Z');
    queueSupabaseResponses([], [{ current_reading: '220205', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard('well', 'well-1', 'plant-1', 'user-1', 220300, readingDatetime, false, false, 10);
    expect(r.status).not.toBe('blocked');
  });

  it('is skipped entirely in direct mode (a repeated day-volume is ordinary, not a duplicate)', async () => {
    const prevDt = new Date('2026-08-14T07:00:00Z');
    const readingDatetime = new Date('2026-08-14T07:31:00Z');
    queueSupabaseResponses([], [{ current_reading: '50', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard(
      'locator', 'loc-1', 'plant-1', 'user-1', 50, readingDatetime,
      false, false, null, false, 'direct',
    );
    expect(r.status).not.toBe('blocked');
  });

  it('is bypassed by isMeterReplacement', async () => {
    const prevDt = new Date('2026-08-14T07:00:00Z');
    const readingDatetime = new Date('2026-08-14T07:31:00Z');
    queueSupabaseResponses([], [{ current_reading: '220205', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard(
      'well', 'well-1', 'plant-1', 'user-1', 220205, readingDatetime,
      /* isMeterReplacement */ true,
    );
    expect(r.status).not.toBe('blocked');
  });

  it('is bypassed by isEstimated', async () => {
    const prevDt = new Date('2026-08-14T07:00:00Z');
    const readingDatetime = new Date('2026-08-14T07:31:00Z');
    queueSupabaseResponses([], [{ current_reading: '220205', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard(
      'well', 'well-1', 'plant-1', 'user-1', 220205, readingDatetime,
      false, /* isEstimated */ true,
    );
    expect(r.status).not.toBe('blocked');
  });

  it('is bypassed by isMeterRollover', async () => {
    const prevDt = new Date('2026-08-14T07:00:00Z');
    const readingDatetime = new Date('2026-08-14T07:31:00Z');
    queueSupabaseResponses([], [{ current_reading: '220205', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard(
      'well', 'well-1', 'plant-1', 'user-1', 220205, readingDatetime,
      false, false, null, /* isMeterRollover */ true,
    );
    expect(r.status).not.toBe('blocked');
  });

  it('never fires when there is no prior confirmed reading to compare against', async () => {
    const readingDatetime = new Date('2026-08-14T07:31:00Z');
    queueSupabaseResponses([], []); // no cooldown entry, no prior reading at all
    const r = await evaluateReadingGuard('well', 'well-1', 'plant-1', 'user-1', 220205, readingDatetime);
    expect(r).toEqual({ status: 'ok' });
  });
});

describe('evaluateReadingGuard — backward reading (raw mode)', () => {
  const readingDatetime = new Date('2026-01-15T12:00:00Z');
  const prevDt = new Date('2026-01-14T12:00:00Z'); // 24h earlier

  it('flags a lower cumulative reading than the last confirmed value', async () => {
    queueSupabaseResponses(
      [], // no cooldown entry
      [{ current_reading: '1000', reading_datetime: prevDt.toISOString() }],
    );
    const r = await evaluateReadingGuard('well', 'well-1', 'plant-1', 'user-1', 900, readingDatetime);
    expect(r.status).toBe('pending_review');
    if (r.status === 'pending_review') {
      expect(r.reason).toBe('backward');
      expect(r.detail).toContain('900');
      expect(r.detail).toContain('below last confirmed value');
      expect(r.detail).toContain('1,000');
    }
  });

  it('is bypassed by isMeterReplacement', async () => {
    queueSupabaseResponses([], [{ current_reading: '1000', reading_datetime: prevDt.toISOString() }]);
    const r = await evaluateReadingGuard(
      'well', 'well-1', 'plant-1', 'user-1', 900, readingDatetime,
      /* isMeterReplacement */ true,
    );
    expect(r.status).not.toBe('pending_review');
  });

  it('is bypassed by isEstimated', async () => {
    queueSupabaseResponses([], [{ current_reading: '1000', reading_datetime: prevDt.toISOString() }]);
    const r = await evaluateReadingGuard(
      'well', 'well-1', 'plant-1', 'user-1', 900, readingDatetime,
      false, /* isEstimated */ true,
    );
    expect(r.status).not.toBe('pending_review');
  });

  it('is bypassed by isMeterRollover', async () => {
    queueSupabaseResponses([], [{ current_reading: '1000', reading_datetime: prevDt.toISOString() }]);
    const r = await evaluateReadingGuard(
      'well', 'well-1', 'plant-1', 'user-1', 900, readingDatetime,
      false, false, null, /* isMeterRollover */ true,
    );
    expect(r.status).not.toBe('pending_review');
  });

  it('never fires when there is no prior confirmed reading to compare against (first-ever reading)', async () => {
    queueSupabaseResponses([], []); // no cooldown entry, no prior reading at all
    // currentReading here would look "backward" against most real values, but
    // with prevReading === null the check simply cannot fire.
    const r = await evaluateReadingGuard('well', 'well-1', 'plant-1', 'user-1', 1, readingDatetime);
    expect(r).toEqual({ status: 'ok' });
  });
});

describe('evaluateReadingGuard — backward reading is skipped entirely in direct mode', () => {
  it('a lower value than the last confirmed reading is ordinary variation, not "backward", in direct mode', async () => {
    const readingDatetime = new Date('2026-01-15T12:00:00Z');
    const prevDt = new Date('2026-01-14T12:00:00Z');
    queueSupabaseResponses([], [{ current_reading: '1000', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard(
      'locator', 'loc-1', 'plant-1', 'user-1', 900, readingDatetime,
      false, false, /* avgFlowRate */ null, false, /* inputMode */ 'direct',
    );
    // No avgFlowRate means the direct-mode spike check also can't fire —
    // this isolates that the backward check specifically was skipped.
    expect(r).toEqual({ status: 'ok' });
  });
});

describe('evaluateReadingGuard — spike detection', () => {
  it('flags a raw-mode reading whose implied flow rate clears the spike multiplier, with an m3/hr detail message', async () => {
    const readingDatetime = new Date('2026-01-15T12:00:00Z');
    const prevDt = new Date('2026-01-14T12:00:00Z'); // 24h earlier
    // delta 1000 over 24h -> ~41.7 m3/hr, vs avg 10 m3/hr -> well past 2.0x -> critical
    queueSupabaseResponses([], [{ current_reading: '0', reading_datetime: prevDt.toISOString() }]);

    const r = await evaluateReadingGuard(
      'well', 'well-1', 'plant-1', 'user-1', 1000, readingDatetime,
      false, false, /* avgFlowRate */ 10,
    );
    expect(r.status).toBe('pending_review');
    if (r.status === 'pending_review') {
      expect(r.reason).toBe('spike');
      expect(r.detail).toContain('m³/hr');
    }
  });

  it('flags a direct-mode reading whose volume itself clears the spike multiplier, with an m3/day detail message', async () => {
    const readingDatetime = new Date('2026-01-15T12:00:00Z');
    queueSupabaseResponses([], []); // lastGood irrelevant in direct mode's spike branch

    const r = await evaluateReadingGuard(
      'locator', 'loc-1', 'plant-1', 'user-1', /* currentReading (= period volume) */ 50, readingDatetime,
      false, false, /* avgFlowRate */ 10, false, 'direct',
    );
    expect(r.status).toBe('pending_review');
    if (r.status === 'pending_review') {
      expect(r.reason).toBe('spike');
      expect(r.detail).toContain('m³/day');
    }
  });

  it(`uses SPIKE_MULTIPLIER (${SPIKE_MULTIPLIER}x) as the critical threshold, matching fn_locator_reading_integrity`, async () => {
    const readingDatetime = new Date('2026-01-15T12:00:00Z');
    queueSupabaseResponses([], []);
    // 19 m3/day vs avg 10 -> 1.9x, just under the 2.0x default -> should NOT be critical
    const under = await evaluateReadingGuard(
      'locator', 'loc-1', 'plant-1', 'user-1', 19, readingDatetime,
      false, false, 10, false, 'direct',
    );
    expect(under.status).not.toBe('pending_review');

    queueSupabaseResponses([], []);
    // 21 m3/day vs avg 10 -> 2.1x, clears the 2.0x default -> critical
    const over = await evaluateReadingGuard(
      'locator', 'loc-1', 'plant-1', 'user-1', 21, readingDatetime,
      false, false, 10, false, 'direct',
    );
    expect(over.status).toBe('pending_review');
  });
});

describe('evaluateReadingGuard — clean path', () => {
  it('returns ok when cooldown is clear, the reading isn\'t backward, and the rate is within the normal band', async () => {
    const readingDatetime = new Date('2026-01-15T12:00:00Z');
    const prevDt = new Date('2026-01-14T12:00:00Z');
    queueSupabaseResponses([], [{ current_reading: '100', reading_datetime: prevDt.toISOString() }]);

    // delta 5 over 24h -> ~0.2 m3/hr, well within a 10 m3/hr average.
    const r = await evaluateReadingGuard('well', 'well-1', 'plant-1', 'user-1', 105, readingDatetime, false, false, 10);
    expect(r).toEqual({ status: 'ok' });
  });
});

describe('fetchLastGoodReading', () => {
  it('returns the parsed reading and date when a row is found', async () => {
    const dt = new Date('2026-01-10T08:00:00Z');
    queueSupabaseResponses([{ current_reading: '1234.5', reading_datetime: dt.toISOString() }]);
    const r = await fetchLastGoodReading('well', 'well-1', 'plant-1', new Date());
    expect(r.reading).toBe(1234.5);
    expect(r.dt).toEqual(dt);
  });

  it('returns nulls when no matching row exists', async () => {
    queueSupabaseResponses([]);
    const r = await fetchLastGoodReading('well', 'well-1', 'plant-1', new Date());
    expect(r).toEqual({ reading: null, dt: null });
  });

  it('returns nulls when data comes back null rather than an empty array', async () => {
    queueSupabaseResponses(null);
    const r = await fetchLastGoodReading('well', 'well-1', 'plant-1', new Date());
    expect(r).toEqual({ reading: null, dt: null });
  });
});

describe('formatCooldown', () => {
  it('formats under an hour as "N min"', () => {
    expect(formatCooldown(45)).toBe('45 min');
    expect(formatCooldown(1)).toBe('1 min');
    expect(formatCooldown(0)).toBe('0 min');
  });

  it('formats exactly one hour with no dangling "0 min"', () => {
    expect(formatCooldown(60)).toBe('1 hr');
    expect(formatCooldown(120)).toBe('2 hr');
  });

  it('formats hours plus a remainder as "H hr M min"', () => {
    expect(formatCooldown(90)).toBe('1 hr 30 min');
    expect(formatCooldown(150)).toBe('2 hr 30 min');
  });
});
