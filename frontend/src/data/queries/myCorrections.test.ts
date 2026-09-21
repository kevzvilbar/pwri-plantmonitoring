import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { table: string; method: string; args: unknown[] };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  results: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => { h.calls.push({ table, method, args }); return builder; };
      }
      builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(h.results[table] ?? { data: [], error: null }).then(resolve, reject);
      return builder;
    },
  },
}));
// The two lookups that live in corrections.ts are exercised there; here they are stubbed.
const lookups = vi.hoisted(() => ({
  plants: vi.fn(async () => ({ p1: 'North Plant' } as Record<string, string>)),
  users: vi.fn(async () => ({ boss: '@maria' } as Record<string, string>)),
}));
vi.mock('./corrections', () => ({ fetchPlantNames: lookups.plants, fetchUsernames: lookups.users }));

import { fetchMyCorrectionRequests } from './myCorrections';

const REQUEST = {
  id: 'r1', source_table: 'well_readings', source_id: 'rd1', plant_id: 'p1',
  original_value: 100, proposed_value: 110, reason: 'Meter misread', note: null,
  status: 'rejected', resolved_by: 'boss', resolved_at: '2026-09-20T10:00:00Z',
  resolution_note: 'Reading was correct.', created_at: '2026-09-20T08:00:00Z',
};
const callsOn = (table: string): Call[] => h.calls.filter((c) => c.table === table);

describe('fetchMyCorrectionRequests (P5-6)', () => {
  beforeEach(() => {
    h.calls = [];
    h.results = {
      correction_requests: { data: [REQUEST], error: null },
      well_readings: { data: [{ id: 'rd1', well_id: 'w3', reading_datetime: '2026-09-20T06:00:00Z' }], error: null },
      wells: { data: [{ id: 'w3', name: 'Well 3' }], error: null },
    };
    lookups.plants.mockClear(); lookups.users.mockClear();
  });

  it("filters to the user's own requests: RLS lets a plant's users read ALL of its requests, so this cannot be left to RLS", async () => {
    await fetchMyCorrectionRequests('user-1');
    const eq = callsOn('correction_requests').find((c) => c.method === 'eq');
    expect(eq?.args).toEqual(['submitted_by', 'user-1']);
  });

  it('asks for newest first and caps the result', async () => {
    await fetchMyCorrectionRequests('user-1', 25);
    const cr = callsOn('correction_requests');
    expect(cr.find((c) => c.method === 'order')?.args).toEqual(['created_at', { ascending: false }]);
    expect(cr.find((c) => c.method === 'limit')?.args).toEqual([25]);
  });

  it('turns rows into named, resolved requests', async () => {
    const [r] = await fetchMyCorrectionRequests('user-1');
    expect(r).toMatchObject({
      id: 'r1', status: 'rejected', title: 'Well 3', subtitle: 'Well · North Plant',
      readingAt: '2026-09-20T06:00:00Z', resolvedByName: '@maria', resolutionNote: 'Reading was correct.',
    });
  });

  it('makes no query at all without a signed-in user', async () => {
    expect(await fetchMyCorrectionRequests('')).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('returns [] and does no lookups when the user has no requests', async () => {
    h.results.correction_requests = { data: [], error: null };
    expect(await fetchMyCorrectionRequests('user-1')).toEqual([]);
    expect(callsOn('well_readings')).toEqual([]);
    expect(lookups.plants).not.toHaveBeenCalled();
  });

  it('throws when the requests themselves cannot be loaded (the screen shows an error)', async () => {
    h.results.correction_requests = { data: null, error: new Error('permission denied') };
    await expect(fetchMyCorrectionRequests('user-1')).rejects.toThrow('permission denied');
  });

  it('a failed name lookup degrades to a generic label instead of failing the screen', async () => {
    h.results.wells = { data: null, error: new Error('boom') };
    const [r] = await fetchMyCorrectionRequests('user-1');
    expect(r.title).toBe('Well reading');
    expect(r.status).toBe('rejected');
    expect(r.resolutionNote).toBe('Reading was correct.');
  });

  it('a lookup that THROWS is also contained', async () => {
    lookups.plants.mockRejectedValueOnce(new Error('network'));
    lookups.users.mockRejectedValueOnce(new Error('network'));
    const [r] = await fetchMyCorrectionRequests('user-1');
    expect(r.subtitle).toBe('Well');
    expect(r.resolvedByName).toBeNull();
    expect(r.reason).toBe('Meter misread');
  });

  it('looks up each kind of reading in its own table, batched by id', async () => {
    h.results.correction_requests = {
      data: [
        { ...REQUEST, id: 'a', source_table: 'well_readings', source_id: 'w-rd' },
        { ...REQUEST, id: 'b', source_table: 'locator_readings', source_id: 'l-rd' },
        { ...REQUEST, id: 'c', source_table: 'ro_train_readings', source_id: 't-rd' },
        { ...REQUEST, id: 'd', source_table: 'well_readings', source_id: 'w-rd2' },
      ],
      error: null,
    };
    await fetchMyCorrectionRequests('user-1');
    expect(callsOn('well_readings').find((c) => c.method === 'in')?.args).toEqual(['id', ['w-rd', 'w-rd2']]);
    expect(callsOn('locator_readings').some((c) => c.method === 'in')).toBe(true);
    expect(callsOn('ro_train_readings').some((c) => c.method === 'in')).toBe(true);
    expect(callsOn('product_meter_readings')).toEqual([]);
  });

  it('names an RO train by name, falling back to its number', async () => {
    h.results.correction_requests = { data: [{ ...REQUEST, source_table: 'ro_train_readings', source_id: 't-rd' }], error: null };
    h.results.ro_train_readings = { data: [{ id: 't-rd', train_id: 'tr1', reading_datetime: '2026-09-20T06:00:00Z' }], error: null };
    h.results.ro_trains = { data: [{ id: 'tr1', name: null, train_number: 2 }], error: null };
    const [r] = await fetchMyCorrectionRequests('user-1');
    expect(r.title).toBe('Train 2');
  });
});
